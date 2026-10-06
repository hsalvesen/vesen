// Turns what the visitor typed into a place, in a fixed order:
//   1. coordinates typed as lat,lon
//   2. the curated table (no network)
//   3. the place cache
//   4. Open-Meteo geocoding, honouring a 'City, Country' or 'City, Region' qualifier, and
//      retrying 'Paris France' as Paris in FR
//   5. Nominatim, only when enabled, throttled by the sources
// Results, including misses, are cached. Network failures stay NetErrors; a place that does
// not exist is a WeatherError with suggestions.

import { isNetError } from '../net';
import { countryCodeFor, lookupCurated, matchesQualifier, normaliseQuery, suggestNames } from './places';
import { NOMINATIM_ENABLED, pointId, type GeoHit, type WeatherSources } from './sources';
import { WeatherError, type Note, type Place } from './types';
import { round } from './units';

/** Longer input is refused rather than sent to a geocoder. */
export const MAX_QUERY_LENGTH = 100;

/** Same-named places are mentioned when at least this share of the top result's population. */
const ALTERNATIVE_SHARE = 0.1;
const MAX_ALTERNATIVES = 2;

export interface ResolveOptions {
  readonly sources: WeatherSources;
  /** Whether Nominatim may be asked after Open-Meteo finds nothing. */
  readonly nominatim?: boolean;
  readonly signal?: AbortSignal | null;
  /** Names each step for the status line: 'Searching for “Springfield”…'. */
  readonly onPhase?: (label: string) => void;
  /** Recent place names, offered alongside curated ones in "Did you mean". */
  readonly recent?: readonly string[];
}

export interface Resolved {
  readonly place: Place;
  /** A country-level point, or same-named alternatives. */
  readonly notes: readonly Note[];
}

