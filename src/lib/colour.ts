// Colour arithmetic shared by the app, the boot script plugin and the asset scripts.

/** sRGB channels, 0-255, of `#rgb` or `#rrggbb`; null for anything else. */
export function parseHex(hex: string): [number, number, number] | null {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  const digits = match?.[1];
  if (digits === undefined) return null;
  const full = digits.length === 3 ? digits.replace(/./g, (d) => d + d) : digits;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
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
