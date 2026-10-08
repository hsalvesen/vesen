// What the text tools share: their FILE operands (none, or `-`, for standard input), read whole
// or line by line as standard input arrives, each line with whether a newline ended it (so a
// last line without one keeps that), the error each tool words its own way, byte counts in
// UTF-8, and a pause now and then so a long loop never starves the page.
//
// No tool holds more than MAX_INPUT (16 MB) of standard input at once: a whole input, one line,
// or the lines it keeps back. Past it the input is closed, so whatever writes it stops with a
// broken pipe, and the tool fails with `NAME: standard input: input too large (over 16 MB)`.

import { InputTooLarge, MAX_INPUT, type CommandContext } from '../../shell/types';
import type { VfsCode } from '../../vfs/types';
import { errorCode, reason } from './files';

export { InputTooLarge, MAX_INPUT };

/** Closes standard input, so its writer stops, and throws InputTooLarge. */
export function tooLarge(ctx: CommandContext): never {
  ctx.stdin.close();
  throw new InputTooLarge();
}

/** One line of input, and whether a newline ended it. */
export interface Rec {
  readonly text: string;
  readonly nl: boolean;
}

/** How a tool words a file it cannot read: `head: cannot open 'x' for reading: …`. */
export type Describe = (file: string, why: string, code: VfsCode) => string;

/** `name: FILE: reason`, the most common wording. */
export const plainDescribe: Describe = (file, why) => `${file}: ${why}`;

/** The FILE operands, or `-` alone when there are none. */
export function operands(ctx: CommandContext, args: readonly string[] = ctx.args): string[] {
  return args.length === 0 ? ['-'] : [...args];
}

/** What a tool calls standard input in its messages and headers. */
export function displayName(file: string): string {
  return file === '-' ? 'standard input' : file;
}

/**
 * The whole of one operand: a file, or standard input for `-`, held to MAX_INPUT. When it cannot
 * be read, says so on stderr (in the tool's words, or `standard input: input too large (over
 * 16 MB)`) and returns null, so the tool goes on or fails with its own status.
 */
export async function readOperand(ctx: CommandContext, file: string, describe: Describe = plainDescribe): Promise<string | null> {
  if (file === '-') {
    try {
      return await ctx.stdin.text();
    } catch (error) {
      if (!(error instanceof InputTooLarge)) throw error;
      await ctx.fail(error.message);
      return null;
    }
  }
  try {
    return ctx.fs.readFile(ctx.resolve(file));
  } catch (error) {
    const code = errorCode(error);
    await ctx.fail(describe(file, reason(error), code));
    return null;
  }
}

/**
 * Standard input whole, for a tool that takes only a little of it (figlet's message): null, with
 * the input closed so its writer stops, as soon as it is longer than `limit` characters.
 */
export async function readAtMost(ctx: CommandContext, limit: number): Promise<string | null> {
  const chunks: string[] = [];
  let size = 0;
  for await (const chunk of ctx.stdin.chunks()) {
    size += chunk.length;
    if (size > limit) {
      ctx.stdin.close();
      return null;
    }
    chunks.push(chunk);
  }
  return chunks.join('');
}

/** Splits text into lines; a last line without a newline is kept, marked so. */
export function splitRecords(text: string): Rec[] {
  if (text === '') return [];
  const pieces = text.split('\n');
  const last = pieces.pop() ?? '';
  const records: Rec[] = pieces.map((piece) => ({ text: piece, nl: true }));
  if (last !== '') records.push({ text: last, nl: false });
  return records;
}

/**
 * The records of `chunks` between `delim`s (a newline unless given), as they arrive: `nl` says a
 * delimiter ended one. Each chunk is searched once, so a long record costs no more than a short
 * one, and one longer than MAX_INPUT closes standard input and throws InputTooLarge.
 */
export async function* splitChunks(ctx: CommandContext, chunks: AsyncIterable<string> | Iterable<string>, delim = '\n'): AsyncGenerator<Rec, void, undefined> {
  let parts: string[] = [];
  let held = 0;
  for await (const chunk of chunks) {
    // A delimiter of two UTF-16 units (an emoji) may straddle two chunks, so the held part is
    // searched again with the chunk; one unit cannot.
    const text = delim.length > 1 && held > 0 ? parts.join('') + chunk : chunk;
    if (text !== chunk) parts = [];
    let from = 0;
    for (let at = text.indexOf(delim); at !== -1; at = text.indexOf(delim, from)) {
      parts.push(text.slice(from, at));
      const record = parts.join('');
      parts = [];
      held = 0;
      from = at + delim.length;
      yield { text: record, nl: true };
    }
    if (text !== chunk) held = 0;
    if (from < text.length) {
      held += text.length - from;
      parts.push(text.slice(from));
      if (held > MAX_INPUT) tooLarge(ctx);
    }
  }
  if (held > 0) yield { text: parts.join(''), nl: false };
}

/** Standard input a line at a time, as it arrives, so `yes | tool | head` ends at once. */
export function inputRecords(ctx: CommandContext): AsyncGenerator<Rec, void, undefined> {
  return splitChunks(ctx, ctx.stdin.chunks());
}

/**
 * What keeping one record costs besides its text, in characters: the object and its place in
 * the queue. Without it, 16 MB of `y` lines would be eight million records, far more memory.
 */
const RECORD_COST = 32;

/**
 * Records a tool keeps back while more arrive (tail's last lines, head's all but the last,
 * grep's lines before a match), as a queue that holds at most MAX_INPUT characters, each record
 * counting RECORD_COST more than its text: past it, standard input is closed and InputTooLarge
 * thrown, however many lines were asked for.
 */
