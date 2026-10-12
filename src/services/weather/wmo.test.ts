import { describe, expect, it } from 'vitest';
import { textWidth } from '../../output/model';
import type { ArtKey, IconKey, WeatherRole } from './types';
import { ROLE_COLOUR } from './view';
import { ART, ART_FALLBACK_GLYPHS, ART_HEIGHT, ART_ROLES, ART_WIDTH, MEDIUM_MAX, SHORT_MAX, WMO, WMO_CODES, artFor, compass16, isArtRole, wmo } from './wmo';

/** Every weather_code Open-Meteo documents (https://open-meteo.com/en/docs, "WMO Weather interpretation codes"). */
const DOCUMENTED = [0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99];

/** wttr.in's icons: wego's names, in its table's order. */
const ICONS: readonly IconKey[] = [
  'sunny', 'partlyCloudy', 'cloudy', 'veryCloudy', 'fog', 'lightRain', 'heavyRain', 'lightShowers', 'heavyShowers',
  'lightSleet', 'lightSleetShowers', 'lightSnow', 'heavySnow', 'lightSnowShowers', 'heavySnowShowers',
  'thunderyShowers', 'thunderyHeavyRain', 'thunderySnowShowers', 'unknown',
];
const ART_KEYS: readonly ArtKey[] = ICONS;

describe('wmo', () => {
  it('maps exactly the documented codes', () => {
    expect(WMO_CODES).toEqual(DOCUMENTED);
  });

  it.each(DOCUMENTED)('maps code %i to a label, short labels and an icon', (code) => {
    const info = wmo(code);
    expect(info.icon).not.toBe('unknown');
    expect(info.label.length).toBeGreaterThan(0);
    expect(info.medium.length).toBeLessThanOrEqual(MEDIUM_MAX);
    expect(info.short.length).toBeLessThanOrEqual(SHORT_MAX);
    expect(ICONS).toContain(info.icon);
  });

  it('falls back to Unknown for every other code from 0 to 99, null and odd keys', () => {
    for (let code = 0; code <= 99; code += 1) {
      if (DOCUMENTED.includes(code)) continue;
      expect(wmo(code)).toMatchObject({ label: 'Unknown', icon: 'unknown' });
    }
    expect(wmo(null).icon).toBe('unknown');
    expect(wmo(undefined).icon).toBe('unknown');
    expect(wmo(-1).icon).toBe('unknown');
    expect(wmo(2.5).icon).toBe('unknown');
  });

  it("groups codes into wego's icons, as wttr.in groups the like conditions", () => {
    const icon = (code: number): IconKey => (WMO[code] ?? wmo(null)).icon;
    expect([0, 1].map(icon)).toEqual(['sunny', 'sunny']);
    expect(icon(2)).toBe('partlyCloudy');
    expect(icon(3)).toBe('veryCloudy');
    expect([45, 48].map(icon)).toEqual(['fog', 'fog']);
    expect([51, 53, 55, 61].map(icon)).toEqual(['lightRain', 'lightRain', 'lightRain', 'lightRain']);
    expect([63, 65].map(icon)).toEqual(['heavyRain', 'heavyRain']);
    expect([56, 57, 66, 67].map(icon)).toEqual(['lightSleet', 'lightSleet', 'lightSleet', 'lightSleet']);
    expect([71, 77].map(icon)).toEqual(['lightSnow', 'lightSnow']);
    expect([73, 75].map(icon)).toEqual(['heavySnow', 'heavySnow']);
    expect(icon(80)).toBe('lightShowers');
    expect([81, 82].map(icon)).toEqual(['heavyShowers', 'heavyShowers']);
    expect([85, 86].map(icon)).toEqual(['lightSnowShowers', 'heavySnowShowers']);
    expect(icon(95)).toBe('thunderyShowers');
    expect([96, 99].map(icon)).toEqual(['thunderyHeavyRain', 'thunderyHeavyRain']);
  });
});

