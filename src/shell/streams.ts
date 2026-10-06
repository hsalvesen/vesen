// The byte streams commands read and write (docs/plan/designs/shell-architecture.md, sections
// 2 and 3).
//
// - AsyncPipe joins two stages of a pipeline. A write resolves at once while less than 64 KiB is
//   waiting, and otherwise when the reader catches up; once the reader has gone, every write
//   rejects with BrokenPipe, which the executor turns into a silent status 141. That is how
//   `yes | head -n 2` ends.
// - Out streams: the screen (TtyOut, through a TtySink), a pipe, a file, /dev/null, or a capture
//   for $( ). Off the screen, spans lose their styles and actions and blocks become plain text.
// - In streams: a pipe, a string (`<<<` and `<`), or the terminal, which has nothing to read yet.
// - TtySink turns what a job writes to the screen into Blocks: text through the SGR reader (so
//   escapes become styles, never actions), lines, rich blocks, and the legacy HTML bridge.

import { htmlToText } from '../output/html-to-text';
import { plain, type Block, type Line, type Span, type Stream } from '../output/model';
import { SgrParser } from '../output/sgr';
import type { Vfs } from '../vfs/types';
import { BrokenPipe, type InStream, type OutStream } from './types';

/** How much may wait in a pipe before a write waits for the reader. */
export const PIPE_HIGH_WATER = 64 * 1024;

/** Lines one job may put on the screen; past it the rest is dropped with a notice. */
export const MAX_SCREEN_LINES = 20_000;

/** Characters written to the screen between yields to the browser, so ^C is always heard. */
const YIELD_EVERY = 32 * 1024;

/** Rejected by writes to the screen after the job was interrupted or has ended. */
export class JobDetached extends Error {
  constructor() {
    super('the job has ended');
    this.name = 'JobDetached';
  }
}

// ── Pipes ──────────────────────────────────────────────────────────────────────────────────

interface Waiter {
  resolve(): void;
  reject(error: unknown): void;
}

/** A bounded, one-reader text channel between two stages of a pipeline. */
export class AsyncPipe {
  private chunks: string[] = [];
  private buffered = 0;
  private writerDone = false;
  private readerGone = false;
  private readWaiter: (() => void) | null = null;
  private drainWaiters: Waiter[] = [];

  constructor(readonly highWater: number = PIPE_HIGH_WATER) {}

  /** Characters written and not yet read. */
  get size(): number {
    return this.buffered;
  }

  /** True once the reader has closed its end. */
  get broken(): boolean {
    return this.readerGone;
  }

  write(text: string): Promise<void> {
    if (this.readerGone) return Promise.reject(new BrokenPipe());
    if (this.writerDone) return Promise.reject(new Error('write after the pipe was closed'));
    if (text === '') return Promise.resolve();
    this.chunks.push(text);
    this.buffered += text.length;
    this.wakeReader();
    if (this.buffered <= this.highWater) return Promise.resolve();
    return new Promise<void>((resolve, reject) => this.drainWaiters.push({ resolve, reject }));
  }

  /** End of input: the reader sees null once it has read everything. */
  closeWrite(): void {
    this.writerDone = true;
    this.wakeReader();
  }

  /** The next chunk, or null at the end of input. */
  async read(): Promise<string | null> {
    for (;;) {
      const chunk = this.chunks.shift();
      if (chunk !== undefined) {
        this.buffered -= chunk.length;
        this.drain();
        return chunk;
      }
      if (this.writerDone || this.readerGone) return null;
      await new Promise<void>((resolve) => {
        this.readWaiter = resolve;
      });
    }
  }

  /** The reader has gone: what is waiting is discarded, and writers get BrokenPipe. */
  closeRead(): void {
    if (this.readerGone) return;
    this.readerGone = true;
    this.chunks = [];
    this.buffered = 0;
    const waiting = this.drainWaiters;
    this.drainWaiters = [];
    for (const waiter of waiting) waiter.reject(new BrokenPipe());
    this.wakeReader();
  }

  private wakeReader(): void {
    const wake = this.readWaiter;
    this.readWaiter = null;
    wake?.();
  }

  private drain(): void {
    if (this.buffered > this.highWater) return;
    const waiting = this.drainWaiters;
    this.drainWaiters = [];
    for (const waiter of waiting) waiter.resolve();
  }
}

// ── In streams ─────────────────────────────────────────────────────────────────────────────

async function* splitLines(next: () => Promise<string | null>): AsyncGenerator<string, void, undefined> {
  let buffer = '';
  for (;;) {
    const chunk = await next();
    if (chunk === null) {
      if (buffer !== '') yield buffer;
      return;
    }
    buffer += chunk;
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      yield buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf('\n');
    }
  }
}

/** The reading end of a pipe. */
export class PipeIn implements InStream {
  readonly isTTY = false;

  constructor(private readonly pipe: AsyncPipe) {}

  async text(): Promise<string> {
    let text = '';
    for (;;) {
      const chunk = await this.pipe.read();
      if (chunk === null) return text;
      text += chunk;
    }
  }

