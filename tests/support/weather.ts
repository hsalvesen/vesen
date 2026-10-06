// Test helpers for src/services/weather: recorded fixtures, an in-memory storage area and a
// fetch that answers from the fixtures and records every URL it was asked for.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { StorageKey } from '../../src/services/storage-keys';
import type { KV } from '../../src/services/types';

const FIXTURES = join(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures'), 'weather');

/** A recorded body from tests/fixtures/weather, parsed. See its README for provenance. */
export function fixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as unknown;
}

/** A storage area backed by a Map, as services/storage.ts would give with working storage. */
export function memoryKV(initial: Record<string, string> = {}): KV<'local'> & { readonly store: Map<string, string> } {
  const store = new Map(Object.entries(initial));
  return {
    store,
    persistent: true,
    get: (key: StorageKey<'local'>) => store.get(key) ?? null,
    set: (key: StorageKey<'local'>, value: string) => {
      store.set(key, value);
      return true;
    },
    remove: (key: StorageKey<'local'>) => {
      store.delete(key);
    },
    getJson<T>(key: StorageKey<'local'>, parse: (raw: unknown) => T | undefined): T | undefined {
      const raw = store.get(key);
      if (raw === undefined) return undefined;
      try {
        return parse(JSON.parse(raw));
      } catch {
        return undefined;
      }
    },
    setJson: (key: StorageKey<'local'>, value: unknown) => {
      store.set(key, JSON.stringify(value));
      return true;
    },
  };
}

export const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Answers a request, or returns undefined to fall through to the recorded fixtures. */
export type Responder = (url: URL) => Response | Promise<Response> | undefined;

/** Which fixture answers a URL, following the hosts and parameters the sources use. */
export function defaultResponse(url: URL): Response | undefined {
  const params = url.searchParams;
  switch (url.host) {
    case 'api.open-meteo.com':
      return json(fixture((params.get('latitude') ?? '').startsWith('59.') ? 'forecast-oslo.json' : 'forecast-sydney.json'));
    case 'geocoding-api.open-meteo.com': {
      const name = (params.get('name') ?? '').toLowerCase();
      const country = params.get('countryCode');
      if (name === 'oslo' && !country) return json(fixture('geocode-oslo.json'));
      if (name === 'springfield' && !country) return json(fixture('geocode-springfield.json'));
      if (name === 'paris' && country === 'FR') return json(fixture('geocode-paris-fr.json'));
      if (name === 'paris' && !country) return json(fixture('geocode-paris.json'));
      if (name === 'paris france') return json(fixture('geocode-paris-france.json'));
      // Gadigal's recorded answer is Open-Meteo's empty result.
      return json(fixture('geocode-gadigal.json'));
    }
    case 'nominatim.openstreetmap.org':
      if (url.pathname === '/reverse') return json(fixture('nominatim-reverse-sydney.json'));
      return json(fixture((params.get('q') ?? '').toLowerCase().includes('aotearoa') ? 'nominatim-aotearoa.json' : 'nominatim-gadigal.json'));
    case 'get.geojs.io':
      return json(fixture('geojs.json'));
    case 'ipinfo.io':
      return json(fixture('ipinfo.json'));
    default:
      return undefined;
  }
}

export interface WeatherFetch {
  readonly fetch: typeof fetch;
  /** Every URL requested, in order. */
  readonly calls: string[];
  /** Requests to one host. */
  callsTo(host: string): URL[];
}

/** A fetch over the recorded fixtures. `respond` can answer first; unknown hosts fail like the network. */
export function weatherFetch(respond?: Responder): WeatherFetch {
  const calls: string[] = [];
  const mock = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (init?.signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push(raw);
    const url = new URL(raw);
    const answer = (await respond?.(url)) ?? defaultResponse(url);
    if (answer) return answer;
    throw new TypeError('Failed to fetch');
  };
  return {
    fetch: mock as typeof fetch,
    calls,
    callsTo: (host: string) => calls.map((call) => new URL(call)).filter((url) => url.host === host),
  };
}
