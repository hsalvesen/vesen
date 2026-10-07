// How big to draw each module on the screen: as asked (or the default for the device), never wider
// than the room there is, and a whole number of device pixels, so every module edge falls on a
// pixel boundary and the code stays crisp.

export interface ModuleSizeOptions {
  /** The module size the visitor asked for (-s N), in CSS pixels; overrides the cap. */
  requested?: number;
  /** The default module size, in CSS pixels: 8 on a desktop, up to 10 on a phone. */
  cap: number;
}

export interface ModuleSize {
  /** CSS pixels per module; `px * dpr` is a whole number. */
  px: number;
  /** A requested size had to shrink to fit. */
  clamped: boolean;
  /** Under 3 CSS pixels a module: hard for a phone camera, so full screen is suggested. */
  dense: boolean;
}

/** Below this many CSS pixels a module, a code is dense. */
export const DENSE_PX = 3;

/**
 * The module size for a code `totalModules` wide (quiet zone included) in `maxCssPx` of room
 * (0 or less when the room is not known, which leaves only the cap) on a screen of `dpr` device
 * pixels per CSS pixel. Never less than one device pixel.
 */
export function moduleSize(totalModules: number, maxCssPx: number, dpr: number, o: ModuleSizeOptions): ModuleSize {
  const ratio = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  const want = o.requested ?? o.cap;
  const fit = maxCssPx > 0 && totalModules > 0 ? maxCssPx / totalModules : want;
  // The epsilon keeps 8 * 3 / 3 from flooring to 7.999… device pixels.
  const devicePx = Math.max(1, Math.floor(Math.min(want, fit) * ratio + 1e-9));
  const px = devicePx / ratio;
  return { px, clamped: o.requested !== undefined && px < o.requested, dense: px < DENSE_PX };
}

/** A pixel size as a note says it: `8`, or `8.7` when it is not whole. */
export function formatPx(px: number): string {
  return Number.isInteger(px) ? String(px) : px.toFixed(1);
}
