import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { json, memoryKV, weatherFetch, type Responder, type WeatherFetch } from '../../../tests/support/weather';
import { createMemo } from '../net';
import { placeLabel } from './places';
import { MAX_QUERY_LENGTH, cleanQuery, parseCoords, resolvePlace, splitQualifier, type ResolveOptions } from './resolve';
import { createWeatherSources, type WeatherSources } from './sources';
import { WeatherError } from './types';

const LEGACY_PALESTINE_KEYS = [
  'palestine', 'gaza', 'west+bank', 'westbank', 'ramallah', 'bethlehem', 'hebron', 'nablus', 'jenin', 'tulkarm',
  'qalqilya', 'jericho', 'khan+younis', 'rafah',
];

const GEOCODING = 'geocoding-api.open-meteo.com';
const NOMINATIM = 'nominatim.openstreetmap.org';

let clock = 0;
const now = (): number => clock;
let network: WeatherFetch;
let sources: WeatherSources;
let kv: ReturnType<typeof memoryKV>;

function useNetwork(respond?: Responder): void {
  network = weatherFetch(respond);
  vi.stubGlobal('fetch', network.fetch);
}

function fresh(): WeatherSources {
  return createWeatherSources({ now, memo: createMemo({ now }), kv });
}

const resolve = (query: string, options: Partial<ResolveOptions> = {}) =>
  resolvePlace(query, { sources, nominatim: false, ...options });

const rejectionOf = (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    () => {
      throw new Error('expected a rejection');
    },
    (error: unknown) => error,
  );

/** The geocoding requests made so far, as name and country code. */
const searches = (): string[] =>
  network.callsTo(GEOCODING).map((url) => {
    const country = url.searchParams.get('countryCode');
    return country ? `${url.searchParams.get('name')} in ${country}` : url.searchParams.get('name') ?? '';
  });

