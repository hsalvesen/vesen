// Where weather data comes from: Open-Meteo for forecasts and place search, OpenStreetMap
// Nominatim as a throttled fallback and for reverse lookups, and GeoJS then ipinfo.io for an
// approximate location. Every request goes through services/net, so each has a deadline and a
// typed NetError. One instance per page holds the caches and the Nominatim throttle; the
// composition root builds it with the storage service.

import { NetError, createMemo, fetchAndRead, fetchJson, isNetError, untilAborted, type Memo } from '../net';
import { STORAGE_KEYS } from '../storage-keys';
import { REQUEST_TIMEOUT_MS, type KV } from '../types';
import { countryLabel } from './places';
import type { Current, Daily, Forecast, ForecastResult, Place, PlaceKind, StaleCause } from './types';
import { round } from './units';

// ── Endpoints and limits ───────────────────────────────────────────────────────────────────

export const OPEN_METEO_FORECAST = 'https://api.open-meteo.com/v1/forecast';
export const OPEN_METEO_GEOCODING = 'https://geocoding-api.open-meteo.com/v1/search';
export const NOMINATIM = 'https://nominatim.openstreetmap.org';
export const GEOJS = 'https://get.geojs.io/v1/ip/geo.json';
export const IPINFO = 'https://ipinfo.io/json';

export const WEATHER_TIMEOUTS = {
  forecast: REQUEST_TIMEOUT_MS.default,
  geocoding: REQUEST_TIMEOUT_MS.geocoding,
  nominatim: REQUEST_TIMEOUT_MS.geocoding,
  ip: REQUEST_TIMEOUT_MS.ipLookup,
} as const;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export const WEATHER_TTL = {
  /** A forecast is reused without asking again for this long. */
  forecastFresh: 10 * MINUTE,
  /** When Open-Meteo cannot be reached, a forecast this old may still be shown, marked stale. */
  forecastStale: 6 * HOUR,
  geocodeHit: 30 * 24 * HOUR,
  geocodeMiss: HOUR,
  ip: HOUR,
} as const;

/** Forecasts kept in memory for stale-on-error. */
export const FORECAST_CACHE_MAX = 20;
/** Place lookups kept in storage. */
export const GEO_CACHE_MAX = 50;
/** Nominatim's policy is at most one request a second; this keeps a margin. */
export const NOMINATIM_GAP_MS = 1100;
/** The owner's switch for the Nominatim fallback. */
export const NOMINATIM_ENABLED = true;

/**
 * Nominatim results kept, by `addresstype`. Filtering here rather than passing
 * featureType=settlement, which drops Aotearoa and Boorloo entirely.
 */
export const NOMINATIM_ADDRESS_TYPES: ReadonlySet<string> = new Set([
  'city', 'town', 'village', 'hamlet', 'municipality', 'suburb', 'county', 'state', 'region', 'province',
  'country', 'island', 'archipelago',
]);

const CURRENT_FIELDS = [
  'temperature_2m', 'apparent_temperature', 'relative_humidity_2m', 'is_day', 'precipitation', 'weather_code',
  'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m',
].join(',');
const DAILY_FIELDS = [
  'weather_code', 'temperature_2m_max', 'temperature_2m_min', 'precipitation_sum', 'precipitation_probability_max',
  'wind_speed_10m_max', 'sunrise', 'sunset', 'uv_index_max',
].join(',');

