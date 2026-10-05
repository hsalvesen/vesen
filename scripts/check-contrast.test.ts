import { describe, expect, it } from 'vitest';
import { contrastRatio, measureThemes, parseHex } from './check-contrast.mjs';

describe('contrastRatio', () => {
  it('spans 1:1 to 21:1', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#3a3a3a', '#3a3a3a')).toBe(1);
  });

  it('matches the WCAG reference value for #767676 on white', () => {
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
  });

  it('rejects malformed colours', () => {
    expect(() => parseHex('teal')).toThrow();
  });
});

describe('measureThemes', () => {
  it('measures every text role against the background', () => {
    const theme = {
      name: 'test',
      background: '#000000',
      foreground: '#ffffff',
      white: '#ffffff',
      brightBlack: '#000000',
      cyan: '#00ffff',
      yellow: '#ffff00',
      green: '#00ff00',
      red: '#ff0000',
    };
    const results = measureThemes([theme]);
    expect(results).toHaveLength(7);
    expect(results.find((m) => m.role === 'brightBlack')?.ratio).toBe(1);
  });
});