/** Strips control characters, repeated spaces and wrapping quotes. */
export function cleanQuery(query: string): string {
  const text = query.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  const quoted = /^(["'“‘])(.*)(["'”’])$/.exec(text);
  return quoted ? (quoted[2] ?? '').trim() : text;
}

/** Coordinates typed as 'lat,lon' or '@lat,lon', range-checked; null for anything else. */
export function parseCoords(text: string): { lat: number; lon: number } | null {
  const match = /^@?\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/.exec(text.trim());
  if (!match) return null;
  const lat = Number(match[1]);
  const lon = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat: round(lat, 4), lon: round(lon, 4) };
}

/** 'Springfield, Illinois' → name 'Springfield', qualifier 'Illinois'. Splits at the first comma. */
export function splitQualifier(text: string): { name: string; qualifier?: string } {
  const comma = text.indexOf(',');
  if (comma === -1) return { name: text.trim() };
  const name = text.slice(0, comma).trim();
  const qualifier = text.slice(comma + 1).trim();
  return qualifier ? { name, qualifier } : { name };
}

function pointPlace(lat: number, lon: number): Place {
  return { id: pointId(lat, lon), name: `${lat.toFixed(2)}, ${lon.toFixed(2)}`, lat, lon, kind: 'point', source: 'coords' };
}

const cacheKey = (name: string, qualifier?: string): string =>
  `q:${normaliseQuery(name)}${qualifier ? `|${normaliseQuery(qualifier)}` : ''}`;

function resolved(hit: GeoHit): Resolved {
  const notes: Note[] = [];
  if (hit.place.kind === 'country') notes.push({ kind: 'country-point' });
  if (hit.alternatives.length > 0) notes.push({ kind: 'alternatives', places: hit.alternatives });
  return { place: hit.place, notes };
}

/** The top result, plus up to two same-named places in other regions that are not tiny. */
function pick(results: readonly Place[]): GeoHit | null {
  const [top, ...rest] = results;
  if (!top) return null;
  const name = normaliseQuery(top.name);
  const floor = top.population ? top.population * ALTERNATIVE_SHARE : Number.POSITIVE_INFINITY;
  const alternatives = rest
    .filter((p) => normaliseQuery(p.name) === name)
    .filter((p) => p.region !== top.region || p.countryCode !== top.countryCode)
    .filter((p) => (p.population ?? 0) >= floor)
    .slice(0, MAX_ALTERNATIVES);
  return { place: top, alternatives };
}

const isAbort = (error: unknown, signal: AbortSignal | null | undefined): boolean =>
  Boolean(signal?.aborted) || (isNetError(error) && error.kind === 'abort');

/**
 * Resolves a typed place. Throws a WeatherError ('usage' for empty or overlong input,
 * 'not-found' with suggestions) or the NetError of a failed search.
 */
export async function resolvePlace(query: string, options: ResolveOptions): Promise<Resolved> {
  const { sources, signal } = options;
  const phase = options.onPhase ?? (() => {});
  const text = cleanQuery(query);
  if (text === '') throw new WeatherError('usage', 'weather: name a place, "City, Country" or lat,lon.');
  if (text.length > MAX_QUERY_LENGTH) {
    throw new WeatherError('usage', `weather: place names are at most ${MAX_QUERY_LENGTH} characters.`, { query: text });
  }

  const coords = parseCoords(text);
  if (coords) return { place: pointPlace(coords.lat, coords.lon), notes: [] };

  const { name, qualifier } = splitQualifier(text);
  const curated = lookupCurated(name, qualifier);
  if (curated) return resolved({ place: curated, alternatives: [] });

  const key = cacheKey(name, qualifier);
  const cached = sources.geoCache.get(key);
  if (cached) return resolved(cached);
  const notFound = (): WeatherError =>
    new WeatherError('not-found', `weather: no place called "${text}".`, {
      query: text,
      suggestions: suggestNames(name, options.recent ?? []),
    });
  if (cached === null) throw notFound();

  const geocode = (place: string, countryCode?: string): Promise<Place[]> => sources.geocode(place, countryCode, signal);

  /** A search narrowed by a qualifier: as a country if it names one, else by region prefix. */
  const qualified = async (place: string, within: string): Promise<Place[]> => {
    const code = countryCodeFor(within);
    if (code) {
      const inCountry = await geocode(place, code);
      if (inCountry.length > 0) return inCountry;
    }
    return (await geocode(place)).filter((p) => matchesQualifier(p, within));
  };

  const searchOpenMeteo = async (): Promise<GeoHit | null> => {
    phase(`Searching for “${text}”…`);
    if (qualifier) return pick(await qualified(name, qualifier));
    const direct = pick(await geocode(name));
    if (direct) return direct;
    // 'Paris France': the last words may name a country, or else the last word a region.
    const words = name.split(' ');
    if (words.length < 2) return null;
    for (let tail = Math.min(3, words.length - 1); tail >= 1; tail -= 1) {
      const within = words.slice(-tail).join(' ');
      if (countryCodeFor(within)) return pick(await qualified(words.slice(0, -tail).join(' '), within));
    }
    return pick(await qualified(words.slice(0, -1).join(' '), words[words.length - 1] ?? ''));
  };

  const searchNominatim = async (): Promise<GeoHit | null> => {
    phase(`Searching OpenStreetMap for “${text}”…`);
    const [top] = await sources.nominatimSearch(qualifier ? `${name}, ${qualifier}` : name, signal);
    return top ? { place: top, alternatives: [] } : null;
  };

  let hit: GeoHit | null = null;
  let failure: unknown;
  try {
    hit = await searchOpenMeteo();
  } catch (error) {
    if (isAbort(error, signal)) throw error;
    failure = error;
  }
  if (!hit && (options.nominatim ?? NOMINATIM_ENABLED)) {
    try {
      hit = await searchNominatim();
    } catch (error) {
      if (isAbort(error, signal)) throw error;
      failure ??= error;
    }
  }

  if (hit) {
    sources.geoCache.set(key, hit);
    return resolved(hit);
  }
  // Only a search every source answered may be remembered as a miss.
  if (failure !== undefined) throw failure;
  sources.geoCache.set(key, null);
  throw notFound();
}
