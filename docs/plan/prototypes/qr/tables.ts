import type { EccLevel, SegmentMode, Version } from './types';
export const ECC_ORDER: readonly EccLevel[] = ['L', 'M', 'Q', 'H'];
export const ECC_FORMAT_BITS: Record<EccLevel, number> = { L: 1, M: 0, Q: 3, H: 2 };
// ISO/IEC 18004:2015 Table 9, indexed [ecc][version]; index 0 unused.
export const EC_CODEWORDS_PER_BLOCK: Record<EccLevel, readonly number[]> = {
  L: [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  M: [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  Q: [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  H: [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
};
export const EC_BLOCKS: Record<EccLevel, readonly number[]> = {
  L: [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  M: [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  Q: [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  H: [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
};
export const MODE_INDICATOR: Record<SegmentMode, number> = { numeric: 0x1, alphanumeric: 0x2, byte: 0x4 };
const CC_BITS: Record<SegmentMode, readonly [number, number, number]> = { numeric: [10, 12, 14], alphanumeric: [9, 11, 13], byte: [8, 16, 16] };
export const symbolSize = (v: Version) => v * 4 + 17;
export const charCountBits = (m: SegmentMode, v: Version) => CC_BITS[m][v <= 9 ? 0 : v <= 26 ? 1 : 2];
/** Modules available for data+EC after function patterns and format/version info. */
export function rawDataModules(v: Version): number {
  let r = (16 * v + 128) * v + 64;
  if (v >= 2) { const n = Math.floor(v / 7) + 2; r -= (25 * n - 10) * n - 55; if (v >= 7) r -= 36; }
  return r;
}
export const totalCodewords = (v: Version) => rawDataModules(v) >> 3;
export const dataCodewords = (v: Version, e: EccLevel) => totalCodewords(v) - EC_CODEWORDS_PER_BLOCK[e][v] * EC_BLOCKS[e][v];
export function alignmentCentres(v: Version): number[] {
  if (v === 1) return [];
  const n = Math.floor(v / 7) + 2; const step = Math.floor((v * 8 + n * 3 + 5) / (n * 4 - 4)) * 2;
  const out = [6]; for (let p = symbolSize(v) - 7; out.length < n; p -= step) out.splice(1, 0, p);
  return out;
}
