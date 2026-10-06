import { describe, expect, it } from 'vitest';
import {
  UNIT_PRESETS, cToF, defaultUnits, formatPrecip, isUnitSystem, kmhToMph, mmToIn, precipitation, round, temperature,
  windSpeed,
} from './units';

const { metric, imperial, uk } = UNIT_PRESETS;

describe('presets', () => {
  it('pairs each system with its units', () => {
    expect(metric).toEqual({ system: 'metric', temp: '°C', wind: 'km/h', precip: 'mm' });
    expect(imperial).toEqual({ system: 'imperial', temp: '°F', wind: 'mph', precip: 'in' });
    expect(uk).toEqual({ system: 'uk', temp: '°C', wind: 'mph', precip: 'mm' });
    expect(isUnitSystem('uk')).toBe(true);
    expect(isUnitSystem('kelvin')).toBe(false);
  });
});

describe('conversions', () => {
  it('converts temperature, speed and depth', () => {
    expect(cToF(0)).toBe(32);
    expect(cToF(100)).toBe(212);
    expect(cToF(-40)).toBe(-40);
    expect(kmhToMph(1.609344)).toBeCloseTo(1, 10);
    expect(kmhToMph(100)).toBeCloseTo(62.137, 3);
    expect(mmToIn(25.4)).toBe(1);
  });

  it('rounds for display and never shows -0', () => {
    expect(Object.is(round(-0.4), 0)).toBe(true);
    expect(Object.is(round(-0.04, 1), 0)).toBe(true);
    expect(round(2.5)).toBe(3);
    expect(round(-2.6)).toBe(-3);
    expect(round(1.234, 2)).toBe(1.23);
    expect(Object.is(temperature(-0.4, metric), 0)).toBe(true);
    // -17.9 °C is -0.22 °F.
    expect(Object.is(temperature(-17.9, imperial), 0)).toBe(true);
  });

  it('converts into each preset', () => {
    expect(temperature(17.4, metric)).toBe(17);
    expect(temperature(17.4, imperial)).toBe(63);
    expect(temperature(17.4, uk)).toBe(17);
    expect(windSpeed(24.8, metric)).toBe(25);
    expect(windSpeed(24.8, imperial)).toBe(15);
    expect(windSpeed(24.8, uk)).toBe(15);
    expect(precipitation(4.06, metric)).toBe(4.1);
    expect(precipitation(4.06, imperial)).toBe(0.16);
    expect(precipitation(4.06, uk)).toBe(4.1);
  });

  it('passes missing values through as null', () => {
    expect(temperature(null, metric)).toBeNull();
    expect(windSpeed(undefined, metric)).toBeNull();
    expect(precipitation(Number.NaN, metric)).toBeNull();
    expect(formatPrecip(null, metric)).toBe('-');
  });

  it('formats precipitation with the precision of its unit', () => {
    expect(formatPrecip(0, metric)).toBe('0.0');
    expect(formatPrecip(0, imperial)).toBe('0.00');
    expect(formatPrecip(12.5, uk)).toBe('12.5');
  });
});

describe('defaultUnits', () => {
  it('follows the region of the first locale', () => {
    expect(defaultUnits('en-US')).toBe('imperial');
    expect(defaultUnits('en-GB')).toBe('uk');
    expect(defaultUnits('en-AU')).toBe('metric');
    expect(defaultUnits('en-NZ')).toBe('metric');
    expect(defaultUnits('fr-FR')).toBe('metric');
    expect(defaultUnits('nb-NO')).toBe('metric');
    expect(defaultUnits('es-419')).toBe('metric');
    expect(defaultUnits(['en-GB', 'en-US'])).toBe('uk');
    expect(defaultUnits(['de-DE', 'en-US'])).toBe('metric');
  });

  it('expands a bare language the way Intl does', () => {
    // 'en' maximises to en-Latn-US, so it gets imperial; 'fr' to fr-Latn-FR.
    expect(defaultUnits('en')).toBe('imperial');
    expect(defaultUnits('fr')).toBe('metric');
  });

  it('falls back to metric for missing or malformed tags', () => {
    expect(defaultUnits(undefined)).toBe('metric');
    expect(defaultUnits(null)).toBe('metric');
    expect(defaultUnits([])).toBe('metric');
    expect(defaultUnits('')).toBe('metric');
    expect(defaultUnits('!!')).toBe('metric');
    expect(defaultUnits('en_US')).toBe('imperial');
  });
});
