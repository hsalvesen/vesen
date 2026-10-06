// A live comparison with the `qrcode` package while it is still installed. Once it is removed
// this suite skips itself, and golden.test.ts keeps guarding the encoder with its frozen output.
import { describe, expect, it } from 'vitest';
import { optionalModule } from '../../../tests/support/optional-module';
import { encodeSegments, encodeText } from './encode';
import { segmentOptimally } from './segmenter';
import { makeSegment } from './segments';
import { EC_BLOCKS, EC_CODEWORDS_PER_BLOCK, ECC_ORDER, maxPayloadChars } from './tables';
import type { EccLevel, MaskId, SegmentMode } from './types';

interface QrcodeSymbol {
  version: number;
  maskPattern: number;
  modules: { size: number; data: Uint8Array };
}
interface Qrcode {
  create(
    data: string | { data: string; mode: SegmentMode }[],
    options: { errorCorrectionLevel: EccLevel; version?: number; maskPattern?: number },
  ): QrcodeSymbol;
}
interface QrcodeEcTables {
  getBlocksCount(version: number, level: unknown): number;
  getTotalCodewordsCount(version: number, level: unknown): number;
}

const qrcode = optionalModule<Qrcode>('qrcode');
const QR = qrcode.module;
const ecTables = optionalModule<QrcodeEcTables>('qrcode/lib/core/error-correction-code.js').module;
const ecLevels = optionalModule<Record<EccLevel, unknown>>('qrcode/lib/core/error-correction-level.js').module;

const MODES: readonly SegmentMode[] = ['numeric', 'alphanumeric', 'byte'];
const ALPHABET: Record<SegmentMode, string> = {
  numeric: '0123456789',
  alphanumeric: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:',
  byte: 'abcdefghijklmnopqrstuvwxyz0123456789/:.?=&-_é☕',
};

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

/** Text of `mode` long enough to need exactly version `v` at level `ecc`, kept within its capacity. */
function textForVersion(v: number, ecc: EccLevel, mode: SegmentMode, next: () => number): string {
  const chars = Array.from(ALPHABET[mode]);
  const utf8 = new TextEncoder();
  const max = maxPayloadChars(ecc, mode, v);
  const min = v === 1 ? 1 : maxPayloadChars(ecc, mode, v - 1) + 1;
  let text = '';
  const target = min + Math.floor(next() * (max - min + 1));
  while (Array.from(text).length < target) text += chars[Math.floor(next() * chars.length)]!;
  // Multi-byte characters may overshoot a byte capacity; trim back to whole characters.
  while (mode === 'byte' && utf8.encode(text).length > max) text = Array.from(text).slice(0, -1).join('');
  return text;
}

