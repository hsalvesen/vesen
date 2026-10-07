// What the text tools share: their FILE operands (none, or `-`, for standard input), read whole
// or line by line as standard input arrives, each line with whether a newline ended it (so a
// last line without one keeps that), the error each tool words its own way, byte counts in
// UTF-8, and a pause now and then so a long loop never starves the page.

import type { CommandContext } from '../../shell/types';
import type { VfsCode } from '../../vfs/types';
import { errorCode, reason } from './files';

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
 * The whole of one operand: a file, or standard input for `-`. When it cannot be read, says so
 * on stderr (in the tool's words) and returns null.
 */
export async function readOperand(ctx: CommandContext, file: string, describe: Describe = plainDescribe): Promise<string | null> {
  if (file === '-') return ctx.stdin.text();
  try {
    return ctx.fs.readFile(ctx.resolve(file));
  } catch (error) {
    const code = errorCode(error);
    await ctx.fail(describe(file, reason(error), code));
    return null;
  }
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

/** Standard input a line at a time, as it arrives, so `yes | tool | head` ends at once. */
export async function* inputRecords(ctx: CommandContext): AsyncGenerator<Rec, void, undefined> {
  let pending = '';
  for await (const chunk of ctx.stdin.chunks()) {
    const pieces = (pending + chunk).split('\n');
    pending = pieces.pop() ?? '';
    for (const piece of pieces) yield { text: piece, nl: true };
  }
  if (pending !== '') yield { text: pending, nl: false };
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
