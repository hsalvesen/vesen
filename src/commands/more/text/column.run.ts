// The body of column; its spec, in column.ts, loads this the first time column runs.

import type { CommandContext, CommandDoc, ExitCode } from '../../../shell/types';
import { writeTable } from '../../lib/table-out';
import { operands, optOn, optString, readOperand, splitRecords } from '../../lib/text-input';

export const doc: CommandDoc = {
  description:
    "Lays out the lines of each FILE, or of standard input, in columns. By default the lines are entries filled into as many columns as fit the width, top to bottom; -x fills each row first. With -t each line is a row of a table: its fields, separated by white space or any of the -s characters, are lined up in columns, two spaces apart or with -o's STRING between them. Empty lines are left out.",
  man: [{ heading: 'EXIT STATUS', body: '0 when every FILE was read, 1 otherwise.' }],
};

const width = (text: string): number => Array.from(text).length;

/** The rows of a table, each field padded to its column's width; the last column is not. */
export function table(rows: readonly (readonly string[])[], separator: string): string {
  const widths: number[] = [];
  for (const row of rows) row.forEach((cell, i) => (widths[i] = Math.max(widths[i] ?? 0, width(cell))));
  let out = '';
  for (const row of rows) {
    out += `${row.map((cell, i) => (i === row.length - 1 ? cell : cell + ' '.repeat((widths[i] ?? 0) - width(cell)))).join(separator)}\n`;
  }
  return out;
}

/** Entries in columns of a common width (the widest, rounded up past a tab stop), as BSD column fills them. */
export function fill(entries: readonly string[], total: number, byRow: boolean): string {
  if (entries.length === 0) return '';
  const longest = Math.max(...entries.map(width));
  const cell = (longest + 8) & ~7;
  const columns = Math.max(1, Math.floor(total / cell));
  if (columns <= 1 || longest >= total) return entries.map((entry) => `${entry}\n`).join('');
  const rows = Math.ceil(entries.length / columns);
  let out = '';
  for (let r = 0; r < rows; r += 1) {
    const line: string[] = [];
    for (let c = 0; c < columns; c += 1) {
      const entry = byRow ? entries[r * columns + c] : entries[c * rows + r];
      if (entry !== undefined) line.push(entry);
    }
    out += `${line.map((entry, i) => (i === line.length - 1 ? entry : entry + ' '.repeat(cell - width(entry)))).join('')}\n`;
  }
  return out;
}

export async function run(ctx: CommandContext): Promise<ExitCode> {
  const lines: string[] = [];
  let status = 0;
  for (const file of operands(ctx)) {
    const text = await readOperand(ctx, file, (name, why) => `cannot open ${name}: ${why}`);
    if (text === null) {
      status = 1;
      continue;
    }
    for (const record of splitRecords(text)) if (record.text.trim() !== '') lines.push(record.text);
  }
  if (optOn(ctx, 'table')) {
    // White space runs separate fields; each -s character separates two, so empty fields stay.
    const seps = optString(ctx, 'separator');
    const rows =
      seps === undefined
        ? lines.map((line) => line.trim().split(/[ \t]+/))
        : lines.map((line) => line.split(new RegExp(`[${Array.from(seps).map((c) => `\\u{${(c.codePointAt(0) ?? 0).toString(16)}}`).join('')}]`, 'u')));
    await writeTable(ctx, table(rows, optString(ctx, 'output-separator') ?? '  '));
    return status;
  }
  const total = ctx.opts['output-width'] === undefined ? ctx.stdout.columns : Number(ctx.opts['output-width']);
  await ctx.stdout.write(fill(lines, total, optOn(ctx, 'fillrows')));
  return status;
}