  lines(): AsyncIterable<string> {
    return splitLines(() => this.pipe.read());
  }

  close(): void {
    this.pipe.closeRead();
  }
}

/** Input from a string: `<<< word`, a file read for `<`, or a test. */
export class StringIn implements InStream {
  readonly isTTY = false;
  private rest: string | null;

  constructor(text: string) {
    this.rest = text;
  }

  private take(): Promise<string | null> {
    const text = this.rest;
    this.rest = null;
    return Promise.resolve(text);
  }

  async text(): Promise<string> {
    return (await this.take()) ?? '';
  }

  lines(): AsyncIterable<string> {
    return splitLines(() => this.take());
  }

  close(): void {
    this.rest = null;
  }
}

/** The terminal as stdin. Nothing can be typed to a running command yet, so it reads as empty. */
export class TtyIn implements InStream {
  readonly isTTY = true;

  text(): Promise<string> {
    return Promise.resolve('');
  }

  lines(): AsyncIterable<string> {
    return splitLines(() => Promise.resolve(null));
  }

  close(): void {}
}

// ── Out streams ────────────────────────────────────────────────────────────────────────────

/**
 * Migration only: the legacy adapter's way to print a legacy command's HTML. On the screen it is
 * a legacyHtml block, sanitised when drawn; anywhere else it is the text a reader would see.
 */
export interface LegacyHtmlOut {
  html(legacy: string): Promise<void>;
}

export type ShellOut = OutStream & LegacyHtmlOut;

function spanText(parts: readonly (string | Span)[]): string {
  return parts.map((part) => (typeof part === 'string' ? part : part.text)).join('');
}

/** An out stream that is not the screen: everything becomes plain text. */
abstract class TextOut implements ShellOut {
  readonly isTTY = false;

  constructor(readonly columns: number = 80) {}

  abstract write(text: string): Promise<void>;

  line(...parts: readonly (string | Span)[]): Promise<void> {
    return this.write(`${spanText(parts)}\n`);
  }

  block(block: Block): Promise<void> {
    const text = plain(block);
    return text === '' ? Promise.resolve() : this.write(text);
  }

  html(legacy: string): Promise<void> {
    const text = htmlToText(legacy);
    return text === '' ? Promise.resolve() : this.write(`${text}\n`);
  }
}

/** The writing end of a pipe. */
export class PipeOut extends TextOut {
  constructor(
    private readonly pipe: AsyncPipe,
    columns?: number,
  ) {
    super(columns);
  }

  write(text: string): Promise<void> {
    return this.pipe.write(text);
  }
}

/** /dev/null. */
export class NullOut extends TextOut {
  write(_text: string): Promise<void> {
    return Promise.resolve();
  }
}

/** Collects what is written, for $( ) and tests. */
export class CaptureOut extends TextOut {
  private chunks: string[] = [];

  write(text: string): Promise<void> {
    this.chunks.push(text);
    return Promise.resolve();
  }

  get text(): string {
    return this.chunks.join('');
  }
}

/** An open file that `>` or `>>` writes to. */
export interface WriteHandle {
  /** Appends text; throws a VfsError, for example when the disk is full. */
  write(text: string): void;
  close(): void;
}

/** Where redirections write. The VFS provides it from the next step; until then, the legacy tree. */
export interface WriteTarget {
  /**
   * Opens `path` (absolute) for writing, creating it, and truncating it unless `append` is set.
   * With `noclobber`, an existing file is refused with EEXIST. Throws a VfsError.
   */
  open(path: string, options: { append: boolean; noclobber: boolean }): WriteHandle;
}

/** A WriteTarget over any file system with the Vfs writeFile call. */
export function vfsWriteTarget(fs: Pick<Vfs, 'writeFile'>): WriteTarget {
  return {
    open(path, { append, noclobber }) {
      // Opening creates the file at once, and `>` empties it, as the shell does before the
      // command runs: `cat f > f` reads an empty file.
      fs.writeFile(path, '', append ? { append: true } : { noclobber });
      return {
        write: (text) => fs.writeFile(path, text, { append: true }),
        close: () => {},
      };
    },
  };
}

/** A redirection to a file. */
export class FileOut extends TextOut {
  private closed = false;

  constructor(private readonly handle: WriteHandle) {
    super();
  }

