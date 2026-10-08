// The body of cal; its spec, in cal.ts, loads this the first time cal runs.

import { out, type Line, type SpanStyle } from '../../../output/model';
import type { CommandContext, CommandDoc, ExitCode } from '../../../shell/types';
import { MONTH_NAMES, wallClock } from '../../lib/sysread';

/** What --help, help and man say about cal, besides its spec (cal.ts). */
export const doc: CommandDoc = {
  description:
    "Shows this month's calendar, with today picked out in the accent colour. With YEAR, the whole of that year; with MONTH and YEAR, that month (MONTH is a number or a name such as oct); with DAY too, that day is picked out. -3 shows the months either side as well, -y the whole year, and -m starts the weeks on Monday. Months sit three to a row, or as many as fit a narrower screen. Today is the date in your time zone, or in $TZ. The calendar is Gregorian all the way back, so September 1752 has all its days.",
  man: [{ heading: 'EXIT STATUS', body: '0, or 1 for a month or year that does not exist.' }],
};

/** The width of one month: seven days of two digits and the spaces between. */
const WIDTH = 20;
const GAP = '  ';
const TODAY: SpanStyle = { fg: 'accent', bold: true };

/** A piece of a row, and whether it is the day to pick out. */
interface Piece {
  readonly text: string;
  readonly today?: boolean;
}
type Row = Piece[];

/** The day of the week, 0 for Sunday, in the Gregorian calendar for any year from 1. */
export function dayOfWeek(year: number, month: number, day: number): number {
  const offsets = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
  const y = month < 3 ? year - 1 : year;
  return (y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) + (offsets[month - 1] ?? 0) + day) % 7;
}

