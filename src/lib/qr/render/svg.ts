// SVG: a paper rectangle and one stroked path. Each horizontal run of dark modules is a
// one-module-wide stroke along the middle of its row, written with relative moves, which keeps
// the markup about three times smaller than filled rectangles. The viewBox is in modules and
// includes the quiet zone, so the image scales without blurring under crispEdges.
import type { QrSymbol } from '../types';

type Matrix = Pick<QrSymbol, 'size' | 'modules'>;

export interface SvgPalette {
  ink: string;
  paper: string;
}

export interface SvgOptions {
  /** Quiet zone in modules. Default 4. */
  margin?: number;
  /**
   * Literal colours (default black on white, which exports always use), or 'css-vars' to draw
   * with the theme's --role-qr-ink and --role-qr-paper, falling back to black on white.
   */
  palette?: SvgPalette | 'css-vars';
  /** Accessible name. Without it the image is decorative (aria-hidden). */
  title?: string;
}

const BLACK_ON_WHITE: SvgPalette = { ink: '#000', paper: '#fff' };

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function checkedMargin(margin: number | undefined): number {
  const m = margin ?? 4;
  if (!Number.isInteger(m) || m < 0) throw new RangeError(`margin must be a whole number ≥ 0 (got ${m})`);
  return m;
}

/** The path data: `M x y+.5 h len` for the first run, then `m dx dy h len` for each run after it. */
export function toSvgPath(qr: Matrix, margin = 4): string {
  const m = checkedMargin(margin);
  const n = qr.size;
  let d = '';
  // Pen position after the last run, in module units.
  let penX = 0;
  let penY = 0;
  for (let y = 0; y < n; y++) {
    let x = 0;
    while (x < n) {
      if (qr.modules[y * n + x] !== 1) {
        x++;
        continue;
      }
      let len = 1;
      while (x + len < n && qr.modules[y * n + x + len] === 1) len++;
      const sx = x + m;
      const sy = y + m + 0.5;
      d += d === '' ? `M${sx} ${sy}h${len}` : `m${sx - penX} ${sy - penY}h${len}`;
      penX = sx + len;
      penY = sy;
      x += len;
    }
  }
  return d;
}

export function toSvg(qr: Matrix, o: SvgOptions = {}): string {
  const m = checkedMargin(o.margin);
  const side = qr.size + 2 * m;
  const palette = o.palette ?? BLACK_ON_WHITE;
  const paper =
    palette === 'css-vars' ? ' style="fill:var(--role-qr-paper,#fff)"' : ` fill="${escapeXml(palette.paper)}"`;
  const ink =
    palette === 'css-vars' ? ' style="stroke:var(--role-qr-ink,#000)"' : ` stroke="${escapeXml(palette.ink)}"`;
  const label = o.title === undefined ? ' aria-hidden="true"' : ` role="img" aria-label="${escapeXml(o.title)}"`;
  const title = o.title === undefined ? '' : `<title>${escapeXml(o.title)}</title>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${side} ${side}" shape-rendering="crispEdges"${label}>` +
    title +
    `<rect width="${side}" height="${side}"${paper}/>` +
    `<path d="${toSvgPath(qr, m)}" fill="none" stroke-width="1"${ink}/>` +
    `</svg>`
  );
}