  write(text: string): Promise<void> {
    if (this.closed || text === '') return Promise.resolve();
    try {
      this.handle.write(text);
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(error);
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.handle.close();
  }
}

// ── The screen ─────────────────────────────────────────────────────────────────────────────

/** What a job did to the screen besides adding output. */
export type ScreenAction = 'keep' | 'clear' | 'reset';

export interface TtySinkOptions {
  /** Called on every write to the screen's stderr; the kernel rings the bell once per job. */
  onStderr?: () => void;
  /** Lets the browser run between large writes. Defaults to a zero-delay timer. */
  yieldToHost?: () => Promise<void>;
  maxLines?: number;
}

type OpenLines = { type: 'lines'; lines: Line[]; stream: Stream };

const defaultYield = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Collects a job's screen output as Blocks. Text runs through the SGR reader, one per stream;
 * consecutive lines on the same stream share one lines block; a clear (from `clear`, Ctrl+L's
 * effect, or ESC[2J in text) drops everything before it, and `reset` does too.
 */
export class TtySink {
  private items: Block[] = [];
  private open: OpenLines | null = null;
  private readonly parsers: Record<Stream, SgrParser> = { stdout: new SgrParser(), stderr: new SgrParser() };
  private partialStream: Stream | null = null;
  private action: ScreenAction = 'keep';
  private sealed = false;
  private lines = 0;
  private truncated = false;
  private sinceYield = 0;

  constructor(private readonly options: TtySinkOptions = {}) {}

  get ended(): boolean {
    return this.sealed;
  }

  text(stream: Stream, text: string): Promise<void> {
    if (this.sealed) return Promise.reject(new JobDetached());
    if (text === '') return Promise.resolve();
    if (stream === 'stderr') this.options.onStderr?.();
    if (this.partialStream !== null && this.partialStream !== stream) this.endPartial(this.partialStream);
    for (const event of this.parsers[stream].feed(text)) {
      if (event.kind === 'clear') this.clearAll('clear');
      else this.push(stream, event.line);
    }
    this.partialStream = this.parsers[stream].partial().length > 0 ? stream : null;
    this.sinceYield += text.length;
    if (this.sinceYield < YIELD_EVERY) return Promise.resolve();
    this.sinceYield = 0;
    return (this.options.yieldToHost ?? defaultYield)().then(() => {
      if (this.sealed) throw new JobDetached();
    });
  }

  line(stream: Stream, parts: readonly (string | Span)[]): Promise<void> {
    if (this.sealed) return Promise.reject(new JobDetached());
    if (stream === 'stderr') this.options.onStderr?.();
    this.endPartials();
    this.push(
      stream,
      parts.map((part) => (typeof part === 'string' ? { text: part } : part)).filter((span) => span.text !== ''),
    );
    return Promise.resolve();
  }

  block(block: Block): Promise<void> {
    if (this.sealed) return Promise.reject(new JobDetached());
    this.endPartials();
    this.open = null;
    this.items.push(block);
    return Promise.resolve();
  }

  /** The `clear` effect. */
  clear(): void {
    if (!this.sealed) this.clearAll('clear');
  }

  /** The `reset` effect: the host puts the banner back. */
  reset(): void {
    if (!this.sealed) this.clearAll('reset');
  }

  /** Stops taking output: unfinished lines are ended, and later writes reject with JobDetached. */
  seal(): void {
    if (this.sealed) return;
    this.endPartials();
    this.sealed = true;
  }

  /** Ends the job's output and returns it. */
  finish(): { blocks: Block[]; screen: ScreenAction } {
    this.seal();
    return { blocks: this.items, screen: this.action };
  }

  private clearAll(action: Exclude<ScreenAction, 'keep'>): void {
    this.items = [];
    this.open = null;
    this.lines = 0;
    this.truncated = false;
    this.action = action;
  }

  private endPartials(): void {
    if (this.partialStream !== null) this.endPartial(this.partialStream);
  }

  private endPartial(stream: Stream): void {
    for (const event of this.parsers[stream].end()) {
      if (event.kind === 'line') this.push(stream, event.line);
    }
    this.partialStream = null;
  }

  private push(stream: Stream, line: Line): void {
    if (this.truncated) return;
    const max = this.options.maxLines ?? MAX_SCREEN_LINES;
    if (this.lines >= max) {
      this.truncated = true;
      this.open = null;
      this.items.push({ type: 'lines', lines: [[{ text: '[output truncated]', style: { fg: 'muted' } }]], stream });
      return;
    }
    this.lines += 1;
    if (this.open === null || this.open.stream !== stream) {
      this.open = { type: 'lines', lines: [], stream };
      this.items.push(this.open);
    }
    this.open.lines.push(line);
  }
}

/** A stream to the screen: text, lines and blocks keep their styles and actions. */
export class TtyOut implements ShellOut {
  readonly isTTY = true;

  constructor(
    private readonly sink: TtySink,
    private readonly stream: Stream,
    private readonly size: () => number,
  ) {}

  get columns(): number {
    return this.size();
  }

  write(text: string): Promise<void> {
    return this.sink.text(this.stream, text);
  }

  line(...parts: readonly (string | Span)[]): Promise<void> {
    return this.sink.line(this.stream, parts);
  }

  block(block: Block): Promise<void> {
    return this.sink.block(block);
  }

  html(legacy: string): Promise<void> {
    // A literal, as interfaces/command.ts does, so the legacy path pulls in no builders.
    return this.sink.block({ type: 'legacyHtml', html: legacy });
  }
}

/** Writes legacy HTML to any out stream: the bridge when it has one, its text otherwise. */
export function writeLegacyHtml(stream: OutStream, legacy: string): Promise<void> {
  const bridge = stream as Partial<LegacyHtmlOut>;
  if (typeof bridge.html === 'function') return bridge.html.call(stream, legacy);
  const text = htmlToText(legacy);
  return text === '' ? Promise.resolve() : stream.write(`${text}\n`);
}
