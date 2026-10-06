// Unit presets and conversions. Forecasts are fetched once in metric, so switching units
// never needs another request; these functions convert and round for display.

import type { UnitSystem, Units } from './types';

export const UNIT_PRESETS: Readonly<Record<UnitSystem, Units>> = {
  metric: { system: 'metric', temp: '°C', wind: 'km/h', precip: 'mm' },
  imperial: { system: 'imperial', temp: '°F', wind: 'mph', precip: 'in' },
  uk: { system: 'uk', temp: '°C', wind: 'mph', precip: 'mm' },
};

export const UNIT_SYSTEMS: readonly UnitSystem[] = ['metric', 'imperial', 'uk'];

export function isUnitSystem(value: string): value is UnitSystem {
  return (UNIT_SYSTEMS as readonly string[]).includes(value);
}

export const cToF = (c: number): number => (c * 9) / 5 + 32;
export const kmhToMph = (kmh: number): number => kmh / 1.609344;
export const mmToIn = (mm: number): number => mm / 25.4;

/** Rounds to `decimals` places and never yields -0, so a card never shows '-0°'. */
export function round(value: number, decimals = 0): number {
  const factor = 10 ** decimals;
  const rounded = Math.round(value * factor) / factor;
  return rounded === 0 ? 0 : rounded;
}

const finite = (value: number | null | undefined): value is number => value != null && Number.isFinite(value);

/** A temperature in whole degrees of the chosen scale. */
export function temperature(celsius: number | null | undefined, units: Units): number | null {
  if (!finite(celsius)) return null;
  return round(units.temp === '°F' ? cToF(celsius) : celsius);
}

/** A wind speed in whole km/h or mph. */
export function windSpeed(kmh: number | null | undefined, units: Units): number | null {
  if (!finite(kmh)) return null;
  return round(units.wind === 'mph' ? kmhToMph(kmh) : kmh);
}

/** A precipitation amount: one decimal in millimetres, two in inches. */
export function precipitation(mm: number | null | undefined, units: Units): number | null {
  if (!finite(mm)) return null;
  return units.precip === 'in' ? round(mmToIn(mm), 2) : round(mm, 1);
}

/** Formats a converted precipitation value with the precision its unit uses. */
export function formatPrecip(value: number | null, units: Units): string {
  if (value == null) return '-';
  return value.toFixed(units.precip === 'in' ? 2 : 1);
}

const IMPERIAL_REGIONS: ReadonlySet<string> = new Set(['US']);
const UK_REGIONS: ReadonlySet<string> = new Set(['GB']);

/**
 * The units a locale expects: the United States gets imperial, the United Kingdom gets °C with
 * mph, and everyone else metric. A tag without a region is expanded the way Intl does, so a
 * bare 'en' counts as en-US.
 */
export function defaultUnits(locales: string | readonly string[] | null | undefined): UnitSystem {
  const first = typeof locales === 'string' ? locales : locales?.[0];
  const region = first ? regionOf(first) : undefined;
  if (region && IMPERIAL_REGIONS.has(region)) return 'imperial';
  if (region && UK_REGIONS.has(region)) return 'uk';
  return 'metric';
}

function regionOf(tag: string): string | undefined {
  try {
    const region = new Intl.Locale(tag).maximize().region;
    if (region) return region.toUpperCase();
  } catch {
    // Not a valid BCP 47 tag; read a region subtag by hand below.
  }
  const match = /^[a-z]{2,3}(?:[-_][a-z]{4})?[-_]([a-z]{2}|\d{3})(?:[-_]|$)/i.exec(tag.trim());
  return match?.[1]?.toUpperCase();
}
