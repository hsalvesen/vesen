// Independent check: render symbols to pixels and read them back with jsQR, a third-party
// image decoder that shares no code with this encoder. If both the encoder and the in-house
// structural reader misread the standard the same way, this test still catches it.
import jsQR from 'jsqr';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { encodeText } from './encode';
import { toRgba } from './render/raster';
import { ECC_ORDER } from './tables';
import type { EccLevel, MaskId } from './types';

function scan(text: string, opts: { ecc?: EccLevel; mask?: MaskId; scale?: number } = {}): string | null {
  const qr = encodeText(text, { ecc: opts.ecc ?? 'M', ...(opts.mask === undefined ? {} : { mask: opts.mask }) });
  const img = toRgba(qr, { scale: opts.scale ?? 4, margin: 4 });
  const result = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
  return result ? result.data : null;
}

const PAYLOADS = [
  'https://www.vesen.app',
  'https://github.com/hsalvesen/vesen',
  'mailto:has@salvesen.app',
  'HELLO WORLD',
  '0123456789012345678901234567890123456789',
  'Gadigal Country · Sydney',
  'Kia ora, Tāmaki Makaurau',
  'WIFI:T:WPA;S:vesen;P:correct horse battery staple;;',
  'x'.repeat(300),
];

describe('jsQR reads what the encoder writes', () => {
  for (const text of PAYLOADS) {
    for (const ecc of ECC_ORDER) {
      it(`${ecc}: ${text.slice(0, 32)}`, () => {
        expect(scan(text, { ecc })).toBe(text);
      });
    }
  }

  it('reads every mask', () => {
    for (let m = 0; m < 8; m++) expect(scan('https://www.vesen.app/?m=' + m, { mask: m as MaskId })).toBe('https://www.vesen.app/?m=' + m);
  });

  it('reads a large symbol', () => {
    const text = 'vesen '.repeat(120);
    expect(scan(text, { ecc: 'L', scale: 3 })).toBe(text);
  });

  it('round-trips random printable text (property)', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 120, unit: 'grapheme-ascii' }), fc.constantFrom<EccLevel>('L', 'M', 'Q', 'H'), (text, ecc) => {
        expect(scan(text, { ecc })).toBe(text);
      }),
      { numRuns: 60, seed: 20261006 },
    );
  });
});
