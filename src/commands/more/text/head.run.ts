// The body of head; its spec, in head.ts, loads this the first time head runs.

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
  type Rec,
} from '../../lib/text-input';

export const doc: CommandDoc = {
  description:
    'Prints the first 10 lines of each FILE. With more than one FILE, each is preceded by a header giving its name. With no FILE, or when FILE is -, it reads standard input, and stops reading as soon as it has enough, so `yes | head -n 3` ends at once. NUM may have a multiplier suffix: b 512, kB 1000, K 1024, MB 1000*1000, M 1024*1024, and so on for G, T, P and E. Bytes are counted in UTF-8, and a character is never split.',
  man: [{ heading: 'EXIT STATUS', body: '0 when every FILE was read, 1 when any could not be: head carries on with the rest.' }],
};

interface Plan {
  readonly unit: 'lines' | 'bytes';
  /** How many to print, or with `allBut`, how many to leave off the end. */
  readonly count: number;
  readonly allBut: boolean;
}

/**
 * All but the last `count` bytes of standard input, written as it arrives. The last N bytes are
 * within the last N characters, so only those are held back; holding more than MAX_INPUT closes
 * the input and throws InputTooLarge.
 */
async function allButBytes(ctx: CommandContext, count: number): Promise<void> {
  let held = '';
  for await (const chunk of ctx.stdin.chunks()) {
    held += chunk;
    if (count >= MAX_INPUT && held.length > MAX_INPUT) tooLarge(ctx);
    // Written a megabyte at a time, so the held text is copied only now and then.
    if (held.length > count + 1024 * 1024) {
      let at = held.length - count;
      if (/[\udc00-\udfff]/.test(held.charAt(at))) at -= 1;
      await ctx.stdout.write(held.slice(0, at));
      held = held.slice(at);
    }
  }
  await ctx.stdout.write(utf8Head(held, Math.max(0, utf8Length(held) - count)));
}

/** The first `plan.count` lines of standard input, or all but the last. */
async function headInput(ctx: CommandContext, plan: Plan): Promise<void> {
  if (plan.unit === 'bytes' && plan.allBut) {
    await allButBytes(ctx, plan.count);
    return;
  }
  if (plan.unit === 'bytes') {
    // As it arrives, and no further than needed: `yes | head -c 5` ends at once.
    let left = plan.count;
    if (left === 0) return;
    for await (const chunk of ctx.stdin.chunks()) {
      const piece = utf8Head(chunk, left);
      if (piece !== '') await ctx.stdout.write(piece);
      left -= utf8Length(piece);
      if (left <= 0 || piece.length < chunk.length) break;
    }
    return;
  }
  if (plan.allBut) {
    // Keep the last `count` lines back until more arrive behind them.
    const held = new HeldRecords(ctx);
    for await (const record of inputRecords(ctx)) {
      held.push(record);
      if (held.length > plan.count) {
        const first = held.shift() as Rec;
        await ctx.stdout.write(first.nl ? `${first.text}\n` : first.text);
      }
    }
    return;
  }
  if (plan.count === 0) return;
  let seen = 0;
  for await (const record of inputRecords(ctx)) {
    await ctx.stdout.write(record.nl ? `${record.text}\n` : record.text);
    seen += 1;
    if (seen >= plan.count) break;
  }
}

/** The part of a whole text that head prints. */
export function cut(text: string, plan: Plan): string {
  if (plan.unit === 'bytes') {
    if (!plan.allBut) return utf8Head(text, plan.count);
    return utf8Head(text, Math.max(0, utf8Length(text) - plan.count));
  }
  const records = splitRecords(text);
  return joinRecords(plan.allBut ? records.slice(0, Math.max(0, records.length - plan.count)) : records.slice(0, plan.count));
}

export async function run(ctx: CommandContext): Promise<ExitCode> {
  const bytes = optString(ctx, 'bytes');
  const lines = optString(ctx, 'lines');
  const unit = bytes !== undefined ? 'bytes' : 'lines';
  const raw = bytes ?? lines ?? '10';
  const allBut = raw.startsWith('-');
  const count = readCount(allBut || raw.startsWith('+') ? raw.slice(1) : raw);
  if (count === null) return ctx.fail(`invalid number of ${unit}: ${quoted(raw)}`);
  const plan: Plan = { unit, count, allBut };

  const files = operands(ctx);
  const headers = optOn(ctx, 'verbose') || (files.length > 1 && !optOn(ctx, 'quiet'));
  let status = 0;
  let first = true;
  // A header goes before each FILE that opens, as GNU's does: a folder opens and then fails to read.
  const header = async (file: string): Promise<void> => {
    if (!headers) return;
    await ctx.stdout.write(`${first ? '' : '\n'}==> ${displayName(file)} <==\n`);
    first = false;
  };
  for (const file of files) {
    if (file === '-') {
      await header(file);
      await headInput(ctx, plan);
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
    await ctx.stdout.write(cut(text, plan));
  }
  return status;
}
