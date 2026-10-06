import { describe, expect, it } from 'vitest';
import type { ArtKey, IconKey } from './types';
import { ART, ART_HEIGHT, ART_WIDTH, MEDIUM_MAX, SHORT_MAX, WMO, WMO_CODES, artFor, compass16, wmo } from './wmo';

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

  it.each(ART_KEYS)('%s is 5 rows of exactly 13 printable ASCII columns', (key) => {
    const rows = ART[key];
    expect(rows).toHaveLength(ART_HEIGHT);
    for (const row of rows) {
      const text = row.map(([, s]) => s).join('');
      expect(text).toHaveLength(ART_WIDTH);
      expect(text).toMatch(/^[\x20-\x7E]*$/);
    }
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