beforeEach(() => {
  clock = 1_000_000;
  kv = memoryKV();
  useNetwork();
  sources = fresh();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('curated places', () => {
  it.each(LEGACY_PALESTINE_KEYS)('resolves %s to Palestine with no network', async (key) => {
    const { place } = await resolve(key, { nominatim: true });
    expect(place.country).toBe('Palestine');
    expect(placeLabel(place, 'wide')).toMatch(/Palestine$/);
    expect(network.calls).toEqual([]);
  });

  it.each([
    ['Gadigal', 'Gadigal Country · Sydney, AU'],
    ['aotearoa', 'Aotearoa · Wellington, NZ'],
    ['khan younis', 'Khan Younis, Palestine'],
    ['Khan Yunis', 'Khan Younis, Palestine'],
    ['West Bank', 'West Bank · Ramallah, Palestine'],
    ['"Tāmaki Makaurau"', 'Tāmaki Makaurau · Auckland, NZ'],
    ['Gaza, Palestine', 'Gaza, Palestine'],
  ])('resolves %s with no network', async (query, label) => {
    const { place } = await resolve(query, { nominatim: true });
    expect(placeLabel(place, 'compact')).toBe(label);
    expect(network.calls).toEqual([]);
  });

  it('notes that Palestine as a whole is a country-level point', async () => {
    expect((await resolve('palestine')).notes).toEqual([{ kind: 'country-point' }]);
  });
});

describe('coordinates', () => {
  it('uses typed coordinates directly', async () => {
    const { place } = await resolve('-33.87,151.21');
    expect(place).toEqual({ id: 'pt:-33.87,151.21', name: '-33.87, 151.21', lat: -33.87, lon: 151.21, kind: 'point', source: 'coords' });
    expect((await resolve('@59.91273, 10.74609')).place).toMatchObject({ lat: 59.9127, lon: 10.7461 });
    expect(network.calls).toEqual([]);
  });

  it('reads only valid coordinates', () => {
    expect(parseCoords('-33.8688,151.2093')).toEqual({ lat: -33.8688, lon: 151.2093 });
    expect(parseCoords('91,0')).toBeNull();
    expect(parseCoords('0,181')).toBeNull();
    expect(parseCoords('Paris, France')).toBeNull();
    expect(parseCoords('1,2,3')).toBeNull();
  });
});

describe('Open-Meteo search', () => {
  it('finds a place, then answers from the cache, even after a reload', async () => {
    const { place, notes } = await resolve('Oslo');
    expect(place).toMatchObject({ name: 'Oslo', countryCode: 'NO', country: 'Norway', source: 'open-meteo' });
    expect(notes).toEqual([]);
    expect(searches()).toEqual(['Oslo']);

    await resolve('oslo');
    await resolvePlace('OSLO', { sources: fresh(), nominatim: false });
    expect(searches()).toEqual(['Oslo']);
  });

  it('mentions same-named places of a similar size', async () => {
    const { place, notes } = await resolve('Springfield');
    expect(place.region).toBe('Missouri');
    expect(notes).toEqual([{ kind: 'alternatives', places: [expect.objectContaining({ region: 'Illinois' }), expect.objectContaining({ region: 'Massachusetts' })] }]);
  });

  it('narrows by a region qualifier', async () => {
    expect((await resolve('Springfield, Illinois')).place.region).toBe('Illinois');
    expect(searches()).toEqual(['Springfield']);
  });

  it('tries a two-letter qualifier as a country first, then as a region', async () => {
    // IL is Israel's code, which has no Springfield; Illinois matches the prefix.
    expect((await resolve('Springfield, IL')).place.region).toBe('Illinois');
    expect(searches()).toEqual(['Springfield in IL', 'Springfield']);
  });

  it('searches within a named country', async () => {
    expect((await resolve('Paris, France')).place).toMatchObject({ name: 'Paris', countryCode: 'FR', country: 'France' });
    expect(searches()).toEqual(['Paris in FR']);
  });

  it("retries 'Paris France' with the last word as the country", async () => {
    expect((await resolve('Paris France')).place).toMatchObject({ name: 'Paris', countryCode: 'FR' });
    expect(searches()).toEqual(['Paris France', 'Paris in FR']);
  });

  it('labels a PS result Palestine', async () => {
    useNetwork((url) =>
      url.host === GEOCODING
        ? json({ results: [{ id: 281133, name: 'Beit Hanoun', latitude: 31.535, longitude: 34.536, country_code: 'PS', feature_code: 'PPL' }] })
        : undefined,
    );
    const { place } = await resolve('Beit Hanoun');
    expect(placeLabel(place, 'compact')).toBe('Beit Hanoun, Palestine');
    expect(placeLabel(place, 'wide')).toBe('Beit Hanoun, Palestine');
  });

  it('notes a country-level result', async () => {
    useNetwork((url) =>
      url.host === GEOCODING
        ? json({ results: [{ id: 3017382, name: 'France', latitude: 46, longitude: 2, country_code: 'FR', feature_code: 'PCLI' }] })
        : undefined,
    );
    expect((await resolve('France')).notes).toEqual([{ kind: 'country-point' }]);
  });
});

describe('not found', () => {
  it('says so, with suggestions, and remembers the miss for an hour', async () => {
    const error = await rejectionOf(resolve('Aoteroa'));
    expect(error).toBeInstanceOf(WeatherError);
    expect(error).toMatchObject({ kind: 'not-found', query: 'Aoteroa', suggestions: ['Aotearoa'], message: 'weather: no place called "Aoteroa".' });
    expect(searches()).toEqual(['Aoteroa']);

    expect(await rejectionOf(resolve('aoteroa'))).toMatchObject({ kind: 'not-found' });
    expect(searches()).toEqual(['Aoteroa']);
    clock += 60 * 60_000;
    await rejectionOf(resolve('aoteroa'));
    expect(searches()).toEqual(['Aoteroa', 'aoteroa']);
  });

  it('offers recent places as suggestions too', async () => {
    expect(await rejectionOf(resolve('Olso', { recent: ['Oslo'] }))).toMatchObject({ suggestions: ['Oslo'] });
  });

  it('keeps hostile input as plain text in the error', async () => {
    const error = await rejectionOf(resolve('<img src=x onerror=alert(1)>'));
    expect(error).toMatchObject({ kind: 'not-found', query: '<img src=x onerror=alert(1)>' });
    expect(network.callsTo(GEOCODING)[0]?.searchParams.get('name')).toBe('<img src=x onerror=alert(1)>');
  });

  it('rejects empty and overlong input before any request', async () => {
    expect(await rejectionOf(resolve('   '))).toMatchObject({ kind: 'usage' });
    expect(await rejectionOf(resolve('x'.repeat(MAX_QUERY_LENGTH + 1)))).toMatchObject({ kind: 'usage' });
    expect(network.calls).toEqual([]);
  });
});

describe('Nominatim fallback', () => {
  it('is asked only when enabled and Open-Meteo finds nothing', async () => {
    await rejectionOf(resolve('Eora Nation'));
    expect(network.callsTo(NOMINATIM)).toEqual([]);

    clock += 60 * 60_000;
    const { place } = await resolve('Eora Nation', { nominatim: true });
    expect(place).toMatchObject({ name: 'Sydney', source: 'nominatim', credit: 'osm' });
    expect(searches()).toEqual(['Eora Nation', 'Eora', 'Eora Nation', 'Eora']);
    expect(network.callsTo(NOMINATIM).map((url) => url.searchParams.get('q'))).toEqual(['Eora Nation']);

    // The answer is cached like any other.
    await resolve('eora nation', { nominatim: true });
    expect(network.callsTo(NOMINATIM)).toHaveLength(1);
  });

  it('notes a country-level answer', async () => {
    // Not curated: 'mainland' does not qualify Aotearoa, and Open-Meteo knows neither word.
    const { place, notes } = await resolve('Aotearoa mainland', { nominatim: true });
    expect(place).toMatchObject({ name: 'New Zealand', kind: 'country' });
    expect(notes).toEqual([{ kind: 'country-point' }]);
  });

  it('passes a qualifier on', async () => {
    await resolve('Nowhere, Atlantis', { nominatim: true });
    expect(network.callsTo(NOMINATIM).map((url) => url.searchParams.get('q'))).toEqual(['Nowhere, Atlantis']);
  });
});

describe('failures', () => {
  it('reports an Open-Meteo failure and does not cache it as a miss', async () => {
    let down = true;
    useNetwork((url) => (down && url.host === GEOCODING ? json({ error: true }, 503) : undefined));
    expect(await rejectionOf(resolve('Oslo'))).toMatchObject({ kind: 'http', status: 503 });
    down = false;
    clock += 30_000;
    expect((await resolve('Oslo')).place.name).toBe('Oslo');
  });

  it('falls back to Nominatim when Open-Meteo is down', async () => {
    useNetwork((url) => (url.host === GEOCODING ? json({ error: true }, 503) : undefined));
    expect((await resolve('Eora Nation', { nominatim: true })).place.source).toBe('nominatim');
  });

  it('reports the Open-Meteo failure when Nominatim finds nothing either', async () => {
    useNetwork((url) => (url.host === GEOCODING ? json({ error: true }, 503) : url.host === NOMINATIM ? json([]) : undefined));
    expect(await rejectionOf(resolve('Eora Nation', { nominatim: true }))).toMatchObject({ kind: 'http', status: 503 });
  });

  it('stops at once when cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    expect(await rejectionOf(resolve('Oslo', { signal: controller.signal, nominatim: true }))).toMatchObject({ kind: 'abort' });
    expect(network.calls).toEqual([]);
  });
});

describe('status labels', () => {
  it('names each step', async () => {
    const phases: string[] = [];
    await resolve('Eora Nation', { nominatim: true, onPhase: (label) => phases.push(label) });
    expect(phases).toEqual(['Searching for “Eora Nation”…', 'Searching OpenStreetMap for “Eora Nation”…']);
  });
});

describe('input helpers', () => {
  it('cleans what was typed', () => {
    expect(cleanQuery('  "Springfield,  IL"  ')).toBe('Springfield, IL');
    expect(cleanQuery('Oslo\u0007\nNorway')).toBe('Oslo Norway');
    expect(cleanQuery("'Gaza'")).toBe('Gaza');
  });

  it('splits a qualifier at the first comma', () => {
    expect(splitQualifier('Springfield, Illinois, US')).toEqual({ name: 'Springfield', qualifier: 'Illinois, US' });
    expect(splitQualifier('Oslo')).toEqual({ name: 'Oslo' });
    expect(splitQualifier('Oslo,')).toEqual({ name: 'Oslo' });
  });
});
