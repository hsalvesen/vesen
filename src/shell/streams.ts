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
//   escapes become styles, never actions), lines, rich blocks, and the legacy HTML bridge. It
//   says when its output changes, so the screen can draw the job's entry as it runs (at most once
//   a frame, which is the host's business), and view() is that output as it would show now.

import { htmlToText } from '../output/html-to-text';
import { type Block, type Line, type Span, type Stream } from '../output/model';
import { plain } from '../output/plain';
import { SgrParser } from '../output/sgr';
import type { Vfs } from '../vfs/types';
import { BrokenPipe, type InStream, type OutStream } from './types';

/** How much may wait in a pipe before a write waits for the reader. */
export const PIPE_HIGH_WATER = 64 * 1024;

/** Lines one job may put on the screen; past it the rest is dropped with a notice. */
export const MAX_SCREEN_LINES = 20_000;

/**
 * Characters one job may put on the screen, counted over all its lines; past it the rest is
 * dropped with the same notice. One line of `printf '%99999999s'` would otherwise freeze the tab.
 */
export const MAX_SCREEN_CHARS = 2_000_000;

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

  async *chunks(): AsyncGenerator<string, void, undefined> {
    for (let chunk = await this.pipe.read(); chunk !== null; chunk = await this.pipe.read()) yield chunk;
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

  async *chunks(): AsyncGenerator<string, void, undefined> {
    const text = await this.take();
    if (text !== null && text !== '') yield text;
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

  async *chunks(): AsyncGenerator<string, void, undefined> {
    // Nothing can be typed to a running command yet.
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

/** Where redirections write: the VFS (Vfs.openWrite), or any file system with writeFile in tests. */
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

/** A running job's output as the screen shows it now. */
export interface LiveOutput {
  /** The blocks so far, with any unfinished line at the end, as a terminal shows it. */
  readonly blocks: readonly Block[];
  /** The last clear or reset the job did, if any. */
  readonly screen: ScreenAction;
  /** How many times the job has cleared the screen (clear, ESC[2J) or reset it so far. */
  readonly clears: number;
}

export interface TtySinkOptions {
  /** Called on every write to the screen's stderr; the kernel rings the bell once per job. */
  onStderr?: () => void;
  /**
   * Called after the output changes: text, a line, a block, a clear. It says only that view()
   * would now show something else; the host decides when to look, so a job writing a line at a
   * time costs one redraw a frame, not one a line. Never called once the sink is sealed.
   */
  onChange?: () => void;
  /** Lets the browser run between large writes. Defaults to a zero-delay timer. */
  yieldToHost?: () => Promise<void>;
  maxLines?: number;
  maxChars?: number;
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
  private chars = 0;
  private truncated = false;
  private sinceYield = 0;
  private clears = 0;

  constructor(private readonly options: TtySinkOptions = {}) {}

  get ended(): boolean {
    return this.sealed;
  }

  text(stream: Stream, text: string): Promise<void> {
    if (this.sealed) return Promise.reject(new JobDetached());
    if (text === '') return Promise.resolve();
    if (stream === 'stderr') this.options.onStderr?.();
    // Past the budget nothing more is kept, not even an unfinished line.
    if (this.truncated) return this.counted(text.length);
    if (this.partialStream !== null && this.partialStream !== stream) this.endPartial(this.partialStream);
    for (const event of this.parsers[stream].feed(text)) {
      if (event.kind === 'clear') this.clearAll('clear');
      else this.push(stream, event.line);
    }
    const partial = this.parsers[stream].partial();
    this.partialStream = partial.length > 0 ? stream : null;
    // What is still unfinished counts too, so one endless line cannot slip past the budget.
    const unfinished = partial.reduce((sum, span) => sum + span.text.length, 0);
    if (!this.truncated && this.chars + unfinished > (this.options.maxChars ?? MAX_SCREEN_CHARS)) {
      this.parsers[stream].end();
      this.partialStream = null;
      this.truncate(stream);
    }
    this.changed();
    return this.counted(text.length);
  }

  line(stream: Stream, parts: readonly (string | Span)[]): Promise<void> {
    if (this.sealed) return Promise.reject(new JobDetached());
    if (stream === 'stderr') this.options.onStderr?.();
    this.endPartials();
    const spans = parts.map((part) => (typeof part === 'string' ? { text: part } : part)).filter((span) => span.text !== '');
    this.push(stream, spans);
    this.changed();
    return this.counted(spans.reduce((sum, span) => sum + span.text.length, 1));
  }

  block(block: Block): Promise<void> {
    if (this.sealed) return Promise.reject(new JobDetached());
    this.endPartials();
    this.open = null;
    if (!this.truncated) this.items.push(block);
    this.changed();
    // A block's size is not worth measuring here; it counts as a line of average length.
    return this.counted(256);
  }

  /** Adds to what was written since the browser last had a turn, and gives it one when due. */
  private counted(size: number): Promise<void> {
    this.sinceYield += size;
    if (this.sinceYield < YIELD_EVERY) return Promise.resolve();
    this.sinceYield = 0;
    return (this.options.yieldToHost ?? defaultYield)().then(() => {
      if (this.sealed) throw new JobDetached();
    });
  }

  /** The `clear` effect. */
  clear(): void {
    if (this.sealed) return;
    this.clearAll('clear');
    this.changed();
  }

  /** The `reset` effect: the host puts the banner back. */
  reset(): void {
    if (this.sealed) return;
    this.clearAll('reset');
    this.changed();
  }

  /** Stops taking output: unfinished lines are ended, and later writes reject with JobDetached. */
  seal(): void {
    if (this.sealed) return;
    this.endPartials();
    this.sealed = true;
  }

  /** The output so far, as it would show now: what a command reading a line shows above its prompt. */
  snapshot(): Block[] {
    return this.items.map((block) => (block.type === 'lines' ? { ...block, lines: [...block.lines] } : block));
  }

  /**
   * The output as the screen shows it while the job runs: a copy (the sink goes on changing its
   * own), with a line still being written shown as far as it has got, as a terminal shows
   * `printf 'a'; sleep 3`.
   */
  view(): LiveOutput {
    const blocks = this.snapshot();
    const stream = this.partialStream;
    const partial = stream === null || this.truncated ? [] : this.parsers[stream].partial();
    if (stream !== null && partial.length > 0) {
      // The open lines block, when there is one, is always the last.
      const last = blocks[blocks.length - 1];
      if (this.open !== null && this.open.stream === stream && last !== undefined && last.type === 'lines') {
        blocks[blocks.length - 1] = { ...last, lines: [...last.lines, partial] };
      } else {
        blocks.push({ type: 'lines', lines: [partial], stream });
      }
    }
    return { blocks, screen: this.action, clears: this.clears };
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
    this.chars = 0;
    this.truncated = false;
    this.action = action;
    this.clears += 1;
  }

  private changed(): void {
    if (!this.sealed) this.options.onChange?.();
  }

  /** Stops taking output, with a notice where it stopped. */
  private truncate(stream: Stream): void {
    this.truncated = true;
    this.open = null;
    this.items.push({ type: 'lines', lines: [[{ text: '[output truncated]', style: { fg: 'muted' } }]], stream });
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
    const size = line.reduce((sum, span) => sum + span.text.length, 0);
    if (this.lines >= (this.options.maxLines ?? MAX_SCREEN_LINES) || this.chars + size > (this.options.maxChars ?? MAX_SCREEN_CHARS)) {
      this.truncate(stream);
      return;
    }
    this.lines += 1;
    this.chars += size;
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
