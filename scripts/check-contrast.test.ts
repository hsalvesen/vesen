import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { baselineOf, compareWithBaseline, contrastRatio, measureThemes, parseHex } from './check-contrast.mjs';

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

describe('compareWithBaseline', () => {
  const pair = (theme: string, role: string, ratio: number) => ({ theme, role, colour: '#000000', ratio });

  it('passes known failures that are no worse', () => {
    const result = compareWithBaseline([pair('wombat', 'red', 2.494), pair('wombat', 'white', 9)], { 'wombat/red': 2.49 });
    expect(result).toEqual({ regressions: [], cleared: [] });
  });

  it('fails a new pair below 4.5:1 and a known pair that got worse', () => {
    const { regressions } = compareWithBaseline(
      [pair('petroica', 'foreground', 2), pair('wombat', 'red', 2.2)],
      { 'wombat/red': 2.49 },
    );
    expect(regressions).toEqual(['petroica/foreground is 2.00:1, below 4.5:1', 'wombat/red fell from 2.49:1 to 2.20:1']);
  });

  it('lists known pairs that now pass, so the baseline can shrink', () => {
    expect(compareWithBaseline([pair('wombat', 'red', 4.6)], { 'wombat/red': 2.49 }).cleared).toEqual(['wombat/red']);
  });

  it('matches the committed baseline for today\'s themes', () => {
    const themes = JSON.parse(readFileSync(new URL('../themes.json', import.meta.url), 'utf8'));
    const committed = JSON.parse(readFileSync(new URL('./contrast-baseline.json', import.meta.url), 'utf8'));
    expect(compareWithBaseline(measureThemes(themes), committed).regressions).toEqual([]);
    expect(Object.keys(baselineOf(measureThemes(themes)))).toEqual(Object.keys(committed));
  });
});
