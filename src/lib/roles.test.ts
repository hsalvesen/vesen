import { describe, expect, it } from 'vitest';
import themesJson from '../../themes.json';
import { ROLES } from '../output/model';
import { colorSchemeFor, contrastRatio, parseHex, relativeLuminance } from './colour';
import { deriveRoles, PANEL_TONES, QR_MIN, ROLE_NAMES, roleChecks, TEXT_ROLES, type ThemeColours } from './roles';

const themes: readonly ThemeColours[] = themesJson;

function named(name: string): ThemeColours {
  const found = themes.find((t) => t.name === name);
  if (!found) throw new Error(`no theme ${name}`);
  return found;
}

function hue(hex: string): number {
  const [r, g, b] = (parseHex(hex) ?? [0, 0, 0]).map((c) => c / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

const hueDistance = (a: string, b: string) => {
  const d = Math.abs(hue(a) - hue(b)) % 360;
  return Math.min(d, 360 - d);
};

describe('roles', () => {
  it('names every role the output model has, in the same order', () => {
    expect([...ROLE_NAMES]).toEqual([...ROLES]);
  });

  it('gives every theme a hex colour for every role', () => {
    for (const theme of themes) {
      const roles = deriveRoles(theme);
      expect(Object.keys(roles)).toEqual([...ROLES]);
      for (const role of ROLES) expect(roles[role], `${theme.name} ${role}`).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it.each(themes.map((t) => [t.name, t] as const))('meets every contrast requirement in %s', (_, theme) => {
    const failing = roleChecks(theme).filter((check) => check.ratio < check.min);
    expect(failing).toEqual([]);
  });

  it('checks every text role on the background, and the panel tones on their own tint', () => {
    const checks = roleChecks(named('swamphen'));
    for (const role of TEXT_ROLES) expect(checks.some((c) => c.role === role && c.against === 'background' && c.min === 4.5)).toBe(true);
    for (const tone of PANEL_TONES) expect(checks.some((c) => c.role === tone && c.against === `tint:${tone}`)).toBe(true);
    expect(checks.find((c) => c.role === 'ghost')?.min).toBe(3);
    expect(checks.find((c) => c.role === 'chip-fg')?.against).toBe('chip-bg');
    // A selected chip's outline is the accent: a mark, measured on the chip at 3:1.
    expect(checks.find((c) => c.role === 'accent' && c.against === 'chip-bg')?.min).toBe(3);
    expect(checks.find((c) => c.role === 'qr-ink')?.min).toBe(QR_MIN);
  });

  it('keeps a palette colour that already reads, and nudges one that does not, keeping its hue', () => {
    const swamphen = deriveRoles(named('swamphen'));
    expect(swamphen['prompt-host']).toBe('#06c993');
    // Swamphen's red is 3.75:1 on its background.
    expect(swamphen.error).not.toBe('#f60055');
    expect(contrastRatio(swamphen.error, '#222235')).toBeGreaterThanOrEqual(4.5);
    expect(hueDistance(swamphen.error, '#f60055')).toBeLessThan(2);
  });

  it("uses a theme's own hex as it is, and nudges a palette slot it names", () => {
    expect(deriveRoles(named('swamphen')).warn).toBe('#f4c95d');
    const cockatoo = named('cockatoo');
    expect(deriveRoles(cockatoo)['fg-strong']).toBe(cockatoo.black.toLowerCase());
    const pale: ThemeColours = { ...cockatoo, roles: { accent: 'brightBlack' } };
    const accent = deriveRoles(pale).accent;
    expect(accent).not.toBe(cockatoo.brightBlack.toLowerCase());
    expect(contrastRatio(accent, cockatoo.background)).toBeGreaterThanOrEqual(4.5);
  });

  it('ignores an override that is neither hex nor a palette slot', () => {
    const swamphen = named('swamphen');
    expect(deriveRoles({ ...swamphen, roles: { accent: 'teal' } }).accent).toBe(deriveRoles({ ...swamphen, roles: {} }).accent);
  });

  it("gives swamphen a warm warning and sun, apart from its errors and the prompt's user", () => {
    const roles = deriveRoles(named('swamphen'));
    const h = hue(roles.warn);
    expect(h).toBeGreaterThan(25);
    expect(h).toBeLessThan(65);
    expect(roles.sun).toBe(roles.warn);
    expect(hueDistance(roles.warn, roles.error)).toBeGreaterThan(40);
    expect(hueDistance(roles.warn, roles['prompt-user'])).toBeGreaterThan(40);
  });

  it('gives cockatoo, the light theme, dark text and dark accents', () => {
    const cockatoo = named('cockatoo');
    expect(colorSchemeFor(cockatoo.background)).toBe('light');
    const roles = deriveRoles(cockatoo);
    expect(relativeLuminance(roles['fg-strong']) ?? 1).toBeLessThan(relativeLuminance(roles.fg) ?? 0);
    for (const role of ['accent', 'warn', 'ok', 'error', 'link', 'muted'] as const) {
      expect(contrastRatio(roles[role], cockatoo.background), role).toBeGreaterThanOrEqual(4.5);
      expect(relativeLuminance(roles[role]) ?? 1, role).toBeLessThan(relativeLuminance(cockatoo.background) ?? 0);
    }
  });

  it('draws QR codes dark on light in every theme', () => {
    for (const theme of themes) {
      const roles = deriveRoles(theme);
      expect(relativeLuminance(roles['qr-ink']) ?? 1, theme.name).toBeLessThan(relativeLuminance(roles['qr-paper']) ?? 0);
      expect(contrastRatio(roles['qr-ink'], roles['qr-paper']), theme.name).toBeGreaterThanOrEqual(QR_MIN);
    }
  });

  it('falls back to black on white for QR codes when no theme pair is far enough apart', () => {
    const grey: ThemeColours = Object.fromEntries(
      Object.entries(named('wallaby')).map(([key, value]) => [key, key === 'name' ? 'grey' : '#808080']),
    ) as unknown as ThemeColours;
    const roles = deriveRoles(grey);
    expect([roles['qr-ink'], roles['qr-paper']]).toEqual(['#000000', '#ffffff']);
  });
});
