import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixture, json, memoryKV, weatherFetch, type Responder, type WeatherFetch } from '../../../tests/support/weather';
import { createMemo } from '../net';
import { STORAGE_KEYS } from '../storage-keys';
import { lookupCurated } from './places';
import { NO_GEOLOCATION, createWeatherService, type WeatherServiceOptions } from './service';
import { RECENT_MAX, UpstreamError, createWeatherSources } from './sources';
import type { Place, WeatherService } from './types';

const NOMINATIM = 'nominatim.openstreetmap.org';

let clock = 1_000_000;
const now = (): number => clock;
let network: WeatherFetch;
let kv: ReturnType<typeof memoryKV>;

function useNetwork(respond?: Responder): void {
  network = weatherFetch(respond);
  vi.stubGlobal('fetch', network.fetch);
}

function service(options: Partial<WeatherServiceOptions> = {}): WeatherService {
  return createWeatherService({ sources: createWeatherSources({ now, memo: createMemo({ now }), kv, nominatimGapMs: 0 }), ...options });
}

const rejectionOf = (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    () => {
      throw new Error('expected a rejection');
    },
    (error: unknown) => error,
  );

const place = (name: string, extra: Partial<Place> = {}): Place => ({
  id: `om:${name}`,
  name,
  lat: 1,
  lon: 2,
  kind: 'city',
  source: 'open-meteo',
  ...extra,
});

