// The quote card's chart and range bars, drawn in ASCII on the character grid, as a text-mode
// terminal draws them: the closes traced as a line of _ - ' (a point at the bottom, middle or top
// of its row) joined by / and \ where it climbs or falls, a dotted comparison line, and the last
// point marked o. Pure, so the card (ui/components/Sparkline.svelte) and the plain text for pipes
// (text.ts) draw the same rows.

export type Tone = 'up' | 'down' | 'flat';

/** A cell's colour: above or below the comparison line (the chart's tone without one), the line, or the last point. */
export type ChartTone = Tone | 'base' | 'last';

/** Cells of one row that share a tone. */
export interface ChartRun {
  readonly text: string;
  readonly tone: ChartTone;
}

export interface ChartSize {
  readonly columns: number;
  readonly rows: number;
}

/** The card's chart: 32 columns fit a 320 px phone with room to spare, five rows give fifteen levels. */
export const CARD_CHART: ChartSize = { columns: 32, rows: 5 };

/** The table's chart beside each row. */
export const MINI_CHART: ChartSize = { columns: 12, rows: 2 };

/** A point's glyph by where it sits in its row: the bottom, the middle, the top. */
const LEVELS = "_-'";

/** `count` of `values` spread evenly, the first and the last kept; all of them when there are fewer. */
export function sample(values: readonly number[], count: number): number[] {
  if (values.length <= count) return [...values];
  const picked: number[] = [];
  for (let i = 0; i < count; i += 1) picked.push(values[Math.round((i * (values.length - 1)) / (count - 1))] ?? 0);
  return picked;
}

interface Cell {
  ch: string;
  tone: ChartTone;
}

/** A row's cells as runs, trailing spaces left off; spaces join the run beside them. */
function runs(cells: readonly Cell[]): ChartRun[] {
  const row: { text: string; tone: ChartTone }[] = [];
  let end = cells.length;
  while (end > 0 && cells[end - 1]?.ch === ' ') end -= 1;
  for (const { ch, tone } of cells.slice(0, end)) {
    const last = row[row.length - 1];
    if (last !== undefined && (ch === ' ' || last.tone === tone || last.text.trim() === '')) {
      last.text += ch;
      if (ch !== ' ') last.tone = tone;
    } else row.push({ text: ch, tone: ch === ' ' ? 'base' : tone });
  }
  return row;
}

/**
 * `values` traced over `size`, top row first, with `baseline` as a dotted line where it is given.
 * Each column is one sampled value; a column takes the up or down tone by its value against the
 * baseline, or `tone` for the whole chart without one. Null with fewer than two values.
 */
export function traceChart(values: readonly number[], baseline: number | null, size: ChartSize, tone: Tone): ChartRun[][] | null {
  const picked = sample(values, size.columns);
  if (picked.length < 2) return null;
  const all = baseline === null ? picked : [...picked, baseline];
  let low = Math.min(...all);
  let high = Math.max(...all);
  if (high - low < 1e-9) {
    low -= 1;
    high += 1;
  }
  const level = (value: number): number => Math.round(((value - low) / (high - low)) * (size.rows * 3 - 1));
  // Rows from the bottom up, each a cell a column.
  const grid: Cell[][] = Array.from({ length: size.rows }, () => picked.map((): Cell => ({ ch: ' ', tone: 'base' })));
  const set = (row: number, column: number, ch: string, cellTone: ChartTone): void => {
    const cell = grid[row]?.[column];
    if (cell !== undefined) {
      cell.ch = ch;
      cell.tone = cellTone;
    }
  };
  if (baseline !== null) {
    const row = Math.floor(level(baseline) / 3);
    picked.forEach((_, c) => set(row, c, '.', 'base'));
  }
  let previous: { row: number; sub: number } | null = null;
  picked.forEach((value, c) => {
    const at = level(value);
    const row = Math.floor(at / 3);
    const sub = at % 3;
    const cellTone: ChartTone = baseline === null ? tone : value >= baseline ? 'up' : 'down';
    if (previous !== null) {
      // A climb or a fall is joined across the rows between; a point at the top of its row is
      // joined from the row above it, one at the bottom from the row below, so the slash meets it.
      if (row > previous.row) {
        for (let r = previous.sub === 2 ? previous.row + 1 : previous.row; r < row; r += 1) set(r, c, '/', cellTone);
      } else if (row < previous.row) {
        for (let r = row + 1; r <= (previous.sub === 0 ? previous.row - 1 : previous.row); r += 1) set(r, c, '\\', cellTone);
      }
    }
    const lastPoint = c === picked.length - 1;
    set(row, c, lastPoint ? 'o' : LEVELS[sub] ?? '-', lastPoint ? 'last' : cellTone);
    previous = { row, sub };
  });
  return grid.reverse().map(runs);
}

/** The rows as plain text, for a pipe. */
export function chartLines(rows: readonly (readonly ChartRun[])[]): string[] {
  return rows.map((row) => row.map((run) => run.text).join(''));
}

/** Cells inside a range bar's brackets. */
export const TRACK_CELLS = 7;

/** `[--*----]`: where a price sits in a range, `at` percent along a track of TRACK_CELLS. */
export function trackText(at: number): string {
  const index = Math.round((Math.min(100, Math.max(0, at)) / 100) * (TRACK_CELLS - 1));
  return `[${'-'.repeat(index)}*${'-'.repeat(TRACK_CELLS - 1 - index)}]`;
}
