// Module placement (ISO 18004 sections 6.3 and 7.7 to 7.9). Coordinates are x = column, y = row.
import { alignmentCentres, ECC_FORMAT_BITS, symbolSize } from './tables';
import type { EccLevel, MaskId, Version } from './types';

/** The 15-bit format information for a level and mask: BCH(15,5) with generator 0x537, XORed with 0x5412. */
export function formatBits(ecc: EccLevel, mask: MaskId): number {
  const data = (ECC_FORMAT_BITS[ecc] << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | (rem & 0x3ff)) ^ 0x5412;
}

/** The 18-bit version information for v ≥ 7: BCH(18,6) with generator 0x1F25. */
export function versionBits(v: Version): number {
  let rem = v;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (v << 12) | (rem & 0xfff);
}

/** The grid an encode works on. modules: 1 = dark. fn: 1 = function module, which masks skip. */
export class WorkGrid {
  readonly version: Version;
  readonly size: number;
  readonly modules: Uint8Array;
  readonly fn: Uint8Array;

  constructor(version: Version) {
    this.version = version;
    this.size = symbolSize(version);
    this.modules = new Uint8Array(this.size * this.size);
    this.fn = new Uint8Array(this.size * this.size);
  }

  private setFn(x: number, y: number, dark: boolean): void {
    const i = y * this.size + x;
    this.modules[i] = dark ? 1 : 0;
    this.fn[i] = 1;
  }

  /** Finders with separators, timing, alignment, reserved format area, dark module and version information. */
  drawFunctionPatterns(): void {
    const n = this.size;
    for (let i = 0; i < n; i++) {
      this.setFn(6, i, i % 2 === 0);
      this.setFn(i, 6, i % 2 === 0);
    }
    this.finder(3, 3);
    this.finder(n - 4, 3);
    this.finder(3, n - 4);
    const centres = alignmentCentres(this.version);
    const k = centres.length;
    for (let i = 0; i < k; i++) {
      for (let j = 0; j < k; j++) {
        const onFinder = (i === 0 && j === 0) || (i === 0 && j === k - 1) || (i === k - 1 && j === 0);
        if (!onFinder) this.alignment(centres[i]!, centres[j]!);
      }
    }
    // Reserve the format area now; the real bits are drawn once the mask is known.
    this.drawFormat('M', 0);
    this.drawVersion();
  }

  /** A finder pattern centred at (cx, cy), with its light separator where it lies inside the symbol. */
  private finder(cx: number, cy: number): void {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && x < this.size && y >= 0 && y < this.size) this.setFn(x, y, d !== 2 && d !== 4);
      }
    }
  }

  private alignment(cx: number, cy: number): void {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) this.setFn(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }

  /** Both copies of the format information, and the dark module at (8, size - 8). */
  drawFormat(ecc: EccLevel, mask: MaskId): void {
    const bits = formatBits(ecc, mask);
    const bit = (i: number): boolean => ((bits >>> i) & 1) === 1;
    const n = this.size;
    // Around the top-left finder.
    for (let i = 0; i <= 5; i++) this.setFn(8, i, bit(i));
    this.setFn(8, 7, bit(6));
    this.setFn(8, 8, bit(7));
    this.setFn(7, 8, bit(8));
    for (let i = 9; i < 15; i++) this.setFn(14 - i, 8, bit(i));
    // Split between the top-right and bottom-left finders.
    for (let i = 0; i < 8; i++) this.setFn(n - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) this.setFn(8, n - 15 + i, bit(i));
    this.setFn(8, n - 8, true);
  }

  private drawVersion(): void {
    if (this.version < 7) return;
    const bits = versionBits(this.version);
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) === 1;
      const a = this.size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      this.setFn(a, b, dark);
      this.setFn(b, a, dark);
    }
  }

  /** Places codewords in the two-column zig-zag from the bottom right, skipping the vertical timing column. */
  placeCodewords(codewords: Uint8Array): void {
    const n = this.size;
    const total = codewords.length * 8;
    let i = 0;
    for (let right = n - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      const upward = ((right + 1) & 2) === 0;
      for (let step = 0; step < n; step++) {
        const y = upward ? n - 1 - step : step;
        for (let j = 0; j < 2; j++) {
          const idx = y * n + right - j;
          if (this.fn[idx]) continue;
          // Remainder bits past the last codeword stay light.
          if (i < total) {
            this.modules[idx] = (codewords[i >>> 3]! >>> (7 - (i & 7))) & 1;
            i++;
          }
        }
      }
    }
  }
}
