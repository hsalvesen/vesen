import { describe, expect, it } from 'vitest';
import themes from '../../themes.json';
import { colorSchemeFor, parseHex, relativeLuminance } from './colour';

describe('colour', () => {
  it('parses short and long hex, with or without #', () => {
    expect(parseHex('#fff')).toEqual([255, 255, 255]);
    expect(parseHex('222235')).toEqual([0x22, 0x22, 0x35]);
    expect(parseHex('#E8DDD0')).toEqual([0xe8, 0xdd, 0xd0]);
    expect(parseHex('red')).toBeNull();
    expect(parseHex('#12345')).toBeNull();
  });

  it('computes WCAG relative luminance', () => {
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 10);
    expect(relativeLuminance('#808080')).toBeCloseTo(0.2159, 4);
    expect(relativeLuminance('nope')).toBeNull();
  });

  it('gives light backgrounds a light color-scheme', () => {
    expect(colorSchemeFor('#ffffff')).toBe('light');
    expect(colorSchemeFor('#000000')).toBe('dark');
    // Black and white text contrast equally with a luminance of about 0.179.
    expect(colorSchemeFor('#757575')).toBe('dark');
    expect(colorSchemeFor('#767676')).toBe('light');
    expect(colorSchemeFor('not a colour')).toBe('dark');
  });

  it('makes cockatoo the one light theme', () => {
    const light = themes.filter((t) => colorSchemeFor(t.background) === 'light').map((t) => t.name);
    expect(light).toEqual(['cockatoo']);
  });
});
