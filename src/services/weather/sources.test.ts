import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixture, json, memoryKV, weatherFetch } from '../../../tests/support/weather';
import { NetError, createMemo } from '../net';
import { STORAGE_KEYS } from '../storage-keys';
import {
  GEO_CACHE_MAX, GeoCache, NOMINATIM_GAP_MS, WEATHER_TIMEOUTS, WEATHER_TTL, createWeatherSources, forecastUrl, geocodeUrl,
  nominatimReverseUrl, nominatimSearchUrl, parseForecast, parseGeoJs, parseGeocoding, parseIpinfo, parseNominatimReverse,
  parseNominatimSearch, type WeatherSources,
} from './sources';
import type { Place } from './types';

const SYDNEY = { lat: -33.8688, lon: 151.2093 };

let clock = 0;
const now = (): number => clock;

/** Sources on a fake clock, with their own memo table and an in-memory storage area. */
function testSources(kv = memoryKV()): WeatherSources {
  return createWeatherSources({ now, memo: createMemo({ now }), kv });
}

const rejectionOf = (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    () => {
      throw new Error('expected a rejection');
    },
    (error: unknown) => error,
  );

beforeEach(() => {
  clock = 1_000_000;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('request URLs', () => {
  it('asks Open-Meteo for current conditions and seven metric days in local time', () => {
    expect(forecastUrl(SYDNEY.lat, SYDNEY.lon)).toBe(
      'https://api.open-meteo.com/v1/forecast?latitude=-33.8688&longitude=151.2093' +
        '&current=temperature_2m,apparent_temperature,relative_humidity_2m,is_day,precipitation,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m' +
        '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,sunrise,sunset,uv_index_max' +
        '&timezone=auto&forecast_days=7',
    );
    expect(forecastUrl(59.91273, 10.74609)).toContain('latitude=59.9127&longitude=10.7461&');
  });

  it('encodes place searches', () => {
    expect(geocodeUrl('Paris France')).toBe(
      'https://geocoding-api.open-meteo.com/v1/search?name=Paris%20France&count=10&language=en&format=json',
    );
    expect(geocodeUrl('Paris', 'FR')).toMatch(/&countryCode=FR$/);
    expect(geocodeUrl('<img src=x>&a=b')).toContain('name=%3Cimg%20src%3Dx%3E%26a%3Db&');
    expect(nominatimSearchUrl('Gadigal')).toBe(
      'https://nominatim.openstreetmap.org/search?q=Gadigal&format=jsonv2&limit=5&addressdetails=1&accept-language=en',
    );
    expect(nominatimReverseUrl(-33.8688, 151.2093)).toBe(
      'https://nominatim.openstreetmap.org/reverse?lat=-33.87&lon=151.21&format=jsonv2&zoom=10&accept-language=en',
    );
  });

  it('uses the per-request deadlines from the contracts', () => {
    expect(WEATHER_TIMEOUTS).toEqual({ forecast: 8000, geocoding: 6000, nominatim: 6000, ip: 4000 });
  });
});

describe('parsing', () => {
  it('reads a forecast', () => {
    const forecast = parseForecast(fixture('forecast-sydney.json'), 42);
    expect(forecast).toMatchObject({
      timezone: 'Australia/Sydney',
      tzAbbrev: 'GMT+11',
      utcOffsetSeconds: 39600,
      fetchedAt: 42,
      current: { time: '2026-10-06T14:15', isDay: true, code: 0, tempC: 24.4, feelsC: 26.4, humidity: 51, windDeg: 272 },
    });
    expect(forecast?.daily).toHaveLength(7);
    expect(forecast?.daily[0]).toMatchObject({ date: '2026-10-06', code: 95, sunrise: '06:26', sunset: '19:01' });
    expect(parseForecast(fixture('forecast-oslo.json'), 0)?.current.isDay).toBe(false);
  });

  it('rejects anything that is not a forecast', () => {
    expect(parseForecast(fixture('forecast-error-400.json'), 0)).toBeNull();
    expect(parseForecast({}, 0)).toBeNull();
    expect(parseForecast('<html>', 0)).toBeNull();
    const raw = fixture('forecast-sydney.json') as Record<string, unknown>;
    expect(parseForecast({ ...raw, latitude: 200 }, 0)).toBeNull();
    expect(parseForecast({ ...raw, daily: { time: [] } }, 0)).toBeNull();
  });

  it('reads place searches', () => {
    expect(parseGeocoding(fixture('geocode-oslo.json'))[0]).toEqual({
      id: 'om:3143244', name: 'Oslo', region: 'Oslo', district: 'Oslo', countryCode: 'NO', country: 'Norway',
      lat: 59.91273, lon: 10.74609, kind: 'city', source: 'open-meteo', population: 1082575,
    });
    expect(parseGeocoding(fixture('geocode-gadigal.json'))).toEqual([]);
    expect(parseGeocoding(fixture('geocode-springfield.json')).map((p) => p.region).slice(0, 3)).toEqual([
      'Missouri', 'Illinois', 'Massachusetts',
    ]);
    expect(parseGeocoding({ results: [{ name: 'Nowhere' }, null, { name: 'France', latitude: 46, longitude: 2, country_code: 'FR', feature_code: 'PCLI' }] }))
      .toMatchObject([{ name: 'France', kind: 'country' }]);
  });

  it('labels every PS result Palestine, whatever the provider says', () => {
    const rows = [
      { id: 1, name: 'Khan Yunis', latitude: 31.34018, longitude: 34.30627, country_code: 'PS', country: null },
      { id: 2, name: 'Bethlehem', latitude: 31.70487, longitude: 35.20376, country_code: 'PS', country: 'Palestinian Territory' },
    ];
    expect(parseGeocoding({ results: rows }).map((p) => p.country)).toEqual(['Palestine', 'Palestine']);
    const osm = { ...(fixture('nominatim-gadigal.json') as Record<string, unknown>[])[0], address: { country_code: 'ps', country: 'Palestinian Territories' } };
    expect(parseNominatimSearch([osm])[0]?.country).toBe('Palestine');
  });

  it('reads Nominatim results and keeps only places', () => {
    expect(parseNominatimSearch(fixture('nominatim-gadigal.json'))).toEqual([{
      id: 'osm:R5750005', name: 'Sydney', region: 'New South Wales', countryCode: 'AU', country: 'Australia',
      lat: -33.8698439, lon: 151.2082848, kind: 'city', source: 'nominatim', credit: 'osm',
    }]);
    expect(parseNominatimSearch(fixture('nominatim-aotearoa.json'))).toMatchObject([
      { id: 'osm:R556706', name: 'New Zealand', countryCode: 'NZ', kind: 'country', credit: 'osm' },
    ]);
    const [sydney] = fixture('nominatim-gadigal.json') as Record<string, unknown>[];
    expect(parseNominatimSearch([{ ...sydney, addresstype: 'road' }, { ...sydney, addresstype: 'building' }])).toEqual([]);
    expect(parseNominatimSearch({ error: 'nope' })).toEqual([]);
  });

  it('labels a point from a reverse lookup', () => {
    expect(parseNominatimReverse(fixture('nominatim-reverse-sydney.json'), -33.87, 151.21)).toEqual({
      id: 'pt:-33.87,151.21', name: 'Sydney', region: 'New South Wales', countryCode: 'AU', country: 'Australia',
      lat: -33.87, lon: 151.21, kind: 'point', source: 'nominatim', credit: 'osm',
    });
    expect(parseNominatimReverse({ error: 'Unable to geocode' }, 0, 0)).toBeNull();
  });

  it('reads IP locations, rounded to about a kilometre', () => {
    expect(parseGeoJs(fixture('geojs.json'))).toEqual({
      id: 'ip', name: 'Sydney', region: 'New South Wales', countryCode: 'AU', country: 'Australia',
      lat: -33.87, lon: 151.2, kind: 'city', source: 'ip', approximate: true,
    });
    expect(parseIpinfo(fixture('ipinfo.json'))).toMatchObject({ name: 'Sydney', lat: -33.87, lon: 151.21, approximate: true });
    expect(parseGeoJs({ latitude: 'nil' })).toBeNull();
    expect(parseIpinfo({ loc: '' })).toBeNull();
  });

  it('cleans every name it is given: no escape sequence or bidirectional override survives', () => {
    // An OSC 8 link and an SGR colour in a name, a right-to-left override in a region.
    const link = 'Evil\u001b]8;;https://evil.example\u0007Town\u001b]8;;\u0007';
    const red = '\u001b[31mRed\u001b[0m Hill';
    const flipped = 'South \u202eWales\u202c';
    const unsafe = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/;
    const places = [
      ...parseGeocoding({ results: [{ name: link, admin1: flipped, admin2: red, country: red, latitude: 1, longitude: 2 }] }),
      ...parseNominatimSearch([{ addresstype: 'city', name: link, lat: '1', lon: '2', address: { state: flipped, country: red } }]),
      parseNominatimReverse({ address: { city: link, state: flipped, country: red } }, 1, 2),
      parseGeoJs({ latitude: '1', longitude: '2', city: link, region: flipped, country: red }),
      parseIpinfo({ loc: '1,2', city: link, region: flipped, country: 'NZ' }),
    ];
    expect(places).toHaveLength(5);
    for (const place of places) {
      expect(place).not.toBeNull();
      for (const value of Object.values(place ?? {})) if (typeof value === 'string') expect(value).not.toMatch(unsafe);
      expect(place?.name).toBe('Evil ]8;;https://evil.example Town ]8;;');
    }
    expect(places[0]).toMatchObject({ region: 'South Wales', district: '[31mRed [0m Hill' });
  });
});

describe('forecast', () => {
  it('shares one request between concurrent callers and reuses it for 10 minutes', async () => {
    const network = weatherFetch();
    vi.stubGlobal('fetch', network.fetch);
    const sources = testSources();

    const [a, b] = await Promise.all([sources.forecast(SYDNEY.lat, SYDNEY.lon), sources.forecast(SYDNEY.lat, SYDNEY.lon)]);
    expect(network.calls).toEqual([forecastUrl(SYDNEY.lat, SYDNEY.lon)]);
    expect(a.forecast).toBe(b.forecast);
    expect(a.stale).toBeUndefined();

    clock += WEATHER_TTL.forecastFresh - 1;
    await sources.forecast(SYDNEY.lat, SYDNEY.lon);
    // A geocoded Sydney a few hundred metres away shares the cached forecast.
    await sources.forecast(-33.86785, 151.20732);
    expect(network.calls).toHaveLength(1);

    clock += 1;
    await sources.forecast(SYDNEY.lat, SYDNEY.lon);
    expect(network.calls).toHaveLength(2);
  });

  it('shows the last forecast, marked stale, for up to 6 hours when Open-Meteo fails', async () => {
    let failing = false;
    const network = weatherFetch(() => (failing ? json({ reason: 'down', error: true }, 503) : undefined));
    vi.stubGlobal('fetch', network.fetch);
    const sources = testSources();
    const fetchedAt = clock;
    const first = await sources.forecast(SYDNEY.lat, SYDNEY.lon);

    failing = true;
    clock = fetchedAt + WEATHER_TTL.forecastFresh + 1;
    const stale = await sources.forecast(SYDNEY.lat, SYDNEY.lon);
    expect(stale.forecast).toBe(first.forecast);
    expect(stale.stale).toEqual({ ageMs: WEATHER_TTL.forecastFresh + 1, cause: 'upstream' });
    expect(network.calls).toHaveLength(2);

    // The failure is remembered for 30 s, so asking again does not hit Open-Meteo.
    clock += 10_000;
    expect((await sources.forecast(SYDNEY.lat, SYDNEY.lon)).stale?.cause).toBe('upstream');
    expect(network.calls).toHaveLength(2);

    clock = fetchedAt + WEATHER_TTL.forecastStale + 1;
    const error = await rejectionOf(sources.forecast(SYDNEY.lat, SYDNEY.lon));
    expect(error).toBeInstanceOf(NetError);
    expect(error).toMatchObject({ kind: 'http', status: 503 });
  });

  it('marks a forecast stale after a timeout or while offline', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let hang = false;
    const network = weatherFetch(() => (hang ? new Promise<Response>(() => {}) : undefined));
    vi.stubGlobal('fetch', network.fetch);
    const sources = testSources();
    await sources.forecast(SYDNEY.lat, SYDNEY.lon);

    hang = true;
    clock += WEATHER_TTL.forecastFresh;
    const pending = sources.forecast(SYDNEY.lat, SYDNEY.lon);
    await vi.advanceTimersByTimeAsync(WEATHER_TIMEOUTS.forecast);
    expect((await pending).stale?.cause).toBe('timeout');

    // Past the 30 s cool-down, an offline browser does not even try.
    clock += 30_000;
    vi.stubGlobal('navigator', { onLine: false });
    expect((await sources.forecast(SYDNEY.lat, SYDNEY.lon)).stale?.cause).toBe('offline');
    expect(network.calls).toHaveLength(2);
  });

  it('does not hide a request the place itself caused to fail', async () => {
    let status = 200;
    vi.stubGlobal('fetch', weatherFetch(() => (status === 200 ? undefined : json(fixture('forecast-error-400.json'), status))).fetch);
    const sources = testSources();
    await sources.forecast(SYDNEY.lat, SYDNEY.lon);
    status = 400;
    clock += WEATHER_TTL.forecastFresh;
    expect(await rejectionOf(sources.forecast(SYDNEY.lat, SYDNEY.lon))).toMatchObject({ kind: 'http', status: 400 });
  });

  it('fails with kind parse when the body is not a forecast', async () => {
    vi.stubGlobal('fetch', weatherFetch(() => json({ hello: 'world' })).fetch);
    expect(await rejectionOf(testSources().forecast(SYDNEY.lat, SYDNEY.lon))).toMatchObject({ kind: 'parse', host: 'api.open-meteo.com' });
  });

  it('stops waiting as soon as the caller cancels, never falling back to a stale forecast', async () => {
    let hang = false;
    vi.stubGlobal('fetch', weatherFetch(() => (hang ? new Promise<Response>(() => {}) : undefined)).fetch);
    const sources = testSources();
    await sources.forecast(SYDNEY.lat, SYDNEY.lon);
    hang = true;
    clock += WEATHER_TTL.forecastFresh;
    const controller = new AbortController();
    const pending = rejectionOf(sources.forecast(SYDNEY.lat, SYDNEY.lon, controller.signal));
    controller.abort();
    expect(await pending).toMatchObject({ kind: 'abort' });
  });
});

describe('geocode', () => {
  it('returns parsed results, optionally within a country', async () => {
    const network = weatherFetch();
    vi.stubGlobal('fetch', network.fetch);
    const sources = testSources();
    expect((await sources.geocode('Paris', 'FR'))[0]).toMatchObject({ name: 'Paris', countryCode: 'FR', country: 'France' });
    expect(network.calls).toEqual([geocodeUrl('Paris', 'FR')]);
  });

  it('asks again after a failed search it has said, so [try again] really tries', async () => {
    const network = weatherFetch(() => json({ error: true }, 502));
    vi.stubGlobal('fetch', network.fetch);
    const sources = testSources();
    expect(await rejectionOf(sources.geocode('Oslo'))).toMatchObject({ kind: 'http', status: 502 });
    clock += 1000;
    expect(await rejectionOf(sources.geocode('Oslo'))).toMatchObject({ kind: 'http', status: 502 });
    expect(network.calls).toHaveLength(2);
  });

  it('shares one failed search between callers who asked at once', async () => {
    const network = weatherFetch(() => json({ error: true }, 502));
    vi.stubGlobal('fetch', network.fetch);
    const sources = testSources();
    const both = await Promise.all([rejectionOf(sources.geocode('Oslo')), rejectionOf(sources.geocode('Oslo'))]);
    expect(both).toMatchObject([{ status: 502 }, { status: 502 }]);
    expect(network.calls).toHaveLength(1);
  });
});

describe('the place cache', () => {
  const place = (name: string): Place => ({ id: `om:${name}`, name, lat: 1, lon: 2, kind: 'city', source: 'open-meteo' });

  it('keeps hits for 30 days and misses for an hour', () => {
    const cache = new GeoCache(memoryKV(), now);
    cache.set('q:oslo', { place: place('Oslo'), alternatives: [] });
    cache.set('q:atlantis', null);
    expect(cache.get('q:oslo')?.place.name).toBe('Oslo');
    expect(cache.get('q:atlantis')).toBeNull();
    expect(cache.get('q:nowhere')).toBeUndefined();

    clock += WEATHER_TTL.geocodeMiss;
    expect(cache.get('q:atlantis')).toBeUndefined();
    expect(cache.get('q:oslo')).not.toBeUndefined();
    clock += WEATHER_TTL.geocodeHit - WEATHER_TTL.geocodeMiss;
    expect(cache.get('q:oslo')).toBeUndefined();
  });

  it('stores under vesen:weather:v1 and keeps what else is there', () => {
    const kv = memoryKV({ [STORAGE_KEYS.weather.key]: JSON.stringify({ v: 1, geo: {}, recents: ['Oslo'] }) });
    const cache = new GeoCache(kv, now);
    cache.set('q:oslo', { place: place('Oslo'), alternatives: [] });
    const stored = JSON.parse(kv.store.get(STORAGE_KEYS.weather.key) ?? '{}') as Record<string, unknown>;
    expect(stored.recents).toEqual(['Oslo']);
    expect(Object.keys(stored.geo as object)).toEqual(['q:oslo']);

    // A second instance, as after a reload, reads it back.
    expect(new GeoCache(kv, now).get('q:oslo')?.place.name).toBe('Oslo');
    cache.clear();
    expect(new GeoCache(kv, now).get('q:oslo')).toBeUndefined();
    expect((JSON.parse(kv.store.get(STORAGE_KEYS.weather.key) ?? '{}') as Record<string, unknown>).recents).toEqual(['Oslo']);
  });

  it('keeps only the 50 newest entries', () => {
    const kv = memoryKV();
    const cache = new GeoCache(kv, now);
    for (let i = 0; i < GEO_CACHE_MAX + 5; i += 1) {
      clock += 1;
      cache.set(`q:${i}`, { place: place(String(i)), alternatives: [] });
    }
    const stored = JSON.parse(kv.store.get(STORAGE_KEYS.weather.key) ?? '{}') as { geo: Record<string, unknown> };
    expect(Object.keys(stored.geo)).toHaveLength(GEO_CACHE_MAX);
    expect(cache.get('q:0')).toBeUndefined();
    expect(cache.get(`q:${GEO_CACHE_MAX + 4}`)).not.toBeUndefined();
  });

  it('ignores unreadable storage and entries', () => {
    for (const raw of ['not json', '{"v":2,"geo":{}}', '{"v":1,"geo":{"q:x":{"at":"soon","hit":null},"q:y":{"at":1,"hit":{"place":{"name":"no id"}}}}}']) {
      const kv = memoryKV({ [STORAGE_KEYS.weather.key]: raw });
      const cache = new GeoCache(kv, now);
      expect(cache.get('q:x')).toBeUndefined();
      expect(cache.get('q:y')).toBeUndefined();
      cache.set('q:oslo', { place: place('Oslo'), alternatives: [] });
      expect(cache.get('q:oslo')?.place.name).toBe('Oslo');
    }
  });

  it('lives in memory without a storage area', () => {
    const cache = new GeoCache(null, now);
    cache.set('q:oslo', null);
    expect(cache.get('q:oslo')).toBeNull();
  });
});

describe('Nominatim', () => {
  it('spaces calls at least 1100 ms apart', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const times: number[] = [];
    const network = weatherFetch((url) => {
      if (url.host === 'nominatim.openstreetmap.org') times.push(Date.now());
      return undefined;
    });
    vi.stubGlobal('fetch', network.fetch);
    const sources = createWeatherSources({ kv: memoryKV() });

    const results = Promise.all([
      sources.nominatimSearch('Gadigal'),
      sources.nominatimSearch('Aotearoa'),
      sources.nominatimReverse(-33.87, 151.21),
    ]);
    await vi.advanceTimersByTimeAsync(0);
    expect(times).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(NOMINATIM_GAP_MS - 1);
    expect(times).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(times).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(NOMINATIM_GAP_MS);
    expect(times).toHaveLength(3);

    const [gadigal, aotearoa, reverse] = await results;
    expect(gadigal[0]?.name).toBe('Sydney');
    expect(aotearoa[0]?.kind).toBe('country');
    expect(reverse?.name).toBe('Sydney');
    for (let i = 1; i < times.length; i += 1) expect((times[i] ?? 0) - (times[i - 1] ?? 0)).toBeGreaterThanOrEqual(NOMINATIM_GAP_MS);
  });

  it('gives up a queued call when the caller cancels, without sending it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const network = weatherFetch();
    vi.stubGlobal('fetch', network.fetch);
    const sources = createWeatherSources({ kv: memoryKV() });
    await sources.nominatimSearch('Gadigal');

    const controller = new AbortController();
    const queued = rejectionOf(sources.nominatimSearch('Aotearoa', controller.signal));
    await vi.advanceTimersByTimeAsync(500);
    controller.abort();
    expect(await queued).toMatchObject({ kind: 'abort', host: 'nominatim.openstreetmap.org' });
    await vi.advanceTimersByTimeAsync(NOMINATIM_GAP_MS);
    expect(network.callsTo('nominatim.openstreetmap.org')).toHaveLength(1);
  });

  it('keeps reverse lookups for the page only: a position is never stored', async () => {
    const network = weatherFetch();
    vi.stubGlobal('fetch', network.fetch);
    const kv = memoryKV();
    const sources = testSources(kv);
    expect((await sources.nominatimReverse(-33.8688, 151.2093))?.name).toBe('Sydney');
    expect((await sources.nominatimReverse(-33.87, 151.21))?.name).toBe('Sydney');
    expect(network.calls).toHaveLength(1);
    expect(kv.store.size).toBe(0);
    // A reload asks again.
    expect((await testSources(kv).nominatimReverse(-33.87, 151.21))?.name).toBe('Sydney');
    expect(network.calls).toHaveLength(2);
    // And forgetting forgets the names too.
    sources.forget();
    await sources.nominatimReverse(-33.87, 151.21);
    expect(network.calls).toHaveLength(3);
  });
});

describe('IP location', () => {
  it('asks GeoJS and remembers the answer for an hour', async () => {
    const network = weatherFetch();
    vi.stubGlobal('fetch', network.fetch);
    const sources = testSources();
    expect(await sources.ipLocate()).toMatchObject({ name: 'Sydney', approximate: true, source: 'ip', lat: -33.87 });
    clock += WEATHER_TTL.ip - 1;
    await sources.ipLocate();
    expect(network.calls).toEqual(['https://get.geojs.io/v1/ip/geo.json']);
  });

  it('falls back to ipinfo.io when GeoJS fails', async () => {
    const network = weatherFetch((url) => (url.host === 'get.geojs.io' ? json({}, 500) : undefined));
    vi.stubGlobal('fetch', network.fetch);
    expect(await testSources().ipLocate()).toMatchObject({ name: 'Sydney', lat: -33.87, lon: 151.21 });
    expect(network.calls.map((call) => new URL(call).host)).toEqual(['get.geojs.io', 'ipinfo.io']);
  });

  it('fails when neither answers', async () => {
    vi.stubGlobal('fetch', weatherFetch(() => json({}, 429)).fetch);
    expect(await rejectionOf(testSources().ipLocate())).toMatchObject({ kind: 'http', status: 429 });
  });
});