export function daysIn(year: number, month: number): number {
  if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function centred(text: string, width: number): string {
  return `${' '.repeat(Math.max(0, Math.floor((width - text.length) / 2)))}${text}`.padEnd(width);
}

/** One month as rows WIDTH wide: its title, the days of the week, and its weeks. */
export function monthRows(year: number, month: number, options: { monday: boolean; mark: number | null; withYear: boolean }): Row[] {
  const name = MONTH_NAMES[month - 1] ?? '';
  const days = options.monday ? 'Mo Tu We Th Fr Sa Su' : 'Su Mo Tu We Th Fr Sa';
  const rows: Row[] = [[{ text: centred(options.withYear ? `${name} ${year}` : name, WIDTH) }], [{ text: days }]];
  const lead = (dayOfWeek(year, month, 1) + (options.monday ? 6 : 0)) % 7;
  let row: Row = [{ text: '   '.repeat(lead) }];
  let filled = lead;
  for (let day = 1; day <= daysIn(year, month); day += 1) {
    const cell = String(day).padStart(2);
    if (day === options.mark) row.push({ text: cell, today: true });
    else row.push({ text: cell });
    filled += 1;
    if (filled === 7) {
      rows.push(row);
      row = [];
      filled = 0;
    } else {
      row.push({ text: ' ' });
    }
  }
  if (filled > 0) rows.push(row);
  return rows.map((pieces) => {
    const length = pieces.reduce((sum, piece) => sum + piece.text.length, 0);
    return length < WIDTH ? [...pieces, { text: ' '.repeat(WIDTH - length) }] : pieces;
  });
}

/**
 * How many months fit side by side: three, or on a narrower screen as many as fit it, as
 * util-linux cal lays out a year for a narrow terminal. Into a pipe, always three.
 */
function monthsPerRow(ctx: CommandContext): number {
  if (!ctx.stdout.isTTY) return 3;
  return Math.min(3, Math.max(1, Math.floor((ctx.stdout.columns + GAP.length) / (WIDTH + GAP.length))));
}

/** Months in rows of `perRow`, a blank row between each row of months. */
function inRows(months: readonly Row[][], perRow: number): Row[] {
  const rows: Row[] = [];
  for (let first = 0; first < months.length; first += perRow) {
    if (first > 0) rows.push([]);
    rows.push(...sideBySide(months.slice(first, first + perRow)));
  }
  return rows;
}

/** Months side by side, GAP apart, with the shorter ones filled out with blank rows. */
function sideBySide(months: readonly Row[][]): Row[] {
  const height = Math.max(...months.map((rows) => rows.length));
  const rows: Row[] = [];
  for (let r = 0; r < height; r += 1) {
    const row: Row = [];
    months.forEach((rowsOf, i) => {
      if (i > 0) row.push({ text: GAP });
      row.push(...(rowsOf[r] ?? [{ text: ' '.repeat(WIDTH) }]));
    });
    rows.push(row);
  }
  return rows;
}

/** A month number from `10`, `oct` or `October`; null for neither. */
function monthNumber(word: string): number | null {
  if (/^\d+$/.test(word)) {
    const n = Number(word);
    return n >= 1 && n <= 12 ? n : null;
  }
  const lower = word.toLowerCase();
  if (lower.length < 3) return null;
  const index = MONTH_NAMES.findIndex((name) => name.toLowerCase().startsWith(lower));
  return index === -1 ? null : index + 1;
}

const yearNumber = (word: string): number | null => (/^\d+$/.test(word) && Number(word) >= 1 && Number(word) <= 9999 ? Number(word) : null);

/** What the words ask for: a month (or a whole year), and the DAY to pick out, if one was given. */
interface Asked {
  readonly year: number;
  readonly month: number;
  readonly whole: boolean;
  readonly day: number | null;
}

/** Reads `[[DAY] MONTH] YEAR`, or a month's name alone; a string says what is wrong. */
function asked(ctx: CommandContext, now: { year: number; month: number }): Asked | string {
  const args = ctx.args;
  const yearWord = args[args.length - 1];
  if (yearWord === undefined) return { year: now.year, month: now.month, whole: ctx.opts.year === true, day: null };
  // One word that names a month is that month this year; a number alone is a year.
  if (args.length === 1 && !/^\d+$/.test(yearWord)) {
    const named = monthNumber(yearWord);
    return named === null ? 'illegal month value: use 1-12' : { year: now.year, month: named, whole: ctx.opts.year === true, day: null };
  }
  const year = yearNumber(yearWord);
  if (year === null) return 'illegal year value: use 1-9999';
  const monthWord = args[args.length - 2];
  if (monthWord === undefined) {
    const whole = ctx.opts.three !== true && ctx.opts.one !== true;
    return { year, month: year === now.year ? now.month : 1, whole, day: null };
  }
  const month = monthNumber(monthWord);
  if (month === null) return 'illegal month value: use 1-12';
  const dayWord = args[args.length - 3];
  if (dayWord === undefined) return { year, month, whole: ctx.opts.year === true, day: null };
  const day = /^\d+$/.test(dayWord) ? Number(dayWord) : 0;
  if (day < 1 || day > daysIn(year, month)) return 'illegal day value: use 1-31';
  return { year, month, whole: ctx.opts.year === true, day };
}

export async function run(ctx: CommandContext): Promise<ExitCode> {
  if (ctx.args.length > 3) return ctx.usage(`extra operand '${ctx.args[3] ?? ''}'`);
  const now = wallClock(ctx, ctx.clock.now());
  const want = asked(ctx, now);
  if (typeof want === 'string') return ctx.fail(want);
  const { year, month, whole, day } = want;
  const monday = ctx.opts.monday === true && ctx.opts.sunday !== true;
  // The DAY asked for, in its month; without one, today, wherever it shows.
  const markIn = (y: number, m: number): number | null => {
    if (day !== null) return y === year && m === month ? day : null;
    return y === now.year && m === now.month ? now.day : null;
  };

  const perRow = monthsPerRow(ctx);
  let rows: Row[];
  if (whole) {
    const months = Array.from({ length: 12 }, (_, i) => monthRows(year, i + 1, { monday, mark: markIn(year, i + 1), withYear: false }));
    rows = [[{ text: centred(String(year), WIDTH * perRow + GAP.length * (perRow - 1)) }], [], ...inRows(months, perRow)];
  } else if (ctx.opts.three === true) {
    const around = [-1, 0, 1]
      .map((step) => {
        const index = year * 12 + (month - 1) + step;
        return { y: Math.floor(index / 12), m: (index % 12) + 1 };
      })
      .filter(({ y }) => y >= 1 && y <= 9999);
    rows = inRows(
      around.map(({ y, m }) => monthRows(y, m, { monday, mark: markIn(y, m), withYear: true })),
      perRow,
    );
  } else {
    rows = monthRows(year, month, { monday, mark: markIn(year, month), withYear: true });
  }

  const tty = ctx.stdout.isTTY;
  const lines: Line[] = rows.map((row) => trimRow(row).map((piece) => out.span(piece.text, piece.today === true && tty ? TODAY : undefined)));
  if (tty) await ctx.stdout.block(out.lines(lines));
  else await ctx.stdout.write(`${lines.map((line) => line.map((span) => span.text).join('')).join('\n')}\n`);
  return 0;
}

/** A row without its trailing spaces. */
function trimRow(row: Row): Row {
  const pieces = row.filter((piece) => piece.text !== '');
  while (pieces.length > 0) {
    const last = pieces[pieces.length - 1];
    if (last === undefined || last.today === true) break;
    const trimmed = last.text.trimEnd();
    if (trimmed === '') {
      pieces.pop();
      continue;
    }
    pieces[pieces.length - 1] = { text: trimmed };
    break;
  }
  return pieces;
}
