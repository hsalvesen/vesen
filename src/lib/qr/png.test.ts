// The PNG encoder, checked against independent oracles: Node's zlib inflates the IDAT stream and
// computes the CRC-32s, a reference Adler-32 is computed here, and jsQR reads the decoded pixels.
import { crc32 as zlibCrc32, inflateSync } from 'node:zlib';
import jsQR from 'jsqr';
import { describe, expect, it } from 'vitest';
import { encodeText } from './encode';
import { adler32, base64, crc32, pngDataUrl, pngScanlines, toPng, zlibStored } from './render/png';
import { toRaster } from './render/raster';
import type { EccLevel } from './types';

interface Chunk {
  type: string;
  data: Uint8Array;
  crc: number;
  /** The bytes the CRC covers: the type and the data. */
  covered: Uint8Array;
}

function readU32(bytes: Uint8Array, at: number): number {
  return ((bytes[at]! << 24) | (bytes[at + 1]! << 16) | (bytes[at + 2]! << 8) | bytes[at + 3]!) >>> 0;
}

function chunks(png: Uint8Array): Chunk[] {
  const found: Chunk[] = [];
  let at = 8;
  while (at < png.length) {
    const length = readU32(png, at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    found.push({ type, data: png.subarray(at + 8, at + 8 + length), crc: readU32(png, at + 8 + length), covered: png.subarray(at + 4, at + 8 + length) });
    at += 12 + length;
  }
  return found;
}

/** A PNG back to RGBA pixels: greyscale, filter type 0 only, as the encoder writes. */
function decode(png: Uint8Array): { width: number; height: number; data: Uint8ClampedArray } {
  const all = chunks(png);
  const ihdr = all.find((c) => c.type === 'IHDR')!.data;
  const width = readU32(ihdr, 0);
  const height = readU32(ihdr, 4);
  const depth = ihdr[8]!;
  const raw = inflateSync(Buffer.concat(all.filter((c) => c.type === 'IDAT').map((c) => c.data)));
  const stride = depth === 1 ? Math.ceil(width / 8) : width;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const row = y * (stride + 1);
    expect(raw[row]).toBe(0);
    for (let x = 0; x < width; x++) {
      const v = depth === 1 ? ((raw[row + 1 + (x >> 3)]! >> (7 - (x & 7))) & 1) * 255 : raw[row + 1 + x]!;
      data.set([v, v, v, 255], (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

/** Adler-32 the slow, obvious way (RFC 1950, section 8). */
function referenceAdler(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const byte of bytes) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return (b * 65536 + a) >>> 0;
}

describe('checksums', () => {
  it('computes the standard check values', () => {
    const text = new TextEncoder().encode('123456789');
    expect(crc32(text)).toBe(0xcbf43926);
    expect(crc32(text)).toBe(zlibCrc32(text));
    expect(adler32(new TextEncoder().encode('Wikipedia'))).toBe(0x11e60398);
  });

  it('matches the references over long and random inputs', () => {
    const bytes = new Uint8Array(200_000);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 2654435761) >>> 24;
    expect(crc32(bytes)).toBe(zlibCrc32(bytes));
    expect(adler32(bytes)).toBe(referenceAdler(bytes));
    expect(adler32(new Uint8Array(0))).toBe(1);
  });
});

describe('zlibStored', () => {
  it.each([0, 1, 65_535, 65_536, 140_000])('inflates back to %i bytes, with the Adler-32 at the end', (length) => {
    const data = new Uint8Array(length).map((_, i) => i % 251);
    const stream = zlibStored(data);
    expect([stream[0], stream[1]]).toEqual([0x78, 0x01]);
    expect(((stream[0]! << 8) | stream[1]!) % 31).toBe(0);
    expect(new Uint8Array(inflateSync(stream))).toEqual(data);
    expect(readU32(stream, stream.length - 4)).toBe(referenceAdler(data));
    // Five bytes of header for each stored block of at most 65,535 bytes.
    expect(stream.length).toBe(2 + Math.max(1, Math.ceil(length / 65_535)) * 5 + length + 4);
  });
});

describe('toPng', () => {
  const qr = encodeText('https://vesen.app', { ecc: 'M' });

  it('starts with the signature, then IHDR, IDAT and IEND, each with a correct CRC', () => {
    const png = toPng(qr, { scale: 4, margin: 4 });
    expect(Array.from(png.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const all = chunks(png);
    expect(all.map((c) => c.type)).toEqual(['IHDR', 'IDAT', 'IEND']);
    for (const c of all) expect(c.crc, c.type).toBe(zlibCrc32(c.covered));
    const side = (qr.size + 8) * 4;
    const ihdr = all[0]!.data;
    expect(ihdr.length).toBe(13);
    // Width, height, 1-bit greyscale, deflate, no filter method but 0, no interlace.
    expect([readU32(ihdr, 0), readU32(ihdr, 4), ihdr[8], ihdr[9], ihdr[10], ihdr[11], ihdr[12]]).toEqual([side, side, 1, 0, 0, 0, 0]);
    expect(all[2]!.data.length).toBe(0);
  });

  it('holds exactly the expected scanlines: filter 0, dark as 0 bits, light as 1', () => {
    const png = toPng(qr, { scale: 3, margin: 2 });
    const idat = chunks(png).find((c) => c.type === 'IDAT')!.data;
    const raw = new Uint8Array(inflateSync(idat));
    expect(raw).toEqual(pngScanlines(qr, { scale: 3, margin: 2 }).data);
    const { width, dark } = toRaster(qr, { scale: 3, margin: 2 });
    const stride = Math.ceil(width / 8);
    for (let y = 0; y < width; y++) {
      for (let x = 0; x < width; x++) {
        const bit = (raw[y * (stride + 1) + 1 + (x >> 3)]! >> (7 - (x & 7))) & 1;
        expect(bit).toBe(dark[y * width + x] ? 0 : 1);
      }
    }
  });

  it('writes 8-bit greyscale on request', () => {
    const png = toPng(qr, { scale: 2, depth: 8 });
    expect(chunks(png)[0]!.data[8]).toBe(8);
    const { width, data } = decode(png);
    const { dark } = toRaster(qr, { scale: 2, margin: 4 });
    for (let i = 0; i < dark.length; i++) expect(data[i * 4]).toBe(dark[i] ? 0 : 255);
    expect(width).toBe((qr.size + 8) * 2);
  });

  it('defaults to 8 pixels a module and the 4-module quiet zone', () => {
    const ihdr = chunks(toPng(qr))[0]!.data;
    expect(readU32(ihdr, 0)).toBe((qr.size + 8) * 8);
  });

  it('splits a large image over several stored blocks', () => {
    const big = encodeText('x'.repeat(2000), { ecc: 'L' });
    const png = toPng(big, { scale: 6 });
    const idat = chunks(png).find((c) => c.type === 'IDAT')!.data;
    expect(pngScanlines(big, { scale: 6 }).data.length).toBeGreaterThan(65_535);
    expect(new Uint8Array(inflateSync(idat))).toEqual(pngScanlines(big, { scale: 6 }).data);
  });

  it('rejects a scale or a margin that is not a whole number, and an unknown depth', () => {
    expect(() => toPng(qr, { scale: 0 })).toThrow(RangeError);
    expect(() => toPng(qr, { margin: 1.5 })).toThrow(RangeError);
    expect(() => toPng(qr, { depth: 4 as 1 })).toThrow(RangeError);
  });

  const cases: [string, EccLevel, 1 | 8][] = [
    ['https://vesen.app', 'Q', 1],
    ['mailto:has@salvesen.app', 'H', 1],
    ['Kia ora, Tāmaki Makaurau 🦉', 'M', 8],
    ['https://github.com/hsalvesen/vesen', 'L', 1],
    ['0123456789'.repeat(30), 'M', 1],
  ];
  it.each(cases)('decodes with jsQR: %s at %s, %i-bit', (text, ecc, depth) => {
    const symbol = encodeText(text, { ecc });
    const image = decode(toPng(symbol, { scale: 4, depth }));
    const result = jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' });
    expect(result?.data).toBe(text);
  });
});

describe('base64 and data URLs', () => {
  it('matches Node for every length remainder', () => {
    for (const length of [0, 1, 2, 3, 4, 5, 255, 256, 1000]) {
      const bytes = new Uint8Array(length).map((_, i) => (i * 37 + length) & 0xff);
      expect(base64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
    }
  });

  it('makes a PNG data URL the content policy allows', () => {
    const png = toPng(encodeText('hi'), { scale: 1 });
    const url = pngDataUrl(png);
    expect(url.startsWith('data:image/png;base64,iVBORw0KGgo')).toBe(true);
    expect(new Uint8Array(Buffer.from(url.slice('data:image/png;base64,'.length), 'base64'))).toEqual(png);
  });
});
