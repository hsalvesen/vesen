import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deriveRoles, roleChecks, type ThemeColours } from '../src/lib/roles';
import {
  baselineOf,
  compareWithBaseline,
  contrastRatio,
  importTranspiled,
  invalidRoleOverrides,
  measureRoles,
  measureThemes,
  parseHex,
} from './check-contrast.mjs';

const themes: ThemeColours[] = JSON.parse(readFileSync(new URL('../themes.json', import.meta.url), 'utf8'));

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
    const committed = JSON.parse(readFileSync(new URL('./contrast-baseline.json', import.meta.url), 'utf8'));
    expect(compareWithBaseline(measureThemes(themes), committed).regressions).toEqual([]);
    expect(Object.keys(baselineOf(measureThemes(themes)))).toEqual(Object.keys(committed));
  });
});

describe('measureRoles', () => {
  it('measures the colours the app applies, with the same requirements', () => {
    const measured = measureRoles(themes);
    for (const theme of themes) {
      const applied = deriveRoles(theme);
      const checks = roleChecks(theme, applied);
      const own = measured.filter((m) => m.theme === theme.name);
      expect(own.map(({ role, against, ratio, min }) => ({ role, against, ratio, min }))).toEqual(checks);
      for (const m of own) expect(m.colour).toBe(applied[m.role as keyof typeof applied]);
    }
  });

  it('finds every role in every committed theme at or above its minimum, as --strict requires', () => {
    expect(measureRoles(themes).filter((m) => m.ratio < m.min)).toEqual([]);
    expect(invalidRoleOverrides(themes)).toEqual([]);
  });

  it('reports a hex override that fails, since the app uses a theme\'s own hex as it is', () => {
    const swamphen = themes.find((t) => t.name === 'swamphen');
    if (!swamphen) throw new Error('no swamphen');
    const failing = measureRoles([{ ...swamphen, roles: { error: '#2a2a40' } }]).filter((m) => m.ratio < m.min);
    expect(failing.map((m) => `${m.role} on ${m.against}`)).toContain('error on background');
  });

  it('flags overrides that name no role or no colour', () => {
    const swamphen = themes.find((t) => t.name === 'swamphen');
    if (!swamphen) throw new Error('no swamphen');
    const odd = { ...swamphen, roles: { warn: 'orange', glow: '#ffffff', sun: 'blue', rain: '#abc' } } as unknown as ThemeColours;
    expect(invalidRoleOverrides([odd])).toEqual([
      "swamphen: warn is 'orange', neither a hex colour nor a palette slot",
      "swamphen: 'glow' is not a role",
    ]);
  });
});

describe('importTranspiled', () => {
  it('loads the role code on a Node without type stripping, giving the same colours', async () => {
    const transpiled = (await importTranspiled(fileURLToPath(new URL('../src/lib/roles.ts', import.meta.url)))) as {
      deriveRoles: typeof deriveRoles;
    };
    expect(themes.map((theme) => transpiled.deriveRoles(theme))).toEqual(themes.map((theme) => deriveRoles(theme)));
  });
});

