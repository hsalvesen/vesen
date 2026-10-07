// The body of fold; its spec, in fold.ts, loads this the first time fold runs.

import type { CommandContext, CommandDoc, ExitCode } from '../../../shell/types';
import { openRecords, operands, optOn, optString, pacer, quoted, utf8Length } from '../../lib/text-input';

export const doc: CommandDoc = {
  description:
    'Wraps input lines in each FILE, writing to standard output, so no line is wider than WIDTH columns (80). With no FILE, or when FILE is -, it reads standard input. A tab advances to the next multiple of 8 columns, a backspace goes back one and a carriage return goes back to the start; with -b every byte counts as one column. With -s a line is broken after the last blank that fits, when there is one.',
  man: [{ heading: 'EXIT STATUS', body: '0 when every FILE was read, 1 otherwise.' }],
};

/** The column after `ch` at `column`. */
function advance(column: number, ch: string, bytes: boolean): number {
  if (bytes) return column + utf8Length(ch);
  if (ch === '\b') return Math.max(0, column - 1);
  if (ch === '\r') return 0;
  if (ch === '\t') return column + 8 - (column % 8);
  return column + 1;
}

/** One line (without its newline) folded to `width`. */
export function foldLine(line: string, width: number, spaces: boolean, bytes: boolean): string {
  let out = '';
  let pending: string[] = [];
  let column = 0;
  const chars = Array.from(line);
  for (let i = 0; i < chars.length; ) {
    const ch = chars[i] as string;
    const next = advance(column, ch, bytes);
    if (next <= width || pending.length === 0) {
      pending.push(ch);
      column = next;
      i += 1;
      continue;
    }
    // Too wide: break before this character (after the last blank, with -s), then look at it
    // again on the new line, as GNU fold does.
    const blank = spaces ? Math.max(pending.lastIndexOf(' '), pending.lastIndexOf('\t')) : -1;
    if (blank !== -1 && blank < pending.length - 1) {
      out += `${pending.slice(0, blank + 1).join('')}\n`;
      pending = pending.slice(blank + 1);
      column = pending.reduce((c, r) => advance(c, r, bytes), 0);
      continue;
    }
    out += `${pending.join('')}\n`;
    pending = [];
    column = 0;
  }
  return out + pending.join('');
}

export async function run(ctx: CommandContext): Promise<ExitCode> {
  const raw = optString(ctx, 'width') ?? '80';
  const width = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!(width > 0)) return ctx.fail(`invalid number of columns: ${quoted(raw)}`);
  const spaces = optOn(ctx, 'spaces');
  const bytes = optOn(ctx, 'bytes');
  const breathe = pacer(ctx);
  let status = 0;
  for (const file of operands(ctx)) {
    const records = await openRecords(ctx, file);
    if (records === null) {
      status = 1;
      continue;
    }
    for await (const record of records) {
      await ctx.stdout.write(foldLine(record.text, width, spaces, bytes) + (record.nl ? '\n' : ''));
      await breathe();
    }
  }
  return status;
}
