// The body of cut; its spec, in cut.ts, loads this the first time cut runs.

import type { CommandContext, CommandDoc, ExitCode } from '../../../shell/types';
import { openRecords, operands, optOn, optString, pacer, quoted } from '../../lib/text-input';

export const doc: CommandDoc = {
  description:
    'Prints the selected parts of each line of each FILE. With no FILE, or when FILE is -, it reads standard input. Use one, and only one, of -b, -c or -f. Each LIST is made up of one range, or many ranges separated by commas: N is the Nth byte, character or field, counted from 1; N- is from N to the end of the line; N-M is from N to M; -M is from the first to M. Selected parts are printed in the order of the line, once each, whatever the order of LIST.',
  man: [
    {
      heading: 'NOTES',
      body: 'Text in vesen is characters rather than bytes, so -b counts as -c does and a character is never split.',
    },
    { heading: 'EXIT STATUS', body: '0 when every FILE was read, 1 otherwise.' },
  ],
};

interface Range {
  readonly from: number;
  readonly to: number;
}

/** Reads a LIST; throws GNU's complaint. */
export function readList(list: string, fields: boolean): Range[] {
  const ranges: Range[] = [];
  const what = fields ? 'field' : 'byte/character';
  for (const part of list.split(/[,\s]/)) {
    if (part === '') throw new Error(fields ? 'fields are numbered from 1' : 'byte/character positions are numbered from 1');
    const match = /^(\d*)(-?)(\d*)$/.exec(part);
    if (match === null) throw new Error(`invalid ${fields ? 'field value' : 'byte/character position'} ${quoted(part)}`);
    const [, a = '', dash, b = ''] = match;
    if (dash === '' && a === '') throw new Error(`invalid ${what} position ${quoted(part)}`);
    if (dash !== '' && a === '' && b === '') throw new Error('invalid range with no endpoint: -');
    const from = a === '' ? 1 : Number(a);
    const to = dash === '' ? from : b === '' ? Infinity : Number(b);
    if (from === 0 || to === 0) throw new Error(fields ? 'fields are numbered from 1' : 'byte/character positions are numbered from 1');
    if (to < from) throw new Error('invalid decreasing range');
    ranges.push({ from, to });
  }
  return ranges.sort((x, y) => x.from - y.from);
}

function selected(ranges: readonly Range[], n: number): boolean {
  return ranges.some((r) => n >= r.from && n <= r.to);
}

/** The selected characters of a line; `between` goes between runs that were not next to each other. */
export function cutChars(line: string, ranges: readonly Range[], complement: boolean, between: string | null): string {
  const chars = Array.from(line);
  let text = '';
  let last = -2;
  chars.forEach((ch, i) => {
    if (selected(ranges, i + 1) === complement) return;
    if (between !== null && last >= 0 && last !== i - 1) text += between;
    text += ch;
    last = i;
  });
  return text;
}

/** The selected fields of a line, or null for a line with no delimiter that -s leaves out. */
export function cutFields(line: string, ranges: readonly Range[], delim: string, complement: boolean, onlyDelimited: boolean, between: string): string | null {
  if (!line.includes(delim)) return onlyDelimited ? null : line;
  const parts = line.split(delim);
  return parts.filter((_, i) => selected(ranges, i + 1) !== complement).join(between);
}

export async function run(ctx: CommandContext): Promise<ExitCode> {
  const lists = [['bytes', optString(ctx, 'bytes')], ['characters', optString(ctx, 'characters')], ['fields', optString(ctx, 'fields')]].filter(
    (entry): entry is [string, string] => entry[1] !== undefined,
  );
  if (lists.length === 0) return ctx.usage('you must specify a list of bytes, characters, or fields');
  if (lists.length > 1) return ctx.usage('only one type of list may be specified');
  const [kind, list] = lists[0] as [string, string];
  const fields = kind === 'fields';
  const delimOpt = optString(ctx, 'delimiter');
  if (!fields && delimOpt !== undefined) return ctx.usage('an input delimiter may be specified only when operating on fields');
  if (!fields && optOn(ctx, 'only-delimited')) return ctx.usage('suppressing non-delimited lines makes sense\n\tonly when operating on fields');
  if (delimOpt !== undefined && Array.from(delimOpt).length > 1) return ctx.usage('the delimiter must be a single character');
  let ranges: Range[];
  try {
    ranges = readList(list, fields);
  } catch (error) {
    return ctx.usage((error as Error).message);
  }
  const delim = delimOpt === undefined || delimOpt === '' ? (delimOpt === '' ? '\0' : '\t') : delimOpt;
  const outDelim = optString(ctx, 'output-delimiter');
  const complement = optOn(ctx, 'complement');
  const onlyDelimited = optOn(ctx, 'only-delimited');

  const breathe = pacer(ctx);
  let status = 0;
  for (const file of operands(ctx)) {
    const records = await openRecords(ctx, file);
    if (records === null) {
      status = 1;
      continue;
    }
    let buffer = '';
    for await (const record of records) {
      const cut = fields ? cutFields(record.text, ranges, delim, complement, onlyDelimited, outDelim ?? delim) : cutChars(record.text, ranges, complement, outDelim ?? null);
      if (cut === null) continue;
      buffer += `${cut}\n`;
      if (buffer.length > 4096) {
        await ctx.stdout.write(buffer);
        buffer = '';
      }
      await breathe();
    }
    if (buffer !== '') await ctx.stdout.write(buffer);
  }
  return status;
}
