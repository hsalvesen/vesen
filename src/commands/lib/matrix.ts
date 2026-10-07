// cmatrix's rain: what the Matrix app (src/ui/apps/Matrix.svelte) draws through tty.fullscreen,
// and the still screen cmatrix prints in a pipe, or wherever no full-screen app can show.

/** Half-width katakana (all but ﾛ, which looks like a missing glyph), digits and a few signs: narrow characters, one cell each. */
export const MATRIX_GLYPHS =
  'ｦｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾜﾝ0123456789Z:.=*+-<>¦|';

/** What cmatrix hands the Matrix app. */
export interface MatrixView {
  /** The characters that fall. */
  readonly glyphs: string;
  /** Milliseconds between steps of the rain: -u's delay. */
  readonly stepMs: number;
  /** A touch screen: the hint says tap; a keyboard: any key. */
  readonly touch: boolean;
}

/** The step for each -u delay, 0 (fastest) to 10. */
export function stepFor(delay: number): number {
  const d = Math.max(0, Math.min(10, Math.round(delay)));
  return 20 + d * 15;
}

/**
 * A still screen of rain, `rows` by `columns`: some columns carry a streak of glyphs ending at a
 * random row, the rest are empty. `random` gives numbers in [0, 1).
 */
export function stillRain(columns: number, rows: number, random: () => number, glyphs: string = MATRIX_GLYPHS): string[] {
  const chars = Array.from(glyphs);
  const pick = (): string => chars[Math.floor(random() * chars.length)] ?? '0';
  const grid: string[][] = Array.from({ length: rows }, () => Array.from({ length: columns }, () => ' '));
  for (let c = 0; c < columns; c += 2) {
    if (random() < 0.35) continue;
    const end = Math.floor(random() * (rows + 4));
    const length = 3 + Math.floor(random() * rows);
    for (let r = Math.max(0, end - length); r <= Math.min(rows - 1, end); r += 1) {
      const row = grid[r];
      if (row !== undefined) row[c] = pick();
    }
  }
  return grid.map((row) => row.join('').trimEnd());
}
