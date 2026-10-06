// Pixel rasters of a symbol with its quiet zone: a 1-bit raster, and RGBA for decoders and canvases.
import type { QrSymbol } from '../types';

type Matrix = Pick<QrSymbol, 'size' | 'modules'>;

export interface RasterOptions {
  /** Pixels per module, a whole number ≥ 1. Default 1. */
  scale?: number;
  /** Quiet zone in modules. Default 4, the width the standard asks for. */
  margin?: number;
}

export interface Raster {
  width: number;
  height: number;
  /** Row-major pixels, 1 = dark. */
  dark: Uint8Array;
}

export interface RgbaRaster {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export type Rgb = readonly [number, number, number];

function checkedOptions(o: RasterOptions): { scale: number; margin: number } {
  const scale = o.scale ?? 1;
  const margin = o.margin ?? 4;
  if (!Number.isInteger(scale) || scale < 1) throw new RangeError(`scale must be a whole number ≥ 1 (got ${scale})`);
  if (!Number.isInteger(margin) || margin < 0) throw new RangeError(`margin must be a whole number ≥ 0 (got ${margin})`);
  return { scale, margin };
}

export function toRaster(qr: Matrix, o: RasterOptions = {}): Raster {
  const { scale, margin } = checkedOptions(o);
  const side = (qr.size + 2 * margin) * scale;
  const dark = new Uint8Array(side * side);
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) {
      if (qr.modules[y * qr.size + x] !== 1) continue;
      const top = (y + margin) * scale;
      const left = (x + margin) * scale;
      for (let dy = 0; dy < scale; dy++) dark.fill(1, (top + dy) * side + left, (top + dy) * side + left + scale);
    }
  }
  return { width: side, height: side, dark };
}

/** RGBA pixels, opaque. Ink and paper default to pure black and white. */
export function toRgba(qr: Matrix, o: RasterOptions & { ink?: Rgb; paper?: Rgb } = {}): RgbaRaster {
  const { width, height, dark } = toRaster(qr, o);
  const ink = o.ink ?? [0, 0, 0];
  const paper = o.paper ?? [255, 255, 255];
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < dark.length; i++) {
    const c = dark[i] ? ink : paper;
    data[i * 4] = c[0];
    data[i * 4 + 1] = c[1];
    data[i * 4 + 2] = c[2];
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}
