// Worked examples and invariants from ISO/IEC 18004, independent of any other QR library.
import { describe, expect, it } from 'vitest';
import { BitBuffer } from './bits';
import { addEccAndInterleave, encodeSegments, encodeText } from './encode';
import { gfExp, gfMul, rsRemainder } from './gf256';
import { formatBits, versionBits, WorkGrid } from './matrix';
import { makeSegment, writeSegments } from './segments';
import {
  alignmentCentres,
  dataCodewords,
  EC_BLOCKS,
  EC_CODEWORDS_PER_BLOCK,
  ECC_ORDER,
  maxPayloadBytes,
  maxPayloadChars,
  rawDataModules,
  totalCodewords,
} from './tables';
import { QrCapacityError, type EccLevel, type MaskId, type SegmentMode } from './types';

/** Data codewords for one segment at a fixed version: header, data, terminator, bit padding, pad codewords. */
function dataCodewordsFor(text: string, mode: SegmentMode, v: number, ecc: EccLevel): number[] {
  const capacity = dataCodewords(v, ecc) * 8;
  const bb = new BitBuffer();
  writeSegments(bb, [makeSegment(text, mode)], v);
  bb.push(0, Math.min(4, capacity - bb.length));
  bb.push(0, (8 - (bb.length % 8)) % 8);
  for (let pad = 0xec; bb.length < capacity; pad ^= 0xec ^ 0x11) bb.push(pad, 8);
  return Array.from(bb.toBytes());
}