function same(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * The mask penalty qrcode@1.5.4 uses, ported for this test only: N3 looks for 1:1:3:1:1 only at
 * unit width and only inside the symbol, and N4 rounds differently from ISO 18004. Injected
 * through the encoder's penalty option, it should reproduce qrcode's automatic mask choice.
 */
function qrcodePenalty(m: Uint8Array, size: number): number {
  const at = (row: number, col: number): number => m[row * size + col]!;
  let n1 = 0;
  for (let row = 0; row < size; row++) {
    let sameRow = 0;
    let sameCol = 0;
    let lastRow = -1;
    let lastCol = -1;
    for (let col = 0; col < size; col++) {
      let bit = at(row, col);
      if (bit === lastCol) sameCol++;
      else {
        if (sameCol >= 5) n1 += 3 + (sameCol - 5);
        lastCol = bit;
        sameCol = 1;
      }
      bit = at(col, row);
      if (bit === lastRow) sameRow++;
      else {
        if (sameRow >= 5) n1 += 3 + (sameRow - 5);
        lastRow = bit;
        sameRow = 1;
      }
    }
    if (sameCol >= 5) n1 += 3 + (sameCol - 5);
    if (sameRow >= 5) n1 += 3 + (sameRow - 5);
  }
  let n2 = 0;
  for (let row = 0; row < size - 1; row++) {
    for (let col = 0; col < size - 1; col++) {
      const sum = at(row, col) + at(row, col + 1) + at(row + 1, col) + at(row + 1, col + 1);
      if (sum === 4 || sum === 0) n2++;
    }
  }
  let n3 = 0;
  for (let row = 0; row < size; row++) {
    let bitsCol = 0;
    let bitsRow = 0;
    for (let col = 0; col < size; col++) {
      bitsCol = ((bitsCol << 1) & 0x7ff) | at(row, col);
      if (col >= 10 && (bitsCol === 0x5d0 || bitsCol === 0x05d)) n3++;
      bitsRow = ((bitsRow << 1) & 0x7ff) | at(col, row);
      if (col >= 10 && (bitsRow === 0x5d0 || bitsRow === 0x05d)) n3++;
    }
  }
  let dark = 0;
  for (let i = 0; i < m.length; i++) dark += m[i]!;
  const k = Math.abs(Math.ceil((dark * 100) / m.length / 5) - 10);
  return n1 + n2 * 3 + n3 * 40 + k * 10;
}

describe.skipIf(!QR)(`oracle: matches qrcode module for module${qrcode.note}`, () => {
  it('uses the same error-correction block tables', () => {
    if (!ecTables || !ecLevels) throw new Error('qrcode internals moved');
    for (const ecc of ECC_ORDER) {
      for (let v = 1; v <= 40; v++) {
        expect(ecTables.getBlocksCount(v, ecLevels[ecc])).toBe(EC_BLOCKS[ecc][v]);
        expect(ecTables.getTotalCodewordsCount(v, ecLevels[ecc])).toBe(EC_BLOCKS[ecc][v]! * EC_CODEWORDS_PER_BLOCK[ecc][v]!);
      }
    }
  });

  it('draws the same symbol for every version, level, mode and forced mask', { timeout: 120_000 }, () => {
    const next = seeded(40);
    const mismatches: string[] = [];
    const masksSeen = new Set<string>();
    let compared = 0;
    for (let v = 1; v <= 40; v++) {
      ECC_ORDER.forEach((ecc, e) => {
        MODES.forEach((mode, m) => {
          const text = textForVersion(v, ecc, mode, next);
          // Two opposite masks per combination, rotating so every version sees all eight;
          // versions 1 and 7 try all eight for every level and mode.
          const first = (v + e * 3 + m) % 4;
          const masks = v === 1 || v === 7 ? [0, 1, 2, 3, 4, 5, 6, 7] : [first, first + 4];
          for (const mask of masks) {
            const ours = encodeSegments([makeSegment(text, mode)], { ecc, version: v, mask: mask as MaskId });
            const theirs = QR!.create([{ data: text, mode }], { errorCorrectionLevel: ecc, version: v, maskPattern: mask });
            compared++;
            masksSeen.add(`${v}:${mask}`);
            if (!same(ours.modules, theirs.modules.data)) mismatches.push(`v${v}-${ecc} ${mode} mask ${mask}`);
          }
        });
      });
    }
    expect(masksSeen.size).toBe(40 * 8);
    expect(compared).toBe(38 * 4 * 3 * 2 + 2 * 4 * 3 * 8);
    expect(mismatches).toEqual([]);
  });

  it('draws the same symbol for mixed segments pinned to the same split', { timeout: 60_000 }, () => {
    const texts = [
      'tel:+61412345678901234',
      'HTTPS://VESEN.APP/20261006?q=ā',
      '0123ABCxyz456789',
      '🦉123456789012🦘',
      'ORDER 12345678901234567890 SHIPPED',
      'Order #A-1029: 3 × flat white — total $14.50, ref 99887766554433',
    ];
    for (const text of texts) {
      for (const ecc of ECC_ORDER) {
        const auto = encodeText(text, { ecc });
        const segs = segmentOptimally(text, auto.version);
        for (const mask of [0, 5] as const) {
          const ours = encodeSegments(segs, { ecc, version: auto.version, mask });
          const theirs = QR!.create(
            segs.map((s) => ({ data: s.text, mode: s.mode })),
            { errorCorrectionLevel: ecc, version: auto.version, maskPattern: mask },
          );
          expect(same(ours.modules, theirs.modules.data), `${text} ${ecc} mask ${mask}`).toBe(true);
        }
      }
    }
  });

  it('chooses the same masks as qrcode when given its penalty', { timeout: 120_000 }, () => {
    const next = seeded(2000);
    const mismatches: string[] = [];
    for (let i = 0; i < 160; i++) {
      const ecc = ECC_ORDER[i % 4]!;
      const mode = MODES[i % 3]!;
      const v = 1 + Math.floor(next() ** 2 * 40);
      const text = textForVersion(v, ecc, mode, next);
      const ours = encodeSegments([makeSegment(text, mode)], { ecc, penalty: qrcodePenalty });
      const theirs = QR!.create([{ data: text, mode }], { errorCorrectionLevel: ecc });
      if (ours.mask !== theirs.maskPattern || !same(ours.modules, theirs.modules.data)) {
        mismatches.push(`${mode} v${v}-${ecc}: ours mask ${ours.mask}, qrcode mask ${theirs.maskPattern}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('never needs a larger version than the call the legacy command made', { timeout: 60_000 }, () => {
    const payloads = [
      'https://www.vesen.app',
      'https://github.com/hsalvesen/vesen',
      'tel:+61412345678',
      'https://www.example.com/orders/12345678901234567890',
      'BEGIN:VCARD\nVERSION:3.0\nFN:Has Salvesen\nTEL:+61412345678\nEND:VCARD',
      'Kia ora, Aotearoa — ā ē ī ō ū 🦉',
      '3141592653589793238462643383279502884197169399375105820974944',
      'x'.repeat(2000),
    ];
    for (const text of payloads) {
      const theirs = QR!.create(text, { errorCorrectionLevel: 'M' });
      expect(encodeText(text, { ecc: 'M' }).version, text.slice(0, 40)).toBeLessThanOrEqual(theirs.version);
    }
  });
});
