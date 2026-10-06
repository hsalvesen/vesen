// A small, independent QR reader for tests: it reads a module matrix (not an image) back to
// bytes. Format information, unmasking, the codeword zig-zag, de-interleaving, the Reed-Solomon
// syndromes and the segment parser are written here from the standard, separately from the
// encoder, so an encoder bug cannot cancel itself out. Only the version tables are shared.
import { gfExp, gfMul } from '../../src/lib/qr/gf256';
import { alignmentCentres, dataCodewords, EC_BLOCKS, EC_CODEWORDS_PER_BLOCK, totalCodewords } from '../../src/lib/qr/tables';
import type { EccLevel, MaskId } from '../../src/lib/qr/types';

export interface DecodedSymbol {
  version: number;
  ecc: EccLevel;
  mask: MaskId;
  /** The payload bytes, numeric and alphanumeric characters as ASCII. */
  bytes: Uint8Array;
  segments: { mode: 'numeric' | 'alphanumeric' | 'byte'; count: number }[];
}

const LEVEL_FROM_BITS: readonly EccLevel[] = ['M', 'L', 'H', 'Q'];
const ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

/** The 32 valid format words, computed by polynomial division over GF(2). */
function formatWord(data5: number): number {
  let rem = data5 << 10;
  for (let bit = 14; bit >= 10; bit--) if (rem & (1 << bit)) rem ^= 0x537 << (bit - 10);
  return ((data5 << 10) | rem) ^ 0x5412;
}

function readFormat(get: (x: number, y: number) => number, n: number): { ecc: EccLevel; mask: MaskId } {
  // First copy, bit 14 first, around the top-left finder.
  const coordsA: [number, number][] = [];
  for (let x = 0; x <= 5; x++) coordsA.push([x, 8]);
  coordsA.push([7, 8], [8, 8], [8, 7]);
  for (let y = 5; y >= 0; y--) coordsA.push([8, y]);
  // Second copy, bit 14 first: down the left of the bottom-left finder, then along the top-right one.
  const coordsB: [number, number][] = [];
  for (let y = n - 1; y >= n - 7; y--) coordsB.push([8, y]);
  for (let x = n - 8; x <= n - 1; x++) coordsB.push([x, 8]);

  const read = (coords: [number, number][]): number => coords.reduce((acc, [x, y]) => (acc << 1) | get(x, y), 0);
  const a = read(coordsA);
  const b = read(coordsB);
  if (a !== b) throw new Error(`format copies differ: ${a.toString(2)} vs ${b.toString(2)}`);
  for (let data5 = 0; data5 < 32; data5++) {
    if (formatWord(data5) === a) return { ecc: LEVEL_FROM_BITS[data5 >> 3]!, mask: (data5 & 7) as MaskId };
  }
  throw new Error(`invalid format word ${a.toString(2)}`);
}

function maskBit(mask: MaskId, row: number, col: number): boolean {
  switch (mask) {
    case 0: return (row + col) % 2 === 0;
    case 1: return row % 2 === 0;
    case 2: return col % 3 === 0;
    case 3: return (row + col) % 3 === 0;
    case 4: return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;
    case 5: return ((row * col) % 2) + ((row * col) % 3) === 0;
    case 6: return (((row * col) % 2) + ((row * col) % 3)) % 2 === 0;
    default: return (((row + col) % 2) + ((row * col) % 3)) % 2 === 0;
  }
}

/** Marks every module that carries no data: finders, separators, timing, alignment, format, version and dark module. */
function functionModules(version: number): Uint8Array {
  const n = version * 4 + 17;
  const fn = new Uint8Array(n * n);
  const mark = (x: number, y: number): void => {
    if (x >= 0 && y >= 0 && x < n && y < n) fn[y * n + x] = 1;
  };
  for (const [fx, fy] of [[0, 0], [n - 7, 0], [0, n - 7]] as const) {
    for (let dy = -1; dy <= 7; dy++) for (let dx = -1; dx <= 7; dx++) mark(fx + dx, fy + dy);
  }
  for (let i = 0; i < n; i++) {
    mark(6, i);
    mark(i, 6);
  }
  const centres = alignmentCentres(version);
  for (const cy of centres) {
    for (const cx of centres) {
      const nearFinder = (cx < 9 && cy < 9) || (cx > n - 10 && cy < 9) || (cx < 9 && cy > n - 10);
      if (nearFinder) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) mark(cx + dx, cy + dy);
    }
  }
  for (let i = 0; i < 9; i++) {
    mark(8, i);
    mark(i, 8);
  }
  for (let i = 0; i < 8; i++) {
    mark(n - 1 - i, 8);
    mark(8, n - 1 - i);
  }
  if (version >= 7) {
    for (let a = 0; a < 6; a++) {
      for (let b = n - 11; b < n - 8; b++) {
        mark(a, b);
        mark(b, a);
      }
    }
  }
  return fn;
}

function syndromesZero(block: readonly number[], ecLen: number): boolean {
  for (let i = 0; i < ecLen; i++) {
    let s = 0;
    for (const c of block) s = gfMul(s, gfExp(i)) ^ c;
    if (s !== 0) return false;
  }
  return true;
}

