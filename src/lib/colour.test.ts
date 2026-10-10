import { describe, expect, it } from 'vitest';
import themes from '../../themes.json';
import {
  colorSchemeFor,
  contrastRatio,
  ensureContrast,
  isHexColour,
  mix,
  parseHex,
  relativeLuminance,
  toHex,
} from './colour';

/** Hue in degrees, for checking that a nudged colour keeps its hue. */
function hue(hex: string): number {
  const [r, g, b] = (parseHex(hex) ?? [0, 0, 0]).map((c) => c / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

describe('colour', () => {
  it('parses short and long hex, with or without #', () => {
    expect(parseHex('#fff')).toEqual([255, 255, 255]);
    expect(parseHex('222235')).toEqual([0x22, 0x22, 0x35]);
    expect(parseHex('#E8DDD0')).toEqual([0xe8, 0xdd, 0xd0]);
    expect(parseHex('red')).toBeNull();
    expect(parseHex('#12345')).toBeNull();
  });

  it('accepts only # hex as a theme colour, and writes channels back as lower-case hex', () => {
    expect(isHexColour('#5DA3C1')).toBe(true);
    expect(isHexColour('5DA3C1')).toBe(false);
    expect(isHexColour('cyan')).toBe(false);
    expect(isHexColour(undefined)).toBe(false);
    expect(toHex([93, 163, 193])).toBe('#5da3c1');
    expect(toHex([-4, 255.6, 127.5])).toBe('#00ff80');
  });

  it('computes WCAG relative luminance', () => {
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 10);
    expect(relativeLuminance('#808080')).toBeCloseTo(0.2159, 4);
    expect(relativeLuminance('nope')).toBeNull();
  });

  it('computes WCAG contrast either way round, and none for a non-colour', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
    expect(contrastRatio('#3a3a3a', '#3a3a3a')).toBe(1);
    expect(contrastRatio('teal', '#ffffff')).toBe(1);
  });

  it('mixes in sRGB the way color-mix(in srgb) does', () => {
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mix('#222235', '#5da3c1', 0)).toBe('#222235');
    expect(mix('#222235', '#5da3c1', 1)).toBe('#5da3c1');
    // A 12% tint: 34 + (93 - 34) * 0.12 = 41.08, 34 + (163 - 34) * 0.12 = 49.48, 53 + (193 - 53) * 0.12 = 69.8.
    expect(mix('#222235', '#5da3c1', 0.12)).toBe('#293146');
    expect(mix('#222235', '#5da3c1', 7)).toBe('#5da3c1');
  });

  it('gives light backgrounds a light color-scheme', () => {
    expect(colorSchemeFor('#ffffff')).toBe('light');
    expect(colorSchemeFor('#000000')).toBe('dark');
    // Black and white text contrast equally with a luminance of about 0.179.
    expect(colorSchemeFor('#757575')).toBe('dark');
    expect(colorSchemeFor('#767676')).toBe('light');
    expect(colorSchemeFor('not a colour')).toBe('dark');
  });

  it('makes cockatoo and quokka the two light themes', () => {
    const light = themes.filter((t) => colorSchemeFor(t.background) === 'light').map((t) => t.name);
    expect(light).toEqual(['cockatoo', 'quokka']);
  });
});

describe('ensureContrast', () => {
  it('returns a colour that already passes as it is', () => {
    expect(ensureContrast('#FFFFFF', '#222235', 4.5)).toBe('#ffffff');
  });

  it('lightens on a dark background and darkens on a light one, keeping the hue', () => {
    const lighter = ensureContrast('#f60055', '#222235', 4.5);
    expect(contrastRatio(lighter, '#222235')).toBeGreaterThanOrEqual(4.5);
    expect(relativeLuminance(lighter)).toBeGreaterThan(relativeLuminance('#f60055') ?? 1);
    expect(Math.abs(hue(lighter) - hue('#f60055'))).toBeLessThan(2);

    const darker = ensureContrast('#eaa549', '#e8ddd0', 4.5);
    expect(contrastRatio(darker, '#e8ddd0')).toBeGreaterThanOrEqual(4.5);
    expect(Math.abs(hue(darker) - hue('#eaa549'))).toBeLessThan(2);
  });

  it('moves no further than it has to', () => {
    const nudged = ensureContrast('#5c6370', '#1d1e20', 4.5);
    expect(contrastRatio(nudged, '#1d1e20')).toBeLessThan(4.6);
  });

  it('meets a custom measure, such as a tint of the colour itself', () => {
    const measure = (c: string) => contrastRatio(c, mix('#222235', c, 0.12));
    expect(measure(ensureContrast('#f60055', '#222235', 4.5, measure))).toBeGreaterThanOrEqual(4.5);
  });

  it('gives white or black when nothing in between passes, and leaves a non-colour alone', () => {
    expect(ensureContrast('#777777', '#000000', 21)).toBe('#ffffff');
    expect(ensureContrast('#777777', '#ffffff', 21)).toBe('#000000');
    expect(ensureContrast('teal', '#000000', 4.5)).toBe('teal');
  });
});
