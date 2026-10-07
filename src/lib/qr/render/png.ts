// PNG: a greyscale image of the symbol and its quiet zone, black on white, made without a canvas
// so it is the same in every browser (no fingerprinting noise) and testable in Node. The pixels
// go into stored (uncompressed) deflate blocks: larger than a compressed file, but a few dozen
// kilobytes for a typical code, and with no compressor to get wrong. Each chunk carries its
// CRC-32 and the zlib stream its Adler-32, as the PNG and zlib specifications require.
import type { QrSymbol } from '../types';
import { toRaster } from './raster';

type Matrix = Pick<QrSymbol, 'size' | 'modules'>;

export interface PngOptions {
  /** Pixels per module, a whole number ≥ 1. Default 8. */
  scale?: number;
  /** Quiet zone in modules. Default 4. */
  margin?: number;
  /** Bits per pixel: 1 (the default, the smallest file) or 8. */
  depth?: 1 | 8;
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** The most a stored deflate block holds. */
const STORED_MAX = 0xffff;

let crcTable: Uint32Array | null = null;

function table(): Uint32Array {
  if (crcTable !== null) return crcTable;
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  crcTable = t;
  return t;
}

/** CRC-32 (ISO 3309, the polynomial PNG uses) of `bytes`, continuing from `crc`. */
export function crc32(bytes: Uint8Array, crc = 0): number {
  const t = table();
  let c = (crc ^ 0xffffffff) >>> 0;
  for (let i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Adler-32 (RFC 1950), the checksum that ends a zlib stream. */
export function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  // 5552 bytes is the most that can be summed before the 32-bit sums must be reduced.
  for (let i = 0; i < bytes.length; ) {
    const end = Math.min(bytes.length, i + 5552);
    for (; i < end; i++) {
      a += bytes[i]!;
      b += a;
    }
    a %= 65521;
    b %= 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/** A zlib stream (RFC 1950) holding `data` in stored deflate blocks (RFC 1951, section 3.2.4). */
export function zlibStored(data: Uint8Array): Uint8Array {
  const blocks = Math.max(1, Math.ceil(data.length / STORED_MAX));
  const out = new Uint8Array(2 + blocks * 5 + data.length + 4);
  // CMF: deflate with a 32 KiB window; FLG: no dictionary, fastest, and (CMF << 8 | FLG) % 31 === 0.
  out[0] = 0x78;
  out[1] = 0x01;
  let o = 2;
  for (let b = 0; b < blocks; b++) {
    const start = b * STORED_MAX;
    const len = Math.min(STORED_MAX, data.length - start);
    // BFINAL on the last block, BTYPE 00 (stored); the rest of the byte pads to a byte boundary.
    out[o++] = b === blocks - 1 ? 1 : 0;
    out[o++] = len & 0xff;
    out[o++] = len >>> 8;
    out[o++] = ~len & 0xff;
    out[o++] = (~len >>> 8) & 0xff;
    out.set(data.subarray(start, start + len), o);
    o += len;
  }
  const sum = adler32(data);
  out[o++] = sum >>> 24;
  out[o++] = (sum >>> 16) & 0xff;
  out[o++] = (sum >>> 8) & 0xff;
  out[o++] = sum & 0xff;
  return out;
}

function u32(value: number): number[] {
  return [value >>> 24, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  out.set(u32(data.length), 0);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  out.set(u32(crc32(out.subarray(4, 8 + data.length))), 8 + data.length);
  return out;
}

/**
 * The scanlines PNG compresses: each row is filter type 0 (none) and then its pixels, dark as 0
 * and light as all ones. A 1-bit row packs eight pixels a byte, most significant bit first, and
 * pads its last byte with light.
 */
export function pngScanlines(qr: Matrix, o: PngOptions = {}): { width: number; height: number; depth: 1 | 8; data: Uint8Array } {
  const depth = o.depth ?? 1;
  if (depth !== 1 && depth !== 8) throw new RangeError(`depth must be 1 or 8 (got ${String(depth)})`);
  const { width, height, dark } = toRaster(qr, { scale: o.scale ?? 8, margin: o.margin ?? 4 });
  const stride = depth === 1 ? Math.ceil(width / 8) : width;
  const data = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (stride + 1);
    data[row] = 0;
    if (depth === 8) {
      for (let x = 0; x < width; x++) data[row + 1 + x] = dark[y * width + x] ? 0 : 255;
      continue;
    }
    data.fill(0xff, row + 1, row + 1 + stride);
    for (let x = 0; x < width; x++) {
      if (dark[y * width + x]) data[row + 1 + (x >> 3)]! &= ~(0x80 >> (x & 7));
    }
  }
  return { width, height, depth, data };
}

/** The symbol as a PNG file: greyscale, black modules on a white quiet zone. */
export function toPng(qr: Matrix, o: PngOptions = {}): Uint8Array<ArrayBuffer> {
  const { width, height, depth, data } = pngScanlines(qr, o);
  // Width, height, bit depth, colour type 0 (greyscale), deflate, filter method 0, no interlace.
  const ihdr = new Uint8Array([...u32(width), ...u32(height), depth, 0, 0, 0, 0]);
  const parts = [new Uint8Array(SIGNATURE), chunk('IHDR', ihdr), chunk('IDAT', zlibStored(data)), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let o2 = 0;
  for (const part of parts) {
    out.set(part, o2);
    o2 += part.length;
  }
  return out;
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Standard base64 with padding (RFC 4648, section 4). */
export function base64(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out += BASE64[n >>> 18]! + BASE64[(n >>> 12) & 63]! + BASE64[(n >>> 6) & 63]! + BASE64[n & 63]!;
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i]! << 16;
    out += `${BASE64[n >>> 18]!}${BASE64[(n >>> 12) & 63]!}==`;
  } else if (rest === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    out += `${BASE64[n >>> 18]!}${BASE64[(n >>> 12) & 63]!}${BASE64[(n >>> 6) & 63]!}=`;
  }
  return out;
}

/** A `data:image/png;base64,…` URL for an image the page draws: the content policy allows data: images. */
export function pngDataUrl(png: Uint8Array): string {
  return `data:image/png;base64,${base64(png)}`;
}