class BitReader {
  private pos = 0;
  constructor(private readonly bytes: readonly number[]) {}
  get remaining(): number {
    return this.bytes.length * 8 - this.pos;
  }
  read(len: number): number {
    let v = 0;
    for (let i = 0; i < len; i++, this.pos++) {
      const byte = this.bytes[this.pos >>> 3] ?? 0;
      v = (v << 1) | ((byte >>> (7 - (this.pos & 7))) & 1);
    }
    return v;
  }
}

function countBits(mode: number, version: number): number {
  const band = version <= 9 ? 0 : version <= 26 ? 1 : 2;
  if (mode === 1) return [10, 12, 14][band]!;
  if (mode === 2) return [9, 11, 13][band]!;
  return [8, 16, 16][band]!;
}

/** Reads a symbol back to its payload. Throws on any structural error. */
export function decodeMatrix(modules: Uint8Array, size: number): DecodedSymbol {
  const version = (size - 17) / 4;
  if (!Number.isInteger(version) || version < 1 || version > 40) throw new Error(`bad size ${size}`);
  const get = (x: number, y: number): number => modules[y * size + x] ?? 0;
  const { ecc, mask } = readFormat(get, size);

  if (version >= 7) {
    let bits = 0;
    for (let i = 17; i >= 0; i--) bits = (bits << 1) | get(size - 11 + (i % 3), Math.floor(i / 3));
    if (bits >>> 12 !== version) throw new Error(`version information says ${bits >>> 12}, size says ${version}`);
  }

  // Read the zig-zag: column pairs from the right, skipping the timing column.
  const fn = functionModules(version);
  const raw: number[] = [];
  let acc = 0;
  let nbits = 0;
  let pair = 0;
  for (let right = size - 1; right >= 1; right -= 2, pair++) {
    if (right === 6) right = 5;
    // The first column pair runs upward, and the direction alternates from there.
    const upward = pair % 2 === 0;
    for (let step = 0; step < size; step++) {
      const row = upward ? size - 1 - step : step;
      for (const col of [right, right - 1]) {
        if (fn[row * size + col]) continue;
        const bit = get(col, row) ^ (maskBit(mask, row, col) ? 1 : 0);
        acc = (acc << 1) | bit;
        if (++nbits === 8) {
          raw.push(acc);
          acc = 0;
          nbits = 0;
        }
      }
    }
  }
  const total = totalCodewords(version);
  if (raw.length !== total) throw new Error(`read ${raw.length} codewords, expected ${total}`);

  // De-interleave into blocks and check each one.
  const numBlocks = EC_BLOCKS[ecc][version]!;
  const ecLen = EC_CODEWORDS_PER_BLOCK[ecc][version]!;
  const shortData = Math.floor(total / numBlocks) - ecLen;
  const numLong = total % numBlocks;
  const dataLens = Array.from({ length: numBlocks }, (_, b) => shortData + (b >= numBlocks - numLong ? 1 : 0));
  const blocks: number[][] = dataLens.map(() => []);
  let k = 0;
  for (let i = 0; i < shortData + 1; i++) {
    for (let b = 0; b < numBlocks; b++) if (i < dataLens[b]!) blocks[b]!.push(raw[k++]!);
  }
  for (let i = 0; i < ecLen; i++) for (let b = 0; b < numBlocks; b++) blocks[b]!.push(raw[k++]!);
  const data: number[] = [];
  blocks.forEach((block, b) => {
    if (!syndromesZero(block, ecLen)) throw new Error(`block ${b} has non-zero syndromes`);
    data.push(...block.slice(0, dataLens[b]));
  });
  if (data.length !== dataCodewords(version, ecc)) throw new Error('data codeword count mismatch');

  // Parse the segments.
  const reader = new BitReader(data);
  const out: number[] = [];
  const segments: DecodedSymbol['segments'] = [];
  while (reader.remaining >= 4) {
    const mode = reader.read(4);
    if (mode === 0) break;
    if (mode !== 1 && mode !== 2 && mode !== 4) throw new Error(`unsupported mode ${mode}`);
    const count = reader.read(countBits(mode, version));
    if (mode === 1) {
      segments.push({ mode: 'numeric', count });
      for (let left = count; left > 0; left -= 3) {
        const digits = Math.min(3, left);
        const value = reader.read(digits * 3 + 1);
        const text = String(value).padStart(digits, '0');
        if (text.length !== digits) throw new Error('numeric group out of range');
        for (const ch of text) out.push(ch.charCodeAt(0));
      }
    } else if (mode === 2) {
      segments.push({ mode: 'alphanumeric', count });
      for (let left = count; left > 0; left -= 2) {
        if (left >= 2) {
          const v = reader.read(11);
          out.push(ALNUM.charCodeAt(Math.floor(v / 45)), ALNUM.charCodeAt(v % 45));
        } else {
          out.push(ALNUM.charCodeAt(reader.read(6)));
        }
      }
    } else {
      segments.push({ mode: 'byte', count });
      for (let i = 0; i < count; i++) out.push(reader.read(8));
    }
  }
  return { version, ecc, mask, bytes: Uint8Array.from(out), segments };
}
