// Text art: half-block glyphs pack two module rows into one line, so modules come out square in
// a monospace font whose line height is about twice its advance width.
import type { QrSymbol } from '../types';

/**
 * - 'utf8i': dark modules are drawn as glyphs. On a light-on-dark terminal that shows the code
 *   inverted; it is what the legacy `qr` command prints.
 * - 'utf8': light modules are drawn as glyphs, so the terminal background is the ink.
 * - 'ascii': '##' for each dark module, one line per row.
 */
export type TextStyle = 'utf8' | 'utf8i' | 'ascii';

export interface TextOptions {
  style: TextStyle;
  /** Quiet zone in modules. Default 2. */
  margin?: number;
  /**
   * When the module rows are odd, the half line below the art is drawn light: half a module more
   * quiet zone. For art drawn on an ink field (the card's utf8), whose last line would otherwise
   * end in a band of ink under the bottom quiet zone. utf8 only: utf8i's quiet zone is the
   * field itself, and ascii is a line a row.
   */
  padLight?: boolean;
}

type Matrix = Pick<QrSymbol, 'size' | 'modules'>;

const FULL = '█';
const UPPER = '▀';
const LOWER = '▄';

function marginOf(o: TextOptions): number {
  const m = o.margin ?? 2;
  if (!Number.isInteger(m) || m < 0) throw new RangeError(`margin must be a whole number ≥ 0 (got ${m})`);
  return m;
}

/** The symbol as lines of text. Lines keep their trailing spaces, so every line is the same width. */
export function toText(qr: Matrix, o: TextOptions): string[] {
  const m = marginOf(o);
  const n = qr.size + 2 * m;
  const dark = (x: number, y: number): boolean => {
    const cx = x - m;
    const cy = y - m;
    return cx >= 0 && cy >= 0 && cx < qr.size && cy < qr.size && qr.modules[cy * qr.size + cx] === 1;
  };
  const lines: string[] = [];

  if (o.style === 'ascii') {
    for (let y = 0; y < n; y++) {
      let line = '';
      for (let x = 0; x < n; x++) line += dark(x, y) ? '##' : '  ';
      lines.push(line);
    }
    return lines;
  }

  const paintDark = o.style === 'utf8i';
  // A cell below the last row lies outside the art: unpainted, or light when asked to pad.
  const padBelow = o.padLight === true && !paintDark;
  const painted = (x: number, y: number): boolean => (y < n ? dark(x, y) === paintDark : padBelow);
  for (let y = 0; y < n; y += 2) {
    let line = '';
    for (let x = 0; x < n; x++) {
      const top = painted(x, y);
      const bottom = painted(x, y + 1);
      line += top && bottom ? FULL : top ? UPPER : bottom ? LOWER : ' ';
    }
    lines.push(line);
  }
  return lines;
}

/** How many terminal columns the text art needs. */
export function textColumns(qr: Pick<QrSymbol, 'size'>, o: TextOptions): number {
  const n = qr.size + 2 * marginOf(o);
  return o.style === 'ascii' ? n * 2 : n;
}