const hex = (bytes: ArrayLike<number>): string =>
  Array.from(bytes, (b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');

describe('ISO worked examples', () => {
  it('encodes 01234567 at 1-M as in Annex I', () => {
    const data = dataCodewordsFor('01234567', 'numeric', 1, 'M');
    expect(hex(data)).toBe('10 20 0C 56 61 80 EC 11 EC 11 EC 11 EC 11 EC 11');
    expect(hex(rsRemainder(data, 10))).toBe('A5 24 D4 C1 ED 36 C7 87 2C 55');
  });

  it('encodes HELLO WORLD at 1-M', () => {
    const data = dataCodewordsFor('HELLO WORLD', 'alphanumeric', 1, 'M');
    expect(data).toEqual([32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17]);
    expect(Array.from(rsRemainder(data, 10))).toEqual([196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
  });

  it('encodes HELLO WORLD at 1-Q', () => {
    const data = dataCodewordsFor('HELLO WORLD', 'alphanumeric', 1, 'Q');
    expect(data).toEqual([32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236]);
    expect(hex(rsRemainder(data, 13))).toBe('A8 48 16 52 D9 36 9C 00 2E 0F B4 7A 10');
  });

  it('gives every codeword block zero syndromes', () => {
    const data = dataCodewordsFor('HELLO WORLD', 'alphanumeric', 1, 'M');
    const codeword = [...data, ...rsRemainder(data, 10)];
    for (let i = 0; i < 10; i++) {
      expect(codeword.reduce((acc, c) => gfMul(acc, gfExp(i)) ^ c, 0)).toBe(0);
    }
  });
});

describe('format and version information', () => {
  it('matches the published format strings', () => {
    const word = (ecc: EccLevel, mask: MaskId): string => formatBits(ecc, mask).toString(2).padStart(15, '0');
    expect(word('L', 0)).toBe('111011111000100');
    expect(word('M', 0)).toBe('101010000010010');
    expect(word('Q', 0)).toBe('011010101011111');
    expect(word('H', 0)).toBe('001011010001001');
    expect(word('M', 5)).toBe('100000011001110');
    expect(word('H', 7)).toBe('000100000111011');
  });

  it('keeps the 32 format words at least 7 bits apart', () => {
    const words: number[] = [];
    for (const ecc of ECC_ORDER) for (let m = 0; m < 8; m++) words.push(formatBits(ecc, m as MaskId));
    let min = Infinity;
    for (let i = 0; i < words.length; i++) {
      for (let j = i + 1; j < words.length; j++) {
        let x = words[i]! ^ words[j]!;
        let d = 0;
        for (; x; x >>>= 1) d += x & 1;
        min = Math.min(min, d);
      }
    }
    expect(new Set(words).size).toBe(32);
    expect(min).toBe(7);
  });

  it('matches the published version information', () => {
    expect(versionBits(7)).toBe(0x07c94);
    expect(versionBits(8)).toBe(0x085bc);
    expect(versionBits(21)).toBe(0x15683);
    expect(versionBits(40)).toBe(0x28c69);
    for (let v = 7; v <= 40; v++) expect(versionBits(v) >>> 12).toBe(v);
  });
});

describe('tables', () => {
  it('places alignment patterns as in Annex E', () => {
    expect(alignmentCentres(1)).toEqual([]);
    expect(alignmentCentres(2)).toEqual([6, 18]);
    expect(alignmentCentres(7)).toEqual([6, 22, 38]);
    expect(alignmentCentres(32)).toEqual([6, 34, 60, 86, 112, 138]);
    expect(alignmentCentres(40)).toEqual([6, 30, 58, 86, 114, 142, 170]);
  });

  it('counts data modules the same way a brute-force count of the grid does', () => {
    for (let v = 1; v <= 40; v++) {
      const grid = new WorkGrid(v);
      grid.drawFunctionPatterns();
      const free = grid.fn.reduce((n, f) => n + (f ? 0 : 1), 0);
      expect(free, `version ${v}`).toBe(rawDataModules(v));
    }
  });

  it('agrees with the capacity table', () => {
    expect(totalCodewords(1)).toBe(26);
    expect(totalCodewords(40)).toBe(3706);
    expect(dataCodewords(1, 'L')).toBe(19);
    expect(dataCodewords(40, 'H')).toBe(1276);
    expect(ECC_ORDER.map((e) => maxPayloadBytes(e))).toEqual([2953, 2331, 1663, 1273]);
    expect(maxPayloadChars('L', 'numeric')).toBe(7089);
    expect(maxPayloadChars('L', 'alphanumeric')).toBe(4296);
    expect(ECC_ORDER.map((e) => maxPayloadChars(e, 'numeric', 1))).toEqual([41, 34, 27, 17]);
    expect(ECC_ORDER.map((e) => maxPayloadChars(e, 'alphanumeric', 1))).toEqual([25, 20, 16, 10]);
    expect(ECC_ORDER.map((e) => maxPayloadChars(e, 'byte', 1))).toEqual([17, 14, 11, 7]);
  });

  it('splits every version and level into blocks that add up', () => {
    for (const ecc of ECC_ORDER) {
      for (let v = 1; v <= 40; v++) {
        const blocks = EC_BLOCKS[ecc][v]!;
        const ecLen = EC_CODEWORDS_PER_BLOCK[ecc][v]!;
        expect(blocks).toBeGreaterThan(0);
        expect(dataCodewords(v, ecc)).toBe(totalCodewords(v) - blocks * ecLen);
        // Blocks differ in length by at most one codeword.
        expect(Math.floor(totalCodewords(v) / blocks) - ecLen).toBeGreaterThan(0);
      }
    }
  });
});

describe('interleaving', () => {
  it('keeps every codeword, data before error correction', () => {
    for (const [v, ecc] of [[5, 'Q'], [13, 'H'], [40, 'L']] as const) {
      const n = dataCodewords(v, ecc);
      const data = Uint8Array.from({ length: n }, (_, i) => (i * 7 + 3) & 0xff);
      const out = addEccAndInterleave(data, v, ecc);
      expect(out.length).toBe(totalCodewords(v));
      expect(Array.from(out.subarray(0, n)).sort((a, b) => a - b)).toEqual(Array.from(data).sort((a, b) => a - b));
    }
  });
});

describe('version choice and capacity', () => {
  it('fits 14 bytes in 1-M and moves 15 to version 2', () => {
    expect(encodeText('abcdefghijklmn', { mode: 'byte' }).version).toBe(1);
    expect(encodeText('abcdefghijklmno', { mode: 'byte' }).version).toBe(2);
  });

  it('fills version 40 exactly at every level', { timeout: 60_000 }, () => {
    for (const ecc of ECC_ORDER) {
      const max = maxPayloadBytes(ecc);
      expect(encodeText('a'.repeat(max), { ecc }).version).toBe(40);
      expect(() => encodeText('a'.repeat(max + 1), { ecc })).toThrow(QrCapacityError);
    }
  });

  it('reports what the levels hold when the text is too long', () => {
    let error: unknown;
    try {
      encodeText('x'.repeat(3120), { ecc: 'M' });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(QrCapacityError);
    const e = error as QrCapacityError;
    expect(e.bytes).toBe(3120);
    expect(e.ecc).toBe('M');
    expect(e.maxBytes).toEqual({ L: 2953, M: 2331, Q: 1663, H: 1273 });
  });

  it('honours an exact version and a minimum version', () => {
    expect(encodeText('vesen', { version: 5 }).version).toBe(5);
    expect(encodeText('vesen', { minVersion: 3 }).version).toBe(3);
    expect(() => encodeText('a'.repeat(30), { version: 1 })).toThrow(QrCapacityError);
    expect(() => encodeText('vesen', { version: 41 })).toThrow(RangeError);
    expect(() => encodeText('vesen', { minVersion: 9, maxVersion: 3 })).toThrow(RangeError);
  });

  it('rejects a mask or level outside the standard', () => {
    expect(() => encodeText('vesen', { mask: 8 as number as MaskId })).toThrow(RangeError);
    expect(() => encodeText('vesen', { ecc: 'X' as string as EccLevel })).toThrow(RangeError);
  });

  it('raises the level for free only when asked', () => {
    const boosted = encodeText('12345', { ecc: 'L', boostEcc: true });
    expect(boosted.version).toBe(1);
    expect(boosted.ecc).toBe('H');
    expect(boosted.requestedEcc).toBe('L');
    expect(encodeText('12345', { ecc: 'L' }).ecc).toBe('L');
    // 14 bytes fill 1-M, so there is nothing to boost.
    expect(encodeText('abcdefghijklmn', { ecc: 'M', boostEcc: true }).ecc).toBe('M');
  });

  it('records segments, data bits and capacity', () => {
    const qr = encodeSegments([makeSegment('HELLO WORLD', 'alphanumeric')], { ecc: 'Q' });
    expect(qr).toMatchObject({ version: 1, size: 21, ecc: 'Q', dataBits: 4 + 9 + 61, capacityBits: 13 * 8 });
    expect(qr.segments).toEqual([{ mode: 'alphanumeric', charCount: 11 }]);
    expect(qr.modules.length).toBe(21 * 21);
    expect(Object.isFrozen(qr)).toBe(true);
  });

  it('encodes the empty string with no segment at all', () => {
    const qr = encodeText('');
    expect(qr.version).toBe(1);
    expect(qr.segments).toEqual([]);
    expect(qr.dataBits).toBe(0);
  });
});
