import { alignmentCentres, ECC_FORMAT_BITS, symbolSize } from './tables';
import type { EccLevel, MaskId, Version } from './types';
/** Mutable working grid used only during encoding. modules: 1 = dark. fn: 1 = function module (never masked). */
export class WorkGrid {
  readonly size: number; readonly modules: Uint8Array; readonly fn: Uint8Array;
  constructor(readonly version: Version) { this.size = symbolSize(version); this.modules = new Uint8Array(this.size * this.size); this.fn = new Uint8Array(this.size * this.size); }
  get(x: number, y: number): number { return this.modules[y * this.size + x]; }
  setFn(x: number, y: number, dark: boolean): void { const i = y * this.size + x; this.modules[i] = dark ? 1 : 0; this.fn[i] = 1; }
  drawFunctionPatterns(): void {
    const n = this.size;
    for (let i = 0; i < n; i++) { this.setFn(6, i, i % 2 === 0); this.setFn(i, 6, i % 2 === 0); }
    this.finder(3, 3); this.finder(n - 4, 3); this.finder(3, n - 4);
    const a = alignmentCentres(this.version); const k = a.length;
    for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) if (!((i === 0 && j === 0) || (i === 0 && j === k - 1) || (i === k - 1 && j === 0))) this.alignment(a[i], a[j]);
    this.drawFormat('M', 0); // reserve
    this.drawVersion();
  }
  private finder(cx: number, cy: number) { for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const d = Math.max(Math.abs(dx), Math.abs(dy)); const x = cx + dx, y = cy + dy; if (x >= 0 && x < this.size && y >= 0 && y < this.size) this.setFn(x, y, d !== 2 && d !== 4); } }
  private alignment(cx: number, cy: number) { for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) this.setFn(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1); }
  drawFormat(ecc: EccLevel, mask: MaskId): void {
    const data = (ECC_FORMAT_BITS[ecc] << 3) | mask; let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412; const bit = (i: number) => ((bits >>> i) & 1) === 1; const n = this.size;
    for (let i = 0; i <= 5; i++) this.setFn(8, i, bit(i));
    this.setFn(8, 7, bit(6)); this.setFn(8, 8, bit(7)); this.setFn(7, 8, bit(8));
    for (let i = 9; i < 15; i++) this.setFn(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) this.setFn(n - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) this.setFn(8, n - 15 + i, bit(i));
    this.setFn(8, n - 8, true); // dark module
  }
  private drawVersion(): void {
    if (this.version < 7) return; let rem = this.version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (this.version << 12) | rem;
    for (let i = 0; i < 18; i++) { const d = ((bits >>> i) & 1) === 1; const a = this.size - 11 + (i % 3), b = Math.floor(i / 3); this.setFn(a, b, d); this.setFn(b, a, d); }
  }
  placeCodewords(cw: Uint8Array): void {
    const n = this.size; let i = 0;
    for (let right = n - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < n; vert++) for (let j = 0; j < 2; j++) {
        const x = right - j; const upward = ((right + 1) & 2) === 0; const y = upward ? n - 1 - vert : vert; const idx = y * n + x;
        if (!this.fn[idx] && i < cw.length * 8) { this.modules[idx] = (cw[i >>> 3] >>> (7 - (i & 7))) & 1; i++; }
      }
    }
  }
}