beforeEach(() => {
  clock = 1_000_000;
  kv = memoryKV();
  useNetwork();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('recent places', () => {
  it('keeps the newest five, once each, beside the place cache', async () => {
    const weather = service();
    await weather.resolve('Oslo');
    for (const name of ['A', 'B', 'C', 'D', 'E', 'F', 'B']) weather.remember(place(name));
    expect(weather.recent().map((p) => p.name)).toEqual(['B', 'F', 'E', 'D', 'C']);
    expect(RECENT_MAX).toBe(5);
    const stored = JSON.parse(kv.get(STORAGE_KEYS.weather.key) ?? '{}') as { geo: object; recent: unknown[] };
    expect(Object.keys(stored.geo)).toEqual(['q:oslo']);
    expect(stored.recent).toHaveLength(5);
    // A reload reads them back.
    expect(service().recent().map((p) => p.name)).toEqual(['B', 'F', 'E', 'D', 'C']);
  });

  it('never keeps a location from the network or the device', () => {
    const weather = service();
    weather.remember(place('Sydney', { id: 'ip', source: 'ip', approximate: true }));
    weather.remember(place('Your location', { id: 'pt:-33.87,151.21', source: 'device', kind: 'point' }));
    expect(weather.recent()).toEqual([]);
    expect(kv.get(STORAGE_KEYS.weather.key)).toBeNull();
  });

  it('offers them in did-you-mean', async () => {
    useNetwork((url) => (url.host === NOMINATIM ? json([]) : undefined));
    const weather = service();
    weather.remember(place('Wollongong'));
    expect(await rejectionOf(weather.resolve('Wolongong'))).toMatchObject({ kind: 'not-found', suggestions: ['Wollongong'] });
  });

  it('live in memory without storage', () => {
    const weather = createWeatherService({ sources: createWeatherSources({ now, memo: createMemo({ now }) }) });
    weather.remember(place('Oslo'));
    expect(weather.recent().map((p) => p.name)).toEqual(['Oslo']);
    weather.forget();
    expect(weather.recent()).toEqual([]);
  });
});

describe('forget', () => {
  it('clears the stored places and lookups, and the location in memory', async () => {
    const weather = service();
    await weather.resolve('Oslo');
    weather.remember(place('Oslo'));
    await weather.ipLocate();
    weather.forget();
    expect(kv.get(STORAGE_KEYS.weather.key)).toBeNull();
    expect(weather.recent()).toEqual([]);
    await weather.resolve('Oslo');
    await weather.ipLocate();
    expect(network.callsTo('geocoding-api.open-meteo.com')).toHaveLength(2);
    expect(network.callsTo('get.geojs.io')).toHaveLength(2);
  });
});

describe('naming a point', () => {
  it("keeps the name of a device's position for the page only, never in storage", async () => {
    const weather = service();
    expect(await weather.reverse(-33.87, 151.21)).toMatchObject({ name: 'Sydney', lat: -33.87, lon: 151.21 });
    const stored = kv.get(STORAGE_KEYS.weather.key);
    expect(stored === null ? [] : Object.keys((JSON.parse(stored) as { geo: object }).geo)).toEqual([]);
    expect(stored ?? '').not.toContain('151.21');
    // Asked once for the page...
    await weather.reverse(-33.87, 151.21);
    expect(network.callsTo(NOMINATIM)).toHaveLength(1);
    // ...and again after a reload, since nothing was kept.
    await service().reverse(-33.87, 151.21);
    expect(network.callsTo(NOMINATIM)).toHaveLength(2);
  });

  it('drops a position an earlier build kept, the next time the place cache is written', async () => {
    const hit = { place: { id: 'pt:-33.87,151.21', name: 'Sydney', lat: -33.87, lon: 151.21, kind: 'point', source: 'nominatim' }, alternatives: [] };
    kv.set(STORAGE_KEYS.weather.key, JSON.stringify({ v: 1, geo: { 'rev:-33.87,151.21': { at: clock, hit } } }));
    const weather = service();
    await weather.resolve('Oslo');
    const stored = JSON.parse(kv.get(STORAGE_KEYS.weather.key) ?? '{}') as { geo: object };
    expect(Object.keys(stored.geo)).toEqual(['q:oslo']);
  });

  it('asks OpenStreetMap, and gives null rather than an error', async () => {
    const weather = service();
    expect(await weather.reverse(-33.87, 151.21)).toMatchObject({ name: 'Sydney', region: 'New South Wales', credit: 'osm' });
    useNetwork((url) => (url.host === NOMINATIM ? json({ error: true }, 503) : undefined));
    expect(await service().reverse(1, 2)).toBeNull();
  });

  it('asks nothing when OpenStreetMap is switched off', async () => {
    expect(await service({ nominatim: false }).reverse(-33.87, 151.21)).toBeNull();
    expect(network.calls).toEqual([]);
  });

  it('still stops when cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    expect(await rejectionOf(service().reverse(5, 6, controller.signal))).toMatchObject({ kind: 'abort' });
  });
});

describe('trying again', () => {
  it('asks again after a failure it has said, rather than replaying it for the cool-down', async () => {
    let down = true;
    useNetwork((url) => (down ? json({ error: true }, 503) : undefined));
    const weather = service({ nominatim: false });
    expect(await rejectionOf(weather.forecast(-33.87, 151.21))).toMatchObject({ kind: 'http', status: 503 });
    expect(await rejectionOf(weather.forecast(-33.87, 151.21))).toMatchObject({ kind: 'http', status: 503 });
    expect(network.callsTo('api.open-meteo.com')).toHaveLength(2);
    expect(await rejectionOf(weather.resolve('Oslo'))).toMatchObject({ kind: 'http', status: 503 });
    expect(await rejectionOf(weather.ipLocate())).toMatchObject({ kind: 'http', status: 503 });
    down = false;
    expect((await weather.forecast(-33.87, 151.21)).forecast.timezone).toBe('Australia/Sydney');
    expect((await weather.resolve('Oslo')).place.name).toBe('Oslo');
    expect((await weather.ipLocate()).name).toBe('Sydney');
  });

  it('still shares one request between callers who ask at once', async () => {
    let answer: (response: Response) => void = () => {};
    useNetwork((url) => (url.host === 'api.open-meteo.com' ? new Promise<Response>((resolve) => (answer = resolve)) : undefined));
    const weather = service();
    const first = rejectionOf(weather.forecast(-33.87, 151.21));
    const second = rejectionOf(weather.forecast(-33.87, 151.21));
    await Promise.resolve();
    answer(json({ error: true }, 503));
    expect(await first).toMatchObject({ status: 503 });
    expect(await second).toMatchObject({ status: 503 });
    expect(network.callsTo('api.open-meteo.com')).toHaveLength(1);
  });
});

describe('the rest of the port', () => {
  it('resolves curated places with no network, and forecasts', async () => {
    const weather = service();
    const { place: gadigal } = await weather.resolve('Gadigal');
    expect(gadigal).toEqual(lookupCurated('Gadigal'));
    expect((await weather.forecast(gadigal.lat, gadigal.lon)).forecast.timezone).toBe('Australia/Sydney');
    expect(network.callsTo('geocoding-api.open-meteo.com')).toEqual([]);
  });

  it('has no device location unless one is given', async () => {
    expect(service().geolocation).toBe(NO_GEOLOCATION);
    expect(await NO_GEOLOCATION.permission()).toBe('unsupported');
    expect(await rejectionOf(NO_GEOLOCATION.locate({ timeoutMs: 1 }))).toMatchObject({ reason: 'unsupported' });
  });

  it("keeps Open-Meteo's reason for a failed request", async () => {
    useNetwork((url) => (url.host === 'api.open-meteo.com' ? json(fixture('forecast-error-400.json'), 400) : undefined));
    const error = await rejectionOf(service().forecast(200, 0));
    expect(error).toBeInstanceOf(UpstreamError);
    expect(error).toMatchObject({ kind: 'http', status: 400, host: 'api.open-meteo.com', reason: 'Latitude must be in range of -90 to 90°. Given: 200.0.' });
    useNetwork((url) => (url.host === 'geocoding-api.open-meteo.com' ? new Response('<html>busy</html>', { status: 502 }) : undefined));
    expect(await rejectionOf(service({ nominatim: false }).resolve('Oslo'))).toMatchObject({ kind: 'http', status: 502, reason: undefined });
  });
});
