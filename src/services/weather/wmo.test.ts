import { describe, expect, it } from 'vitest';
import { textWidth } from '../../output/model';
import type { ArtKey, IconKey, WeatherRole } from './types';
import { ROLE_COLOUR } from './view';
import { ART, ART_HEIGHT, ART_ROLES, ART_WIDTH, MEDIUM_MAX, SHORT_MAX, WMO, WMO_CODES, artFor, compass16, isArtRole, wmo } from './wmo';

/** Every weather_code Open-Meteo documents (https://open-meteo.com/en/docs, "WMO Weather interpretation codes"). */
const DOCUMENTED = [0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99];

const ICONS: readonly IconKey[] = [
  'clear', 'partly', 'cloudy', 'fog', 'drizzle', 'rain', 'heavyRain', 'sleet', 'snow', 'heavySnow', 'thunder', 'unknown',
];
const ART_KEYS: readonly ArtKey[] = [...ICONS, 'clearNight', 'partlyNight'];

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

  it('groups codes into the expected icons', () => {
    const icon = (code: number): IconKey => (WMO[code] ?? wmo(null)).icon;
    expect([0, 1].map(icon)).toEqual(['clear', 'clear']);
    expect(icon(2)).toBe('partly');
    expect(icon(3)).toBe('cloudy');
    expect([45, 48].map(icon)).toEqual(['fog', 'fog']);
    expect([56, 57, 66, 67].map(icon)).toEqual(['sleet', 'sleet', 'sleet', 'sleet']);
    expect([65, 82].map(icon)).toEqual(['heavyRain', 'heavyRain']);
    expect([75, 86].map(icon)).toEqual(['heavySnow', 'heavySnow']);
    expect([95, 96, 99].map(icon)).toEqual(['thunder', 'thunder', 'thunder']);
  });
});

describe('art', () => {
  it('has art for every icon and night variant', () => {
    expect(Object.keys(ART).sort()).toEqual([...ART_KEYS].sort());
  });

  /** What the art may be drawn with: printable ASCII, the backtick left out (it would end a template literal). */
  const ART_CHARS = /^[ -_a-~]*$/;

  it.each(ART_KEYS)('%s is 5 rows of exactly 13 columns of printable ASCII', (key) => {
    const rows = ART[key];
    expect(rows).toHaveLength(ART_HEIGHT);
    for (const row of rows) {
      const text = row.map(([, s]) => s).join('');
      expect(textWidth(text)).toBe(ART_WIDTH);
      expect(text).toMatch(ART_CHARS);
      for (const [, piece] of row) expect(piece.length, 'no segment is empty').toBeGreaterThan(0);
    }
  });

  it('draws every pictogram with letters and punctuation, nothing from outside ASCII', () => {
    for (const key of ART_KEYS) {
      const text = ART[key].map((row) => row.map(([, s]) => s).join('')).join('\n');
      expect(text, key).toMatch(/[^ \n]/);
      expect(text, key).toMatch(/^[\x20-\x7e\n]*$/);
      expect(text, key).not.toContain('`');
    }
  });

  it('traces each shape with the strokes of its kind', () => {
    const text = (key: ArtKey): string => ART[key].map((row) => row.map(([, s]) => s).join('')).join('\n');
    // The sun: a shaded disc between its rays.
    expect(text('clear')).toMatch(/\\ {3}\| {3}\//);
    expect(text('clear')).toContain('(:::::)');
    expect(text('clear')).toMatch(/\/ {3}\| {3}\\/);
    // The moon: a shaded crescent and dot stars.
    expect(text('clearNight')).toContain('(::(');
    expect(text('clearNight').match(/\./g)?.length).toBeGreaterThanOrEqual(5);
    // Clouds: a rounded top and a flat base.
    for (const key of ['partly', 'partlyNight', 'cloudy', 'drizzle', 'rain', 'thunder'] as const) {
      expect(text(key), key).toContain('.-');
      expect(text(key), key).toContain('(__________)');
    }
    // Fog: bands of ~ and -.
    expect(text('fog')).toMatch(/~{9}/);
    expect(text('fog')).toMatch(/-{4}/);
    // Thunder: a bolt of _ and / under the cloud.
    expect(text('thunder')).toContain('____/');
    // The unknown mark: a question mark with a dot under its stem.
    expect(text('unknown').split('\n').slice(2)).toEqual(["      .'     ", '      |      ', '      o      ']);
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

  it('colours the sun, the cloud and the rain in their own roles, and the night sky in the moon', () => {
    const roles = (key: ArtKey) => new Set(ART[key].flatMap((row) => row.map(([role]) => role)));
    expect(roles('clear')).toEqual(new Set(['sun']));
    expect(roles('clearNight')).toEqual(new Set(['moon']));
    expect(roles('partly')).toEqual(new Set(['sun', 'cloud']));
    expect(roles('partlyNight')).toEqual(new Set(['moon', 'cloud']));
    expect(roles('rain')).toEqual(new Set(['cloud', 'rain']));
    expect(roles('sleet')).toEqual(new Set(['cloud', 'rain', 'snow']));
    expect(roles('thunder')).toEqual(new Set(['cloud', 'rain', 'bolt']));
    expect(roles('cloudy')).toEqual(new Set(['cloud']));
    expect(roles('snow')).toEqual(new Set(['cloud', 'snow']));
    expect(roles('fog')).toEqual(new Set(['fog']));
    expect(roles('unknown')).toEqual(new Set(['fog']));
  });

  it('draws the rain heavier from drizzle to heavy rain, and the snow thicker', () => {
    const fall = (key: ArtKey) => ART[key].slice(3).map((row) => row.map(([, s]) => s).join(''));
    expect(fall('drizzle').join('')).toMatch(/^[ '.]+$/);
    expect(fall('rain').join('')).toMatch(/^[ ',]+$/);
    expect(fall('heavyRain').join('')).toMatch(/^[ ',]+$/);
    expect(fall('snow').join('')).toMatch(/^[ *.]+$/);
    expect(fall('heavySnow').join('')).toMatch(/^[ *.]+$/);
    expect(fall('sleet').join('')).toMatch(/^[ ',*]+$/);
    const marks = (key: ArtKey) => fall(key).join('').replace(/ /g, '').length;
    expect(marks('drizzle')).toBeLessThan(marks('rain'));
    expect(marks('rain')).toBeLessThan(marks('heavyRain'));
    expect(marks('snow')).toBeLessThan(marks('heavySnow'));
  });

  it('draws the moon at night for clear and partly cloudy skies only', () => {
    expect(artFor('clear', true)).toBe(ART.clear);
    expect(artFor('clear', false)).toBe(ART.clearNight);
    expect(artFor('partly', false)).toBe(ART.partlyNight);
    expect(artFor('rain', false)).toBe(ART.rain);
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
