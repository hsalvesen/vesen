// Round trips: encode, then read back with the independent structural reader in
// tests/support/qr-decode.ts, for a spread of payloads, every mask at every version, and seeded
// random bytes up to capacity.
import { describe, expect, it } from 'vitest';
import { decodeMatrix } from '../../../tests/support/qr-decode';
import { encodeText } from './encode';
import { ECC_ORDER, maxPayloadBytes } from './tables';
import type { EccLevel, MaskId, QrSymbol, SegmentMode } from './types';

const utf8 = new TextEncoder();

/** mulberry32: a small seeded generator, so every run tests the same payloads. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ALPHABETS: Record<string, string[]> = {
  digits: Array.from('0123456789'),
  alnum: Array.from('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:'),
  url: Array.from('abcdefghijklmnopqrstuvwxyz0123456789/:.?=&-_'),
  mixed: Array.from('aZ09 :/.?=&-_ĀāĒēĪīŌōŪū€☕🦉🦘中文'),
};

const FIXED = [
  'https://www.vesen.app',
  'https://github.com/hsalvesen/vesen',
  'mailto:has@salvesen.app',
  'tel:+61412345678',
  'WIFI:T:WPA;S:vesen;P:correct horse battery staple;;',
  'Gadigal Country',
  'Kia ora, Aotearoa',
  'Māori macrons: ā ē ī ō ū',
  'owl 🦉 kangaroo 🦘',
  '終端機 テスト',
  'HELLO WORLD',
  '01234567',
];

interface Case {
  text: string;
  ecc: EccLevel;
}

/** About 200 payloads spread over every level and the whole version range. */
function spread(): Case[] {
  const next = seeded(18004);
  const cases: Case[] = [];
  FIXED.forEach((text, i) => cases.push({ text, ecc: ECC_ORDER[i % 4]! }));
  // Byte payloads that exactly fill versions 40, 27, 10 and 2.
  for (const ecc of ECC_ORDER) {
    for (const v of [40, 27, 10, 2]) cases.push({ text: 'vesen.app/'.repeat(300).slice(0, maxPayloadBytes(ecc, v)), ecc });
  }
  const names = Object.keys(ALPHABETS);
  for (let i = 0; i < 172; i++) {
    const ecc = ECC_ORDER[i % 4]!;
    const alphabet = ALPHABETS[names[i % names.length]!]!;
    // Lengths up to the level's byte capacity, skewed towards short payloads.
    const max = maxPayloadBytes(ecc);
    const length = 1 + Math.floor(next() ** 2 * (alphabet === ALPHABETS.mixed ? max / 4 : max));
    let text = '';
    for (let k = 0; k < length; k++) text += alphabet[Math.floor(next() * alphabet.length)]!;
    while (utf8.encode(text).length > max) text = Array.from(text).slice(0, -1).join('');
    cases.push({ text, ecc });
  }
  return cases;
}

const CASES = spread();

/** Each case encoded once; every other one with the free EC boost. */
let encoded: (Case & { qr: QrSymbol })[] | undefined;
function encodedCases(): (Case & { qr: QrSymbol })[] {
  encoded ??= CASES.map((c, i) => ({ ...c, qr: encodeText(c.text, { ecc: c.ecc, boostEcc: i % 2 === 1 }) }));
  return encoded;
}

describe('structural round trip', () => {
  it('covers short and long symbols at every level', { timeout: 60_000 }, () => {
    const versions = encodedCases().map(({ qr }) => qr.version);
    expect(Math.min(...versions)).toBe(1);
    expect(Math.max(...versions)).toBe(40);
    expect(new Set(versions).size).toBeGreaterThan(25);
    expect(new Set(encodedCases().map(({ qr }) => qr.ecc)).size).toBe(4);
  });

  it('reads every symbol back to its UTF-8 bytes, segments, level and mask', { timeout: 60_000 }, () => {
    for (const { text, qr } of encodedCases()) {
      const read = decodeMatrix(qr.modules, qr.size);
      expect(read.version).toBe(qr.version);
      expect(read.ecc).toBe(qr.ecc);
      expect(read.mask).toBe(qr.mask);
      expect(read.segments).toEqual(qr.segments.map((s) => ({ mode: s.mode, count: s.charCount })));
      expect(Buffer.from(read.bytes).equals(Buffer.from(utf8.encode(text))), text.slice(0, 40)).toBe(true);
    }
  });

  it('reads every mask at every version back', { timeout: 60_000 }, () => {
    for (let v = 1; v <= 40; v++) {
      const mode: SegmentMode = (['numeric', 'alphanumeric', 'byte'] as const)[v % 3]!;
      const text = mode === 'numeric' ? '31415926535' : mode === 'alphanumeric' ? 'VESEN.APP' : 'vesen ā';
      for (let mask = 0; mask < 8; mask++) {
        const qr = encodeText(text, { version: v, ecc: ECC_ORDER[(v + mask) % 4]!, mask: mask as MaskId, mode });
        expect(decodeMatrix(qr.modules, qr.size)).toMatchObject({ version: v, mask });
      }
    }
  });
});

describe('property: random bytes up to capacity', () => {
  it('round-trip through the structural reader at every level', { timeout: 60_000 }, () => {
    const next = seeded(2026);
    for (let run = 0; run < 60; run++) {
      const ecc = ECC_ORDER[run % 4]!;
      // Each byte becomes one character U+0000..U+00FF, which is 1 or 2 UTF-8 bytes, so half the
      // byte capacity is the longest string that always fits.
      const length = 1 + Math.floor(next() * Math.floor(maxPayloadBytes(ecc) / 2));
      const text = String.fromCharCode(...Array.from({ length }, () => Math.floor(next() * 256)));
      const qr = encodeText(text, { ecc });
      const read = decodeMatrix(qr.modules, qr.size);
      expect(read.ecc, `run ${run}`).toBe(ecc);
      expect(Buffer.from(read.bytes).equals(Buffer.from(utf8.encode(text))), `run ${run}`).toBe(true);
    }
  });
});
