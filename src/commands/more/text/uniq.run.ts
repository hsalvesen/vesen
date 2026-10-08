// The body of uniq; its spec, in uniq.ts, loads this the first time uniq runs.

import type { CommandContext, CommandDoc, ExitCode } from '../../../shell/types';
import { reason } from '../../lib/files';
import { openRecords, optOn, pacer, quoted } from '../../lib/text-input';

export const doc: CommandDoc = {
  description:
    'Filters adjacent matching lines from INPUT (or standard input), writing to OUTPUT (or standard output). Only lines next to each other are compared, so sort the input first to merge every repeat. A field is a run of blanks followed by non-blanks; fields are skipped before characters.',
  man: [{ heading: 'EXIT STATUS', body: '0 on success, 1 when INPUT cannot be read or OUTPUT written.' }],
};

/** The part of a line that is compared. */
export function compareKey(line: string, fields: number, chars: number, width: number, fold: boolean): string {
  let i = 0;
  for (let f = 0; f < fields; f += 1) {
    while (i < line.length && (line.charAt(i) === ' ' || line.charAt(i) === '\t')) i += 1;
    while (i < line.length && line.charAt(i) !== ' ' && line.charAt(i) !== '\t') i += 1;
  }
  let key = Array.from(line.slice(i)).slice(chars);
  if (width >= 0) key = key.slice(0, width);
  const text = key.join('');
  return fold ? text.toLowerCase() : text;
}

export async function run(ctx: CommandContext): Promise<ExitCode> {
  if (ctx.args.length > 2) return ctx.usage(`extra operand ${quoted(ctx.args[2] ?? '')}`);
  const count = optOn(ctx, 'count');
  const repeated = optOn(ctx, 'repeated');
  const allRepeated = optOn(ctx, 'all-repeated');
  const unique = optOn(ctx, 'unique');
  if (count && allRepeated) return ctx.usage('printing all duplicated lines and repeat counts is meaningless');
  const fields = Number(ctx.opts['skip-fields'] ?? 0);
  const chars = Number(ctx.opts['skip-chars'] ?? 0);
  const width = ctx.opts['check-chars'] === undefined ? -1 : Number(ctx.opts['check-chars']);
  const fold = optOn(ctx, 'ignore-case');

  const input = ctx.args[0] ?? '-';
  const records = await openRecords(ctx, input);
  if (records === null) return 1;
  const output = ctx.args[1];
  // An OUTPUT file is emptied once the input opens, then written as lines come, as GNU's is.
  const path = output === undefined || output === '-' ? null : ctx.resolve(output);
  if (path !== null) {
    try {
      ctx.fs.writeFile(path, '');
    } catch (error) {
      return ctx.fail(`${output}: ${reason(error)}`);
    }
  }
  const write = async (text: string): Promise<void> => {
    if (path === null) await ctx.stdout.write(text);
    else ctx.fs.writeFile(path, text, { append: true });
  };

  // Only the first line of a group and its count are kept, so a group of any length costs the
  // same: -D writes its lines as they come, once the second shows it is repeated.
  const breathe = pacer(ctx);
  let first: string | null = null;
  let n = 0;
  let groupKey: string | null = null;
  const flush = async (): Promise<void> => {
    if (first === null || allRepeated) return;
    if ((n > 1 && !unique) || (n === 1 && !repeated)) await write(count ? `${String(n).padStart(7)} ${first}\n` : `${first}\n`);
  };
  try {
    for await (const record of records) {
      const key = compareKey(record.text, fields, chars, width, fold);
      if (key !== groupKey) {
        await flush();
        first = record.text;
        n = 0;
        groupKey = key;
      }
      n += 1;
      if (allRepeated && n > 1) await write(n === 2 ? `${first ?? ''}\n${record.text}\n` : `${record.text}\n`);
      await breathe();
    }
    await flush();
  } catch (error) {
    return ctx.fail(`${output ?? '-'}: ${reason(error)}`);
  }
  return 0;
}