describe('art', () => {
  const text = (key: ArtKey): string => ART[key].map((row) => row.map(([, s]) => s).join('')).join('\n');
  const rows = (key: ArtKey): string[] => text(key).split('\n');

  it('has art for every icon, and nothing else', () => {
    expect(Object.keys(ART).sort()).toEqual([...ART_KEYS].sort());
  });

  /** What wttr.in's art is drawn with: printable ASCII and its six glyphs from outside it. */
  const ART_CHARS = /^[ -~ʻ᾿‒‚•⚡]*$/;

  it.each(ART_KEYS)('%s is 5 rows of exactly 13 columns', (key) => {
    const art = ART[key];
    expect(art).toHaveLength(ART_HEIGHT);
    for (const row of art) {
      const line = row.map(([, s]) => s).join('');
      expect(textWidth(line)).toBe(ART_WIDTH);
      expect(Array.from(line)).toHaveLength(ART_WIDTH);
      expect(line).toMatch(ART_CHARS);
      for (const [, piece] of row) expect(piece.length, 'no segment is empty').toBeGreaterThan(0);
    }
  });

  it("is wttr.in's table, row for row: the sun, the clouds, the showers, the fog and the unknown mark", () => {
    expect(rows('sunny')).toEqual(['    \\   /    ', '     .-.     ', '  ‒ (   ) ‒  ', '     `-᾿     ', '    /   \\    ']);
    expect(rows('partlyCloudy')).toEqual(['   \\  /      ', ' _ /"".-.    ', '   \\_(   ).  ', '   /(___(__) ', '             ']);
    expect(rows('cloudy')).toEqual(['             ', '     .--.    ', '  .-(    ).  ', ' (___.__)__) ', '             ']);
    expect(rows('veryCloudy')).toEqual(rows('cloudy'));
    expect(rows('fog')).toEqual(['             ', ' _ - _ - _ - ', '  _ - _ - _  ', ' _ - _ - _ - ', '             ']);
    expect(rows('lightRain')).toEqual(['     .-.     ', '    (   ).   ', '   (___(__)  ', '    ʻ ʻ ʻ ʻ  ', '   ʻ ʻ ʻ ʻ   ']);
    expect(rows('heavyRain')).toEqual(['     .-.     ', '    (   ).   ', '   (___(__)  ', '  ‚ʻ‚ʻ‚ʻ‚ʻ   ', '  ‚ʻ‚ʻ‚ʻ‚ʻ   ']);
    expect(rows('lightShowers')).toEqual([' _`/"".-.    ', '  ,\\_(   ).  ', '   /(___(__) ', '     ʻ ʻ ʻ ʻ ', '    ʻ ʻ ʻ ʻ  ']);
    expect(rows('thunderyShowers')).toEqual([' _`/"".-.    ', '  ,\\_(   ).  ', '   /(___(__) ', '    ⚡ʻ ʻ⚡ʻ ʻ ', '    ʻ ʻ ʻ ʻ  ']);
    expect(rows('lightSleet')).toEqual(['     .-.     ', '    (   ).   ', '   (___(__)  ', '    ʻ * ʻ *  ', '   * ʻ * ʻ   ']);
    expect(rows('heavySnow')).toEqual(['     .-.     ', '    (   ).   ', '   (___(__)  ', '   * * * *   ', '  * * * *    ']);
    expect(rows('unknown')).toEqual(['    .-.      ', '     __)     ', '    (        ', '     `-᾿     ', '      •      ']);
    // Every shower has the sun peeping over the cloud; every other cloud stands alone.
    for (const key of ART_KEYS) {
      if (key.endsWith('Showers') || key === 'partlyCloudy') expect(text(key), key).toMatch(/\//);
      else if (key !== 'sunny' && key !== 'fog' && key !== 'unknown') expect(rows(key)[0], key).toMatch(/^ *(\.-\.|\.--\.)? *$/);
    }
  });

  it('uses the font for all but three glyphs, which the card pins to one cell', () => {
    const outside = new Set<string>();
    for (const key of ART_KEYS) for (const ch of text(key)) if (ch.codePointAt(0)! > 0x7e) outside.add(ch);
    expect([...outside].sort()).toEqual(['ʻ', '᾿', '‒', '‚', '•', '⚡']);
    expect([...ART_FALLBACK_GLYPHS].sort()).toEqual(['᾿', '‒', '⚡']);
  });

  it('carries only art roles, which no text role shares, so the card can tell the art lines apart', () => {
    const textRoles: readonly WeatherRole[] = ['text', 'head', 'place', 'cond', 'temp', 'cold', 'hot', 'wind', 'pct', 'mm', 'dim', 'warn'];
    for (const role of textRoles) expect(isArtRole(role), role).toBe(false);
    for (const role of ART_ROLES) {
      expect(isArtRole(role), role).toBe(true);
      expect(ROLE_COLOUR[role]).toBeDefined();
    }
    expect(isArtRole('bar')).toBe(false);
    expect(isArtRole(undefined)).toBe(false);
    for (const key of ART_KEYS) {
      for (const row of ART[key]) for (const [role] of row) expect(isArtRole(role), `${key}: ${role}`).toBe(true);
    }
    // The unknown mark and the blank rows read as muted and empty, as they did in dim.
    expect(ROLE_COLOUR.fog).toBe(ROLE_COLOUR.dim);
  });

  it("colours each run as wego does: the sun, the cloud, the rain, the snow and the bolt in their own roles", () => {
    const roles = (key: ArtKey) => new Set(ART[key].flatMap((row) => row.map(([role]) => role)));
    expect(roles('sunny')).toEqual(new Set(['sun']));
    expect(roles('partlyCloudy')).toEqual(new Set(['sun', 'cloud']));
    expect(roles('cloudy')).toEqual(new Set(['cloud']));
    expect(roles('fog')).toEqual(new Set(['fog']));
    expect(roles('lightRain')).toEqual(new Set(['cloud', 'rain']));
    expect(roles('lightShowers')).toEqual(new Set(['sun', 'cloud', 'rain']));
    expect(roles('lightSleet')).toEqual(new Set(['cloud', 'rain', 'snow']));
    expect(roles('heavySnow')).toEqual(new Set(['cloud', 'snow']));
    expect(roles('thunderyShowers')).toEqual(new Set(['sun', 'cloud', 'rain', 'bolt']));
    expect(roles('thunderySnowShowers')).toEqual(new Set(['sun', 'cloud', 'snow', 'bolt']));
    expect(roles('unknown')).toEqual(new Set(['fog']));
    // The sleet's rows alternate drop and flake, each in its own role.
    expect(ART.lightSleet[3]).toEqual([['rain', '    ʻ '], ['snow', '*'], ['rain', ' ʻ '], ['snow', '*  ']]);
    // The sun of a shower and its cloud split within the row.
    expect(ART.lightShowers[0]).toEqual([['sun', ' _`/""'], ['cloud', '.-.    ']]);
  });

  it('draws the same art by day and by night, as wttr.in does', () => {
    for (const key of ART_KEYS) {
      expect(artFor(key, true)).toBe(ART[key]);
      expect(artFor(key, false)).toBe(ART[key]);
    }
  });
});

describe('compass16', () => {
  it('names 16 points and wraps around', () => {
    expect([0, 11.24, 11.26, 22.5, 90, 180, 270, 337.5, 359, 360, -10, 720].map(compass16)).toEqual([
      'N', 'N', 'NNE', 'NNE', 'E', 'S', 'W', 'NNW', 'N', 'N', 'N', 'N',
    ]);
  });

  it('is empty when unknown', () => {
    expect(compass16(null)).toBe('');
    expect(compass16(Number.NaN)).toBe('');
  });
});
