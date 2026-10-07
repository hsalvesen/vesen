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
  let written = '';
  const write = async (text: string): Promise<void> => {
    if (output === undefined || output === '-') await ctx.stdout.write(text);
    else written += text;
  };

  const breathe = pacer(ctx);
  let group: string[] = [];
  let groupKey: string | null = null;
  const flush = async (): Promise<void> => {
    const first = group[0];
    if (first === undefined) return;
    const n = group.length;
    if (allRepeated) {
      if (n > 1) await write(group.map((line) => `${line}\n`).join(''));
    } else if ((n > 1 && !unique) || (n === 1 && !repeated)) {
      await write(count ? `${String(n).padStart(7)} ${first}\n` : `${first}\n`);
    }
  };
  for await (const record of records) {
    const key = compareKey(record.text, fields, chars, width, fold);
    if (key !== groupKey) {
      await flush();
      group = [];
      groupKey = key;
    }
    // -D keeps every line of a group; the others need only the first and the count.
    if (allRepeated || group.length === 0) group.push(record.text);
    else group.push('');
    await breathe();
  }
  await flush();

  if (output !== undefined && output !== '-') {
    try {
      ctx.fs.writeFile(ctx.resolve(output), written);
    } catch (error) {
      return ctx.fail(`${output}: ${reason(error)}`);
    }
  }
  return 0;
}
