// Round trips: encode, render, read back.
// - Always: the independent structural reader in tests/support/qr-decode.ts.
// - With jsqr installed: a real image decoder reading raster renders and rasterised text art.
// - With fast-check installed: random byte strings up to capacity survive jsQR.
import { describe, expect, it } from 'vitest';
import { decodeMatrix } from '../../../tests/support/qr-decode';
import { optionalModule } from '../../../tests/support/optional-module';
import { encodeText } from './encode';
import { toRgba, type RgbaRaster } from './render/raster';
import { toText, type TextStyle } from './render/text';
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

// ── jsQR ─────────────────────────────────────────────────────────────────────────────────────

interface JsQrResult {
  binaryData: number[];
  data: string;
  version: number;
}
type JsQr = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  options?: { inversionAttempts?: 'dontInvert' | 'onlyInvert' | 'attemptBoth' | 'invertFirst' },
) => JsQrResult | null;

const jsqr = optionalModule<JsQr | { default: JsQr }>('jsqr');
const jsQR: JsQr | null = jsqr.module === null ? null : typeof jsqr.module === 'function' ? jsqr.module : jsqr.module.default;

/** Pixels per module that keep large symbols decodable without making small ones huge. */
const scaleFor = (qr: QrSymbol): number => (qr.version <= 10 ? 4 : qr.version <= 25 ? 3 : 2);

function decodeRgba(raster: RgbaRaster, invert = false): JsQrResult | null {
  if (!jsQR) throw new Error('jsqr is not installed');
  return jsQR(raster.data, raster.width, raster.height, { inversionAttempts: invert ? 'attemptBoth' : 'dontInvert' });
}

/** Stretches a raster vertically by `factor`, as half-block glyphs in a 1.2 line height do. */
function stretch(r: RgbaRaster, factor: number): RgbaRaster {
  const height = Math.round(r.height * factor);
  const data = new Uint8ClampedArray(r.width * height * 4);
  for (let y = 0; y < height; y++) {
    const src = Math.min(r.height - 1, Math.floor(y / factor));
    data.set(r.data.subarray(src * r.width * 4, (src + 1) * r.width * 4), y * r.width * 4);
  }
  return { width: r.width, height, data };
}

/**
 * Draws text art the way a terminal shows it: light glyphs on a dark background. Each cell is
 * `cell` pixels wide and `2 * cell` tall, and a half-block fills half of it.
 */
function rasteriseText(lines: string[], cell: number): RgbaRaster {
  const quiet = 4 * cell;
  const cols = Array.from(lines[0] ?? '').length;
  const width = cols * cell + 2 * quiet;
  const height = lines.length * 2 * cell + 2 * quiet;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) data[i * 4 + 3] = 255; // black background
  const paint = (x0: number, y0: number): void => {
    for (let y = y0; y < y0 + cell; y++) {
      for (let x = x0; x < x0 + cell; x++) data.fill(255, (y * width + x) * 4, (y * width + x) * 4 + 3);
    }
  };
  lines.forEach((line, row) => {
    Array.from(line).forEach((glyph, col) => {
      const x = quiet + col * cell;
      const y = quiet + row * 2 * cell;
      if (glyph === '█' || glyph === '▀') paint(x, y);
      if (glyph === '█' || glyph === '▄') paint(x, y + cell);
    });
  });
  return { width, height, data };
}

describe.skipIf(!jsQR)(`jsQR round trip${jsqr.note}`, () => {
  it('decodes raster renders of payloads across versions and levels', { timeout: 120_000 }, () => {
    // Every third case keeps the run time down while still covering versions 1 to 40.
    for (const { text, qr } of encodedCases().filter((_, i) => i % 3 === 0)) {
      const result = decodeRgba(toRgba(qr, { scale: scaleFor(qr) }));
      expect(result, `v${qr.version}-${qr.ecc} ${text.slice(0, 30)}`).not.toBeNull();
      expect(Buffer.from(result!.binaryData).equals(Buffer.from(utf8.encode(text)))).toBe(true);
      expect(result!.version).toBe(qr.version);
    }
  });

  it('decodes the fixed payloads with themed, stretched pixels', { timeout: 60_000 }, () => {
    for (const text of FIXED) {
      const qr = encodeText(text, { ecc: 'M', boostEcc: true });
      const raster = stretch(toRgba(qr, { scale: 4, ink: [34, 34, 53], paper: [255, 255, 255] }), 1.2);
      expect(decodeRgba(raster)?.data, text).toBe(text);
    }
  });

  it('decodes half-block text art in both polarities', { timeout: 60_000 }, () => {
    for (const text of ['https://www.vesen.app', 'Kia ora, Aotearoa', 'owl 🦉']) {
      const qr = encodeText(text, { ecc: 'M' });
      for (const style of ['utf8', 'utf8i'] as TextStyle[]) {
        // utf8 paints its own quiet zone; utf8i relies on the dark terminal around it.
        const art = toText(qr, { style, margin: style === 'utf8' ? 4 : 0 });
        expect(decodeRgba(rasteriseText(art, 4), true)?.data, `${style} ${text}`).toBe(text);
      }
    }
  });
});

// ── fast-check ───────────────────────────────────────────────────────────────────────────────

interface Arbitrary<T> {
  map<U>(f: (value: T) => U): Arbitrary<U>;
}
interface FastCheck {
  assert(property: unknown, params?: { numRuns?: number; seed?: number }): void;
  property<A, B>(a: Arbitrary<A>, b: Arbitrary<B>, predicate: (a: A, b: B) => boolean | void): unknown;
  uint8Array(constraints: { minLength?: number; maxLength?: number }): Arbitrary<Uint8Array>;
  constantFrom<T>(...values: T[]): Arbitrary<T>;
}

const fastCheck = optionalModule<FastCheck>('fast-check');
const fc = fastCheck.module;

describe.skipIf(!fc || !jsQR)(`property: random bytes up to capacity${fastCheck.note || jsqr.note}`, () => {
  it('round-trips through jsQR', { timeout: 120_000 }, () => {
    if (!fc) return;
    // Each byte becomes one character U+0000..U+00FF, which is 1 or 2 UTF-8 bytes, so half the
    // byte capacity is the longest string that always fits.
    const level = fc.constantFrom<EccLevel>('L', 'M', 'Q', 'H');
    const bytes = fc.uint8Array({ minLength: 1, maxLength: Math.floor(maxPayloadBytes('L') / 2) });
    fc.assert(
      fc.property(level, bytes, (ecc, raw) => {
        const text = String.fromCharCode(...raw.subarray(0, Math.floor(maxPayloadBytes(ecc) / 2)));
        const qr = encodeText(text, { ecc });
        const result = decodeRgba(toRgba(qr, { scale: scaleFor(qr) }));
        expect(result).not.toBeNull();
        expect(Buffer.from(result!.binaryData).equals(Buffer.from(utf8.encode(text)))).toBe(true);
      }),
      { numRuns: 60, seed: 2026 },
    );
  });
});