export class HeldRecords<T extends { readonly text: string } = Rec> {
  private items: (T | undefined)[] = [];
  private first = 0;
  private size = 0;

  constructor(private readonly ctx: CommandContext) {}

  get length(): number {
    return this.items.length - this.first;
  }

  push(record: T): void {
    this.items.push(record);
    this.size += record.text.length + RECORD_COST;
    if (this.size > MAX_INPUT) tooLarge(this.ctx);
  }

  /** The oldest record, taken off the queue. */
  shift(): T | undefined {
    if (this.length === 0) return undefined;
    const record = this.items[this.first];
    this.items[this.first] = undefined;
    this.first += 1;
    this.size -= (record?.text.length ?? 0) + RECORD_COST;
    // Drop the taken slots now and then, so the array does not grow for ever.
    if (this.first > 1024 && this.first * 2 > this.items.length) {
      this.items = this.items.slice(this.first);
      this.first = 0;
    }
    return record;
  }

  /** Every record still held, oldest first. */
  all(): T[] {
    return this.items.slice(this.first) as T[];
  }

  clear(): void {
    this.items = [];
    this.first = 0;
    this.size = 0;
  }
}

async function* fromArray(records: readonly Rec[]): AsyncGenerator<Rec, void, undefined> {
  for (const record of records) yield record;
}

/**
 * The lines of one operand: standard input as it arrives, or a file's. Null, after the tool's
 * message, when the file cannot be read.
 */
export async function openRecords(ctx: CommandContext, file: string, describe: Describe = plainDescribe): Promise<AsyncIterable<Rec> | null> {
  if (file === '-') return inputRecords(ctx);
  const text = await readOperand(ctx, file, describe);
  return text === null ? null : fromArray(splitRecords(text));
}

/** Joins records back into text. */
export function joinRecords(records: readonly Rec[]): string {
  let text = '';
  for (const record of records) text += record.nl ? `${record.text}\n` : record.text;
  return text;
}

/** The length of `text` in UTF-8 bytes, as wc -c and head -c count. */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      bytes += 4;
      i += 1;
    } else bytes += 3;
  }
  return bytes;
}

/** The longest start of `text` that fits in `bytes` UTF-8 bytes; a character is never split. */
export function utf8Head(text: string, bytes: number): string {
  let used = 0;
  let i = 0;
  for (const ch of text) {
    const size = utf8Length(ch);
    if (used + size > bytes) break;
    used += size;
    i += ch.length;
  }
  return text.slice(0, i);
}

/** The longest end of `text` that fits in `bytes` UTF-8 bytes; a character is never split. */
export function utf8Tail(text: string, bytes: number): string {
  const chars = Array.from(text);
  let used = 0;
  let k = chars.length;
  while (k > 0) {
    const size = utf8Length(chars[k - 1] ?? '');
    if (used + size > bytes) break;
    used += size;
    k -= 1;
  }
  return chars.slice(k).join('');
}

/** Suffixes coreutils read after a count: 2K is 2048, 2kB 2000, and so on up to E. */
const MULTIPLIERS: Readonly<Record<string, number>> = {
  '': 1,
  b: 512,
  kB: 1000,
  K: 1024,
  KiB: 1024,
  k: 1024,
  MB: 1000 ** 2,
  M: 1024 ** 2,
  MiB: 1024 ** 2,
  GB: 1000 ** 3,
  G: 1024 ** 3,
  GiB: 1024 ** 3,
  TB: 1000 ** 4,
  T: 1024 ** 4,
  TiB: 1024 ** 4,
  PB: 1000 ** 5,
  P: 1024 ** 5,
  PiB: 1024 ** 5,
  EB: 1000 ** 6,
  E: 1024 ** 6,
  EiB: 1024 ** 6,
};

/** A count as head, tail and split read it: digits with an optional suffix. Null when it does not read. */
export function readCount(text: string): number | null {
  const match = /^(\d+)([a-zA-Z]*)$/.exec(text);
  if (match === null) return null;
  const multiplier = MULTIPLIERS[match[2] ?? ''];
  if (multiplier === undefined) return null;
  return Number(match[1]) * multiplier;
}

/** Text with GNU's quotes, as in `cannot open 'x' for reading`. */
export function quoted(text: string): string {
  return `'${text.replace(/'/g, "'\\''")}'`;
}

/** The string value of an option, or undefined when it was not given. */
export function optString(ctx: CommandContext, key: string): string | undefined {
  const value = ctx.opts[key];
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value[value.length - 1];
  return undefined;
}

/** Every value given for a repeatable option, in order. */
export function optList(ctx: CommandContext, key: string): string[] {
  const value = ctx.opts[key];
  if (Array.isArray(value)) return [...(value as readonly string[])];
  if (typeof value === 'string') return [value];
  if (typeof value === 'number') return [String(value)];
  return [];
}

/** True when a flag was given. */
export function optOn(ctx: CommandContext, key: string): boolean {
  const value = ctx.opts[key];
  return value !== undefined && value !== false && value !== 0;
}

/**
 * Lets the page breathe during a long loop: resolves at once most of the time, and every 16 ms
 * waits for a macrotask, so the browser can paint and ^C can reach the job. Rejects once the
 * command is interrupted.
 */
export function pacer(ctx: CommandContext): () => Promise<void> {
  let last = ctx.clock.now();
  return () => {
    if (ctx.signal.aborted) return Promise.reject(ctx.signal.reason);
    const now = ctx.clock.now();
    if (now - last < 16) return Promise.resolve();
    last = now;
    return ctx.clock.sleep(0, ctx.signal);
  };
}
