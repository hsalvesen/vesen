// The body of tail; its spec, in tail.ts, loads this the first time tail runs.

import type { CommandContext, CommandDoc, ExitCode } from '../../../shell/types';
import { errorCode, reason } from '../../lib/files';
import {
  displayName,
  HeldRecords,
  inputRecords,
  joinRecords,
  MAX_INPUT,
  operands,
  optOn,
  optString,
  quoted,
  readCount,
  splitRecords,
  tooLarge,
  utf8Head,
  utf8Length,
  utf8Tail,
} from '../../lib/text-input';

export const doc: CommandDoc = {
  description:
    'Prints the last 10 lines of each FILE. With more than one FILE, each is preceded by a header giving its name. With no FILE, or when FILE is -, it reads standard input. NUM may have a multiplier suffix, as for head. Bytes are counted in UTF-8, and a character is never split.',
  man: [
    {
      heading: 'FOLLOWING',
      body: "Files in vesen do not grow while a command waits, so -f and -F print the end of each FILE once, then say that following is not supported. On standard input they are ignored, as on Linux.",
    },
    { heading: 'EXIT STATUS', body: '0 when every FILE was read, 1 when any could not be: tail carries on with the rest.' },
  ],
};

interface Plan {
  readonly unit: 'lines' | 'bytes';
  readonly count: number;
  /** +NUM: from the NUMth on, rather than the last NUM. */
  readonly from: boolean;
}

/** The part of a whole text that tail prints. */
export function tailOf(text: string, plan: Plan): string {
  if (plan.unit === 'bytes') {
    if (plan.from) return text.slice(utf8Head(text, Math.max(0, plan.count - 1)).length);
    return utf8Tail(text, plan.count);
  }
  const records = splitRecords(text);
  if (plan.from) return joinRecords(records.slice(Math.max(0, plan.count - 1)));
  return joinRecords(plan.count === 0 ? [] : records.slice(-plan.count));
}

/** Standard input from byte `count` on (+NUM), written as it arrives. */
async function bytesFrom(ctx: CommandContext, count: number): Promise<void> {
  let skip = Math.max(0, count - 1);
  for await (const chunk of ctx.stdin.chunks()) {
    let rest = chunk;
    if (skip > 0) {
      const skipped = utf8Head(chunk, skip);
      skip -= utf8Length(skipped);
      rest = chunk.slice(skipped.length);
      // A character that only partly fits in what is skipped is kept whole, as for a file.
      if (rest !== '') skip = 0;
    }
    if (rest !== '') await ctx.stdout.write(rest);
  }
}

/**
 * The last `count` bytes of standard input. They are within the last `count` characters, so only
 * those are kept as it goes by; keeping more than MAX_INPUT closes the input and throws
 * InputTooLarge.
 */
async function lastBytes(ctx: CommandContext, count: number): Promise<void> {
  let held = '';
  for await (const chunk of ctx.stdin.chunks()) {
    held += chunk;
    if (count >= MAX_INPUT && held.length > MAX_INPUT) tooLarge(ctx);
    // Cut back a megabyte at a time, so the held text is copied only now and then.
    if (held.length > count + 1024 * 1024) held = held.slice(held.length - count - 1);
  }
  await ctx.stdout.write(utf8Tail(held, count));
}

async function tailInput(ctx: CommandContext, plan: Plan): Promise<void> {
  if (plan.unit === 'bytes') {
    await (plan.from ? bytesFrom(ctx, plan.count) : lastBytes(ctx, plan.count));
    return;
  }
  if (plan.count === 0 && !plan.from) {
    // Nothing to print, but the input is read to its end, as tail does.
    for await (const chunk of ctx.stdin.chunks()) void chunk;
    return;
  }
  if (plan.from) {
    let line = 0;
    for await (const record of inputRecords(ctx)) {
      line += 1;
      if (line >= plan.count) await ctx.stdout.write(record.nl ? `${record.text}\n` : record.text);
    }
    return;
  }
  // Only the last `count` lines are kept as standard input goes by.
  const ring = new HeldRecords(ctx);
  for await (const record of inputRecords(ctx)) {
    ring.push(record);
    if (ring.length > plan.count) ring.shift();
  }
  await ctx.stdout.write(joinRecords(ring.all()));
}

export async function run(ctx: CommandContext): Promise<ExitCode> {
  const bytes = optString(ctx, 'bytes');
  const lines = optString(ctx, 'lines');
  const unit = bytes !== undefined ? 'bytes' : 'lines';
  const raw = bytes ?? lines ?? '10';
  const from = raw.startsWith('+');
  const count = readCount(from || raw.startsWith('-') ? raw.slice(1) : raw);
  if (count === null) return ctx.fail(`invalid number of ${unit}: ${quoted(raw)}`);
  const plan: Plan = { unit, count, from };

  const files = operands(ctx);
  const headers = optOn(ctx, 'verbose') || (files.length > 1 && !optOn(ctx, 'quiet'));
  let status = 0;
  let first = true;
  const followed: string[] = [];
  // A header goes before each FILE that opens, as GNU's does: a folder opens and then fails to read.
  const header = async (file: string): Promise<void> => {
    if (!headers) return;
    await ctx.stdout.write(`${first ? '' : '\n'}==> ${displayName(file)} <==\n`);
    first = false;
  };
  for (const file of files) {
    if (file === '-') {
      await header(file);
      await tailInput(ctx, plan);
      continue;
    }
    let text: string;
    try {
      text = ctx.fs.readFile(ctx.resolve(file));
    } catch (error) {
      const directory = errorCode(error) === 'EISDIR';
      if (directory) await header(file);
      status = await ctx.fail(directory ? `error reading ${quoted(file)}: ${reason(error)}` : `cannot open ${quoted(file)} for reading: ${reason(error)}`);
      continue;
    }
    await header(file);
    await ctx.stdout.write(tailOf(text, plan));
    followed.push(file);
  }
  if (optOn(ctx, 'follow') && followed.length > 0) {
    await ctx.fail('following is not supported in vesen: files here do not grow while tail waits, so it printed the end once', 0);
  }
  return status;
}
