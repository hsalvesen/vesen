// Capacity and layout tables from ISO/IEC 18004:2015. Arrays are indexed by version; index 0 is unused.
import type { EccLevel, SegmentMode, Version } from './types';

export const MIN_VERSION = 1;
export const MAX_VERSION = 40;

/** Levels from weakest to strongest, the order an EC boost walks. */
export const ECC_ORDER: readonly EccLevel[] = ['L', 'M', 'Q', 'H'];

/** The two error-correction bits of the format information (Table 12). */
export const ECC_FORMAT_BITS: Readonly<Record<EccLevel, number>> = { L: 1, M: 0, Q: 3, H: 2 };

/** Table 9: error-correction codewords per block. */
export const EC_CODEWORDS_PER_BLOCK: Readonly<Record<EccLevel, readonly number[]>> = {
  L: [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  M: [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  Q: [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  H: [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
};

/** Table 9: number of error-correction blocks. */
export const EC_BLOCKS: Readonly<Record<EccLevel, readonly number[]>> = {
  L: [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  M: [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  Q: [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  H: [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
};

/** Table 2: mode indicators. */
export const MODE_INDICATOR: Readonly<Record<SegmentMode, number>> = { numeric: 0x1, alphanumeric: 0x2, byte: 0x4 };

/** Table 3: character count bits for versions 1-9, 10-26 and 27-40. */
const CC_BITS: Readonly<Record<SegmentMode, readonly [number, number, number]>> = {
  numeric: [10, 12, 14],
  alphanumeric: [9, 11, 13],
  byte: [8, 16, 16],
};

export function isVersion(v: unknown): v is Version {
  return typeof v === 'number' && Number.isInteger(v) && v >= MIN_VERSION && v <= MAX_VERSION;
}

/** Modules per side, without the quiet zone. */
export function symbolSize(v: Version): number {
  return v * 4 + 17;
}

/** Which of Table 3's three version bands `v` falls in. */
export function versionBand(v: Version): 0 | 1 | 2 {
  return v <= 9 ? 0 : v <= 26 ? 1 : 2;
}

export function charCountBits(mode: SegmentMode, v: Version): number {
  return CC_BITS[mode][versionBand(v)];
}

/** Modules left for data and error correction once function patterns, format and version information are placed. */
export function rawDataModules(v: Version): number {
  let r = (16 * v + 128) * v + 64;
  if (v >= 2) {
    const n = Math.floor(v / 7) + 2;
    r -= (25 * n - 10) * n - 55;
    if (v >= 7) r -= 36;
  }
  return r;
}

/** All codewords in the symbol (remainder bits dropped). */
export function totalCodewords(v: Version): number {
  return rawDataModules(v) >> 3;
}

export function ecCodewordsPerBlock(v: Version, ecc: EccLevel): number {
  return EC_CODEWORDS_PER_BLOCK[ecc][v] ?? 0;
}

export function ecBlocks(v: Version, ecc: EccLevel): number {
  return EC_BLOCKS[ecc][v] ?? 0;
}

/** Data codewords at this version and level. */
export function dataCodewords(v: Version, ecc: EccLevel): number {
  return totalCodewords(v) - ecCodewordsPerBlock(v, ecc) * ecBlocks(v, ecc);
}

/** Row and column centres of the alignment patterns (Annex E), ascending. */
export function alignmentCentres(v: Version): number[] {
  if (v === 1) return [];
  const n = Math.floor(v / 7) + 2;
  const step = Math.floor((v * 8 + n * 3 + 5) / (n * 4 - 4)) * 2;
  const out = [6];
  for (let p = symbolSize(v) - 7; out.length < n; p -= step) out.splice(1, 0, p);
  return out;
}

/** Most characters (digits, alphanumeric characters or bytes) one segment of `mode` can hold at this version and level. */
export function maxPayloadChars(ecc: EccLevel, mode: SegmentMode = 'byte', v: Version = MAX_VERSION): number {
  const bits = dataCodewords(v, ecc) * 8 - 4 - charCountBits(mode, v);
  let chars: number;
  if (mode === 'numeric') {
    chars = Math.floor(bits / 10) * 3;
    const rest = bits % 10;
    chars += rest >= 7 ? 2 : rest >= 4 ? 1 : 0;
  } else if (mode === 'alphanumeric') {
    chars = Math.floor(bits / 11) * 2 + (bits % 11 >= 6 ? 1 : 0);
  } else {
    chars = Math.floor(bits / 8);
  }
  return Math.min(chars, (1 << charCountBits(mode, v)) - 1);
}

/** Byte-mode capacity, the figure error messages quote (v40: L 2953, M 2331, Q 1663, H 1273). */
export function maxPayloadBytes(ecc: EccLevel, v: Version = MAX_VERSION): number {
  return maxPayloadChars(ecc, 'byte', v);
}
