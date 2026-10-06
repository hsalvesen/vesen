// Colour arithmetic shared by the app, the boot script plugin and the asset and contrast scripts.
// Pure functions on `#rrggbb` strings; nothing here touches the DOM. scripts/check-contrast.mjs
// imports this file directly, so it imports nothing and uses only erasable TypeScript.

export type Rgb = readonly [number, number, number];

/** sRGB channels, 0-255, of `#rgb` or `#rrggbb`; null for anything else. */
export function parseHex(hex: string): [number, number, number] | null {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  const digits = match?.[1];
  if (digits === undefined) return null;
  const full = digits.length === 3 ? digits.replace(/./g, (d) => d + d) : digits;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
}

/** True for `#rgb` and `#rrggbb`, the only colour syntax themes.json uses. */
export function isHexColour(value: unknown): value is string {
  return typeof value === 'string' && value.trim().startsWith('#') && parseHex(value) !== null;
}

/** `#rrggbb`, lower case, from channels that are rounded and clamped to 0-255. */
export function toHex(rgb: Rgb): string {
  return `#${rgb.map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, '0')).join('')}`;
}

/** WCAG relative luminance, 0 (black) to 1 (white); null when `hex` is not a colour. */
export function relativeLuminance(hex: string): number | null {
  const rgb = parseHex(hex);
  if (rgb === null) return null;
  const [r, g, b] = rgb.map((channel) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1 to 21. A value that is not a colour counts as no contrast (1). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  if (la === null || lb === null) return 1;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * `from` moved `amount` of the way to `to`, channel by channel in sRGB, as CSS
 * `color-mix(in srgb, to <amount>, from)` does. A 12% tint of a tone over the background, which
 * is what `color-mix(in srgb, tone 12%, transparent)` paints, is `mix(background, tone, 0.12)`.
 */
export function mix(from: string, to: string, amount: number): string {
  const a = parseHex(from);
  const b = parseHex(to);
  if (a === null || b === null) return from;
  const t = Math.min(1, Math.max(0, amount));
  return toHex([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
}

/**
 * The `color-scheme` for a page on this background: `light` when black text would contrast
 * with it more than white text, so native scrollbars and form controls match the theme.
 */
export function colorSchemeFor(background: string): 'light' | 'dark' {
  const l = relativeLuminance(background);
  if (l === null) return 'dark';
  // (1 + 0.05) / (l + 0.05) > (l + 0.05) / 0.05 solves to l > sqrt(1.05 * 0.05) - 0.05.
  return l > Math.sqrt(1.05 * 0.05) - 0.05 ? 'light' : 'dark';
}

/** Hue (0-360), saturation and lightness (0-1). */
type Hsl = readonly [number, number, number];

function toHsl(rgb: Rgb): Hsl {
  const [r, g, b] = rgb.map((c) => c / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}

function fromHsl([h, s, l]: Hsl): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const sector = Math.floor(h / 60) % 6;
  const [r, g, b] = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ][sector] as [number, number, number];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

/**
 * The colour, keeping its hue and saturation, at the lightness nearest its own that makes
 * `measure` reach `ratio`, moving away from `background`: lighter on a dark background, darker
 * on a light one. `measure` gives the contrast of a candidate, so a check can involve more than
 * one backdrop (the background and a tint of the candidate itself, say). The colour comes back
 * unchanged when it already passes; white or black when nothing in between does.
 */
export function ensureContrast(
  colour: string,
  background: string,
  ratio: number,
  measure: (candidate: string) => number = (candidate) => contrastRatio(candidate, background),
): string {
  const rgb = parseHex(colour);
  if (rgb === null) return colour;
  const start = toHex(rgb);
  if (measure(start) >= ratio) return start;

  const lighter = colorSchemeFor(background) === 'dark';
  const extreme = lighter ? '#ffffff' : '#000000';
  if (measure(extreme) < ratio) return extreme;

  const [h, s, l] = toHsl(rgb);
  const at = (lightness: number) => toHex(fromHsl([h, s, lightness]));
  // Luminance only grows with HSL lightness at a fixed hue and saturation, so this bisects.
  let fail = l;
  let pass = lighter ? 1 : 0;
  for (let i = 0; i < 24; i += 1) {
    const mid = (fail + pass) / 2;
    if (measure(at(mid)) >= ratio) pass = mid;
    else fail = mid;
  }
  // Rounding to whole channels can land a hair short; step on until the hex itself passes.
  const step = lighter ? 0.002 : -0.002;
  let candidate = at(pass);
  for (let lightness = pass; measure(candidate) < ratio && lightness >= 0 && lightness <= 1; lightness += step) {
    candidate = at(Math.min(1, Math.max(0, lightness)));
  }
  return measure(candidate) >= ratio ? candidate : extreme;
}