/** One call for current conditions and seven days, always metric, in the place's own time zone. */
export function forecastUrl(lat: number, lon: number): string {
  return (
    `${OPEN_METEO_FORECAST}?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
    `&current=${CURRENT_FIELDS}&daily=${DAILY_FIELDS}&timezone=auto&forecast_days=7`
  );
}

export function geocodeUrl(name: string, countryCode?: string): string {
  const country = countryCode ? `&countryCode=${encodeURIComponent(countryCode)}` : '';
  return `${OPEN_METEO_GEOCODING}?name=${encodeURIComponent(name)}&count=10&language=en&format=json${country}`;
}

export function nominatimSearchUrl(query: string): string {
  return `${NOMINATIM}/search?q=${encodeURIComponent(query)}&format=jsonv2&limit=5&addressdetails=1&accept-language=en`;
}

export function nominatimReverseUrl(lat: number, lon: number): string {
  return `${NOMINATIM}/reverse?lat=${lat.toFixed(2)}&lon=${lon.toFixed(2)}&format=jsonv2&zoom=10&accept-language=en`;
}

const hostOf = (url: string): string => new URL(url).host;

/** The longest provider reason kept for an error message. */
const MAX_REASON = 200;

/**
 * An HTTP failure, with the reason the provider's error body gives: Open-Meteo answers a bad
 * request with HTTP 400 and `{"error": true, "reason": "..."}`. A NetError of kind `http`.
 */
export class UpstreamError extends NetError {
  readonly reason: string | undefined;

  constructor(host: string, status: number, reason?: string) {
    super('http', host, { status });
    this.name = 'UpstreamError';
    this.reason = reason;
  }
}

/** Fetches JSON within `timeoutMs`; a non-2xx answer becomes an UpstreamError with the body's reason. */
function fetchJsonWithReason(url: string, timeoutMs: number): Promise<unknown> {
  return fetchAndRead(url, { timeoutMs, throwHttpErrors: false }, async (response) => {
    if (!response.ok && response.type !== 'opaque') {
      let reason: string | undefined;
      try {
        const body: unknown = await response.json();
        const text = isRecord(body) ? str(body.reason) : undefined;
        reason = text === undefined ? undefined : text.slice(0, MAX_REASON);
      } catch {
        // No readable reason; the status says enough.
      }
      throw new UpstreamError(hostOf(url), response.status, reason);
    }
    return (await response.json()) as unknown;
  });
}

// ── Parsing ────────────────────────────────────────────────────────────────────────────────

type Rec = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is Rec => typeof value === 'object' && value !== null && !Array.isArray(value);
const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const str = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined);
const numeric = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const at = (list: unknown, i: number): unknown => (Array.isArray(list) ? list[i] : undefined);
/** 'YYYY-MM-DDTHH:mm' to 'HH:mm'. */
const clock = (value: unknown): string | null => {
  const text = str(value);
  const match = text ? /T(\d{2}:\d{2})/.exec(text) : null;
  return match?.[1] ?? null;
};
const validLatLon = (lat: number | null, lon: number | null): boolean =>
  lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;

/** Reads an Open-Meteo forecast body, or null when it is not one. */
export function parseForecast(raw: unknown, fetchedAt: number): Forecast | null {
  if (!isRecord(raw) || !isRecord(raw.current) || !isRecord(raw.daily)) return null;
  const c = raw.current;
  const d = raw.daily;
  const lat = num(raw.latitude);
  const lon = num(raw.longitude);
  const time = str(c.time);
  if (!validLatLon(lat, lon) || !time || !Array.isArray(d.time)) return null;

  const current: Current = {
    time,
    isDay: c.is_day !== 0,
    code: num(c.weather_code),
    tempC: num(c.temperature_2m),
    feelsC: num(c.apparent_temperature),
    humidity: num(c.relative_humidity_2m),
    precipMm: num(c.precipitation),
    windKmh: num(c.wind_speed_10m),
    gustKmh: num(c.wind_gusts_10m),
    windDeg: num(c.wind_direction_10m),
  };
  const daily: Daily[] = [];
  d.time.forEach((date, i) => {
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    daily.push({
      date,
      code: num(at(d.weather_code, i)),
      minC: num(at(d.temperature_2m_min, i)),
      maxC: num(at(d.temperature_2m_max, i)),
      precipMm: num(at(d.precipitation_sum, i)),
      precipProb: num(at(d.precipitation_probability_max, i)),
      windMaxKmh: num(at(d.wind_speed_10m_max, i)),
      sunrise: clock(at(d.sunrise, i)),
      sunset: clock(at(d.sunset, i)),
      uvMax: num(at(d.uv_index_max, i)),
    });
  });
  if (daily.length === 0) return null;

  return {
    lat: lat as number,
    lon: lon as number,
    timezone: str(raw.timezone) ?? 'UTC',
    tzAbbrev: str(raw.timezone_abbreviation) ?? '',
    utcOffsetSeconds: num(raw.utc_offset_seconds) ?? 0,
    current,
    daily,
    fetchedAt,
  };
}

function kindFromFeature(code: string | undefined): PlaceKind {
  if (!code) return 'city';
  if (code.startsWith('PCL')) return 'country';
  if (code.startsWith('ADM') || code === 'RGN') return 'region';
  return 'city';
}

/** Reads an Open-Meteo geocoding body. A missing `results` key means no match. */
export function parseGeocoding(raw: unknown): Place[] {
  if (!isRecord(raw) || !Array.isArray(raw.results)) return [];
  return raw.results.flatMap((r): Place[] => {
    if (!isRecord(r)) return [];
    const name = str(r.name);
    const lat = num(r.latitude);
    const lon = num(r.longitude);
    if (!name || !validLatLon(lat, lon)) return [];
    const code = str(r.country_code)?.toUpperCase();
    const region = str(r.admin1);
    const district = str(r.admin2);
    const country = countryLabel(code, str(r.country));
    const population = num(r.population);
    return [{
      id: `om:${num(r.id) ?? `${lat},${lon}`}`,
      name: name.normalize('NFC'),
      ...(region ? { region: region.normalize('NFC') } : {}),
      ...(district ? { district: district.normalize('NFC') } : {}),
      ...(code ? { countryCode: code } : {}),
      ...(country ? { country } : {}),
      lat: lat as number,
      lon: lon as number,
      kind: kindFromFeature(str(r.feature_code)),
      source: 'open-meteo',
      ...(population !== null ? { population } : {}),
    }];
  });
}

function osmKind(addressType: string): PlaceKind {
  if (addressType === 'country') return 'country';
  if (['state', 'region', 'province', 'county', 'archipelago'].includes(addressType)) return 'region';
  return 'city';
}

function osmId(r: Rec): string {
  const type = str(r.osm_type)?.charAt(0).toUpperCase() ?? '';
  const id = num(r.osm_id);
  return id === null ? `osm:${str(r.place_id) ?? num(r.place_id) ?? 'unknown'}` : `osm:${type}${id}`;
}

/** Reads a Nominatim search body, keeping only results whose address type names a place. */
export function parseNominatimSearch(raw: unknown): Place[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r): Place[] => {
    if (!isRecord(r)) return [];
    const type = str(r.addresstype);
    const lat = numeric(r.lat);
    const lon = numeric(r.lon);
    const name = str(r.name);
    if (!type || !NOMINATIM_ADDRESS_TYPES.has(type) || !name || !validLatLon(lat, lon)) return [];
    const address = isRecord(r.address) ? r.address : {};
    const code = str(address.country_code)?.toUpperCase();
    const region = type === 'state' ? undefined : str(address.state) ?? str(address.region) ?? str(address.province);
    const country = countryLabel(code, str(address.country));
    return [{
      id: osmId(r),
      name: name.normalize('NFC'),
      ...(region ? { region: region.normalize('NFC') } : {}),
      ...(code ? { countryCode: code } : {}),
      ...(country ? { country } : {}),
      lat: lat as number,
      lon: lon as number,
      kind: osmKind(type),
      source: 'nominatim',
      credit: 'osm',
    }];
  });
}

/** Reads a Nominatim reverse body into a labelled point, or null when it found nothing. */
export function parseNominatimReverse(raw: unknown, lat: number, lon: number): Place | null {
  if (!isRecord(raw) || raw.error !== undefined) return null;
  const address = isRecord(raw.address) ? raw.address : {};
  const name =
    str(address.city) ?? str(address.town) ?? str(address.village) ?? str(address.municipality) ??
    str(address.county) ?? str(raw.name) ?? str(address.state);
  if (!name) return null;
  const code = str(address.country_code)?.toUpperCase();
  const state = str(address.state);
  const country = countryLabel(code, str(address.country));
  return {
    id: pointId(lat, lon),
    name: name.normalize('NFC'),
    ...(state && state !== name ? { region: state.normalize('NFC') } : {}),
    ...(code ? { countryCode: code } : {}),
    ...(country ? { country } : {}),
    lat,
    lon,
    kind: 'point',
    source: 'nominatim',
    credit: 'osm',
  };
}

export const pointId = (lat: number, lon: number): string => `pt:${lat.toFixed(2)},${lon.toFixed(2)}`;

function ipPlace(lat: number | null, lon: number | null, city?: string, region?: string, code?: string, countryName?: string): Place | null {
  if (!validLatLon(lat, lon)) return null;
  const country = countryLabel(code, countryName);
  const name = city ?? region ?? country;
  if (!name) return null;
  return {
    id: 'ip',
    name,
    ...(region && region !== name ? { region } : {}),
    ...(code ? { countryCode: code.toUpperCase() } : {}),
    ...(country ? { country } : {}),
    // Rounded to about 1 km before anything else sees it.
    lat: round(lat as number, 2),
    lon: round(lon as number, 2),
    kind: 'city',
    source: 'ip',
    approximate: true,
  };
}

export function parseGeoJs(raw: unknown): Place | null {
  if (!isRecord(raw)) return null;
  return ipPlace(numeric(raw.latitude), numeric(raw.longitude), str(raw.city), str(raw.region), str(raw.country_code), str(raw.country));
}

export function parseIpinfo(raw: unknown): Place | null {
  if (!isRecord(raw)) return null;
  const [lat, lon] = (str(raw.loc) ?? '').split(',').map(numeric);
  return ipPlace(lat ?? null, lon ?? null, str(raw.city), str(raw.region), str(raw.country));
}

// ── Place cache ────────────────────────────────────────────────────────────────────────────

/** A resolved place search: the place, and same-named places worth mentioning. */
export interface GeoHit {
  readonly place: Place;
  readonly alternatives: readonly Place[];
}

interface GeoEntry {
  readonly at: number;
  readonly hit: GeoHit | null;
}

/** The shape of `vesen:weather:v1`. Other fields, such as recent places, are kept as they are. */
interface StoredWeather {
  readonly v: 1;
  readonly geo: Readonly<Record<string, GeoEntry>>;
  readonly [other: string]: unknown;
}

const KINDS: ReadonlySet<string> = new Set(['city', 'region', 'country', 'point']);
const SOURCES: ReadonlySet<string> = new Set(['curated', 'coords', 'open-meteo', 'nominatim', 'ip', 'device']);

function isPlace(value: unknown): value is Place {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    validLatLon(num(value.lat), num(value.lon)) &&
    typeof value.kind === 'string' && KINDS.has(value.kind) &&
    typeof value.source === 'string' && SOURCES.has(value.source)
  );
}

function parseEntry(value: unknown): GeoEntry | undefined {
  if (!isRecord(value) || num(value.at) === null) return undefined;
  if (value.hit === null) return { at: value.at as number, hit: null };
  const hit = value.hit;
  if (!isRecord(hit) || !isPlace(hit.place) || !Array.isArray(hit.alternatives)) return undefined;
  return { at: value.at as number, hit: { place: hit.place, alternatives: hit.alternatives.filter(isPlace) } };
}

function parseStored(raw: unknown): StoredWeather | undefined {
  if (!isRecord(raw) || raw.v !== 1 || !isRecord(raw.geo)) return undefined;
  const geo: Record<string, GeoEntry> = {};
  for (const [key, value] of Object.entries(raw.geo)) {
    const entry = parseEntry(value);
    if (entry) geo[key] = entry;
  }
  return { ...raw, v: 1, geo };
}

/**
 * Place lookups by query, kept in `vesen:weather:v1`: hits for 30 days, misses for an hour, at
 * most 50. Without a storage area the cache lives in memory for the page.
 */
export class GeoCache {
  private memory: StoredWeather = { v: 1, geo: {} };

  constructor(
    private readonly kv: KV<'local'> | null,
    private readonly now: () => number,
  ) {}

  private load(): StoredWeather {
    if (!this.kv) return this.memory;
    return this.kv.getJson(STORAGE_KEYS.weather.key, parseStored) ?? { v: 1, geo: {} };
  }

  private save(state: StoredWeather): void {
    if (this.kv) this.kv.setJson(STORAGE_KEYS.weather.key, state);
    else this.memory = state;
  }

  private fresh(entry: GeoEntry, now: number): boolean {
    const ttl = entry.hit ? WEATHER_TTL.geocodeHit : WEATHER_TTL.geocodeMiss;
    return entry.at <= now && now - entry.at < ttl;
  }

  /** The cached result: a hit, null for a remembered miss, or undefined when not cached. */
  get(key: string): GeoHit | null | undefined {
    const { geo } = this.load();
    const entry = Object.prototype.hasOwnProperty.call(geo, key) ? geo[key] : undefined;
    if (!entry || !this.fresh(entry, this.now())) return undefined;
    return entry.hit;
  }

  set(key: string, hit: GeoHit | null): void {
    const now = this.now();
    const state = this.load();
    const kept = Object.entries(state.geo).filter(([k, entry]) => k !== key && this.fresh(entry, now));
    kept.sort(([, a], [, b]) => b.at - a.at);
    const geo = Object.fromEntries([[key, { at: now, hit }], ...kept.slice(0, GEO_CACHE_MAX - 1)]);
    this.save({ ...state, v: 1, geo });
  }

  /** Forgets every place lookup, keeping anything else stored under the key. */
  clear(): void {
    this.save({ ...this.load(), v: 1, geo: {} });
  }
}

// ── Recent places ──────────────────────────────────────────────────────────────────────────

/** How many recent places are kept, for `weather -`, did-you-mean and the bare `weather`. */
export const RECENT_MAX = 5;

function parseRecent(raw: unknown): readonly Place[] | undefined {
  if (!isRecord(raw) || raw.v !== 1 || !Array.isArray(raw.recent)) return undefined;
  return raw.recent.filter(isPlace);
}

/**
 * The places looked up, newest first, kept in `vesen:weather:v1` beside the place cache. A
 * location from the visitor's network or device is never kept.
 */
export class RecentPlaces {
  private memory: readonly Place[] = [];

  constructor(private readonly kv: KV<'local'> | null) {}

  list(): readonly Place[] {
    const places = this.kv ? this.kv.getJson(STORAGE_KEYS.weather.key, parseRecent) ?? [] : this.memory;
    return places.slice(0, RECENT_MAX);
  }

  add(place: Place): void {
    if (place.source === 'ip' || place.source === 'device' || place.approximate) return;
    const next = [place, ...this.list().filter((p) => p.id !== place.id)].slice(0, RECENT_MAX);
    if (!this.kv) {
      this.memory = next;
      return;
    }
    const state = this.kv.getJson(STORAGE_KEYS.weather.key, parseStored) ?? { v: 1, geo: {} };
    this.kv.setJson(STORAGE_KEYS.weather.key, { ...state, v: 1, recent: next });
  }

  clear(): void {
    this.memory = [];
  }
}

// ── Throttle ───────────────────────────────────────────────────────────────────────────────

function sleep(ms: number, signal: AbortSignal | null | undefined, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new NetError('abort', host));
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new NetError('abort', host));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Spaces calls at least `gapMs` apart. Each caller reserves its slot first, so callers queue. */
export class Throttle {
  private next = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly gapMs: number,
    private readonly now: () => number,
  ) {}

  async wait(signal: AbortSignal | null | undefined, host: string): Promise<void> {
    const at = this.now();
    const slot = Math.max(at, this.next);
    this.next = slot + this.gapMs;
    if (slot > at) await sleep(slot - at, signal, host);
  }
}

// ── Sources ────────────────────────────────────────────────────────────────────────────────

export type { ForecastResult };

export interface WeatherSources {
  /** The forecast at a point: cached for 10 minutes, and up to 6 hours old when Open-Meteo fails. */
  forecast(lat: number, lon: number, signal?: AbortSignal | null): Promise<ForecastResult>;
  /** Open-Meteo place search, up to 10 results, optionally within one country. */
  geocode(name: string, countryCode?: string, signal?: AbortSignal | null): Promise<Place[]>;
  /** Nominatim place search, at least 1.1 s after the previous Nominatim call. */
  nominatimSearch(query: string, signal?: AbortSignal | null): Promise<Place[]>;
  /** A label for a point from Nominatim, cached like a search; null when it has none. */
  nominatimReverse(lat: number, lon: number, signal?: AbortSignal | null): Promise<Place | null>;
  /** The visitor's approximate location from their IP address: GeoJS, then ipinfo.io. Never stored. */
  ipLocate(signal?: AbortSignal | null): Promise<Place>;
  readonly geoCache: GeoCache;
  readonly recents: RecentPlaces;
  /** Forgets everything: the stored places and lookups, and the forecasts and location in memory. */
  forget(): void;
}

export interface WeatherSourcesOptions {
  /** Where place lookups persist. Without one they last for the page. */
  readonly kv?: KV<'local'> | null;
  readonly now?: () => number;
  /** In-flight sharing and failure cool-down. Defaults to a table of this instance's own. */
  readonly memo?: Memo;
  readonly nominatimGapMs?: number;
}

/** The forecast cache key: about 1 km, so nearby places share a forecast. */
const forecastKey = (lat: number, lon: number): string => `${lat.toFixed(2)},${lon.toFixed(2)}`;

function staleCause(error: unknown): StaleCause | null {
  if (!isNetError(error)) return null;
  switch (error.kind) {
    case 'offline':
      return 'offline';
    case 'timeout':
      return 'timeout';
    case 'network':
    case 'cors':
    case 'parse':
      return 'upstream';
    case 'http':
      return error.status !== undefined && (error.status >= 500 || error.status === 429) ? 'upstream' : null;
    case 'abort':
      return null;
  }
}

const aborted = (error: unknown, signal: AbortSignal | null | undefined): boolean =>
  Boolean(signal?.aborted) || (isNetError(error) && error.kind === 'abort');

export function createWeatherSources(options: WeatherSourcesOptions = {}): WeatherSources {
  const now = options.now ?? Date.now;
  const memo = options.memo ?? createMemo({ now });
  const throttle = new Throttle(options.nominatimGapMs ?? NOMINATIM_GAP_MS, now);
  const geoCache = new GeoCache(options.kv ?? null, now);
  const recents = new RecentPlaces(options.kv ?? null);
  const lastGood = new Map<string, Forecast>();

  const remember = (key: string, forecast: Forecast): void => {
    lastGood.delete(key);
    lastGood.set(key, forecast);
    while (lastGood.size > FORECAST_CACHE_MAX) {
      const oldest = lastGood.keys().next().value;
      if (oldest === undefined) break;
      lastGood.delete(oldest);
    }
  };

  const loadForecast = async (lat: number, lon: number): Promise<Forecast> => {
    const url = forecastUrl(lat, lon);
    const raw = await fetchJsonWithReason(url, WEATHER_TIMEOUTS.forecast);
    const forecast = parseForecast(raw, now());
    if (!forecast) throw new NetError('parse', hostOf(url));
    return forecast;
  };

  const forecast = async (lat: number, lon: number, signal?: AbortSignal | null): Promise<ForecastResult> => {
    if (signal?.aborted) throw new NetError('abort', hostOf(OPEN_METEO_FORECAST));
    const key = forecastKey(lat, lon);
    const shared = memo(`weather:forecast:${key}`, WEATHER_TTL.forecastFresh, () => loadForecast(lat, lon));
    try {
      const result = await untilAborted(shared, signal, hostOf(OPEN_METEO_FORECAST));
      remember(key, result);
      return { forecast: result };
    } catch (error) {
      if (aborted(error, signal)) throw error;
      const cause = staleCause(error);
      const last = lastGood.get(key);
      const ageMs = last ? now() - last.fetchedAt : Number.POSITIVE_INFINITY;
      if (last && cause && ageMs <= WEATHER_TTL.forecastStale) return { forecast: last, stale: { ageMs, cause } };
      throw error;
    }
  };

  const geocode = async (name: string, countryCode?: string, signal?: AbortSignal | null): Promise<Place[]> => {
    const url = geocodeUrl(name, countryCode);
    if (signal?.aborted) throw new NetError('abort', hostOf(url));
    // Successes persist in the place cache; memo only shares requests and remembers failures.
    const shared = memo(`weather:geocode:${url}`, 0, async () =>
      parseGeocoding(await fetchJsonWithReason(url, WEATHER_TIMEOUTS.geocoding)),
    );
    return untilAborted(shared, signal, hostOf(url));
  };

  const nominatim = async <T>(url: string, signal: AbortSignal | null | undefined, parse: (raw: unknown) => T): Promise<T> => {
    const host = hostOf(url);
    await throttle.wait(signal, host);
    return parse(await fetchJson<unknown>(url, { timeoutMs: WEATHER_TIMEOUTS.nominatim, signal: signal ?? null }));
  };

  const nominatimSearch = (query: string, signal?: AbortSignal | null): Promise<Place[]> =>
    nominatim(nominatimSearchUrl(query), signal, parseNominatimSearch);

  const nominatimReverse = async (lat: number, lon: number, signal?: AbortSignal | null): Promise<Place | null> => {
    const key = `rev:${forecastKey(lat, lon)}`;
    const cached = geoCache.get(key);
    if (cached !== undefined) return cached?.place ?? null;
    const place = await nominatim(nominatimReverseUrl(lat, lon), signal, (raw) => parseNominatimReverse(raw, lat, lon));
    geoCache.set(key, place ? { place, alternatives: [] } : null);
    return place;
  };

  const locateByIp = async (): Promise<Place> => {
    try {
      const place = parseGeoJs(await fetchJson<unknown>(GEOJS, { timeoutMs: WEATHER_TIMEOUTS.ip }));
      if (place) return place;
      throw new NetError('parse', hostOf(GEOJS));
    } catch {
      const place = parseIpinfo(await fetchJson<unknown>(IPINFO, { timeoutMs: WEATHER_TIMEOUTS.ip }));
      if (place) return place;
      throw new NetError('parse', hostOf(IPINFO));
    }
  };

  const ipLocate = async (signal?: AbortSignal | null): Promise<Place> => {
    if (signal?.aborted) throw new NetError('abort', hostOf(GEOJS));
    return untilAborted(memo('weather:ip', WEATHER_TTL.ip, locateByIp), signal, hostOf(GEOJS));
  };

  const forget = (): void => {
    geoCache.clear();
    recents.clear();
    options.kv?.remove(STORAGE_KEYS.weather.key);
    lastGood.clear();
    memo.clear();
  };

  return { forecast, geocode, nominatimSearch, nominatimReverse, ipLocate, geoCache, recents, forget };
}
