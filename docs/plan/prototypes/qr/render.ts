import type { QrSymbol } from './types';
const dark = (s: QrSymbol, x: number, y: number) => x >= 0 && y >= 0 && x < s.size && y < s.size && s.modules[y * s.size + x] === 1;
/** One <path> d-string: each horizontal run of dark modules becomes "M x y h w v1 h-w z". Coordinates include the quiet zone. */
export function toSvgPath(s: QrSymbol, quiet = 4): string {
  let d = '';
  for (let y = 0; y < s.size; y++) { let x = 0; while (x < s.size) { if (!dark(s, x, y)) { x++; continue; } let w = 1; while (dark(s, x + w, y)) w++; d += `M${x + quiet} ${y + quiet}h${w}v1h-${w}z`; x += w; } }
  return d;
}
export function toSvg(s: QrSymbol, o: { quiet?: number; dark?: string; light?: string; title?: string } = {}): string {
  const q = o.quiet ?? 4, n = s.size + 2 * q;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" role="img" aria-label="${o.title ?? 'QR code'}"><rect width="${n}" height="${n}" fill="${o.light ?? '#fff'}"/><path d="${toSvgPath(s, q)}" fill="${o.dark ?? '#000'}"/></svg>`;
}
/** Half-block text. paintLight=true draws LIGHT modules as glyphs (for light-on-dark terminals), so polarity stays correct. */
export function toHalfBlocks(s: QrSymbol, o: { quiet?: number; paintLight?: boolean } = {}): string[] {
  const q = o.quiet ?? 2, n = s.size + 2 * q, lines: string[] = [];
  const on = (x: number, y: number) => { const d = dark(s, x - q, y - q); return o.paintLight ? !d : d; };
  for (let y = 0; y < n; y += 2) { let l = ''; for (let x = 0; x < n; x++) { const t = on(x, y), b = y + 1 < n ? on(x, y + 1) : !!o.paintLight && false; l += t && b ? '█' : t ? '▀' : b ? '▄' : ' '; } lines.push(l); }
  return lines;
}
/** RGBA raster for canvas/PNG export and for decoder round-trip tests. */
export function toRgba(s: QrSymbol, scale: number, quiet = 4): { width: number; height: number; data: Uint8ClampedArray } {
  const n = (s.size + 2 * quiet) * scale, data = new Uint8ClampedArray(n * n * 4).fill(255);
  for (let y = 0; y < s.size; y++) for (let x = 0; x < s.size; x++) if (s.modules[y * s.size + x]) for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) { const p = (((y + quiet) * scale + dy) * n + (x + quiet) * scale + dx) * 4; data[p] = data[p + 1] = data[p + 2] = 0; }
  return { width: n, height: n, data };
}
