// A fetch replacement that answers from recorded fixtures, so tests never touch the network.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { forecastUrl, geocodeUrl } from '../../src/services/weather/sources';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURES = join(ROOT, 'tests', 'fixtures', 'net');
const PUBLIC = join(ROOT, 'public');

interface Upstream {
  file: string;
  contentType: string;
}

/** Recorded bodies keyed by normalised URL. See tests/fixtures/net/README.md for provenance. */
const UPSTREAM: Record<string, Upstream> = {
  // weather Oslo: the place search, then the forecast at the place it found.
  [geocodeUrl('Oslo')]: { file: '../weather/geocode-oslo.json', contentType: 'application/json; charset=utf-8' },
  [forecastUrl(59.91273, 10.74609)]: { file: '../weather/forecast-oslo.json', contentType: 'application/json; charset=utf-8' },
  'https://query1.finance.yahoo.com/v8/finance/chart/AAPL': {
    file: 'yahoo-chart-aapl.json',
    contentType: 'application/json;charset=utf-8',
  },
  // What stock's interim source asks the proxy for (src/services/market/interim.ts).
  'https://query1.finance.yahoo.com/v8/finance/chart/AAPL?range=1d&interval=5m&includePrePost=false': {
    file: 'yahoo-chart-aapl.json',
    contentType: 'application/json;charset=utf-8',
  },
  'https://httpbin.org/get': { file: 'httpbin-get.json', contentType: 'application/json' },
  'https://api.ipify.org/?format=json': { file: 'ipify.json', contentType: 'application/json' },
};

const ALLORIGINS = 'https://api.allorigins.win';

export interface NetworkMock {
  fetch: typeof fetch;
  /** Every URL requested that no fixture answers. Tests assert this stays empty. */
  unmocked: string[];
}

function readFixture(upstream: Upstream): string {
  return readFileSync(join(FIXTURES, upstream.file), 'utf8');
}

function textResponse(body: string, contentType: string, status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': contentType } });
}

/** The JSON envelope api.allorigins.win/get wraps around an upstream body. */
function allOriginsResponse(target: string, upstream: Upstream): Response {
  const contents = readFixture(upstream);
  const envelope = {
    contents,
    status: {
      url: target,
      content_type: upstream.contentType,
      content_length: contents.length,
      http_code: 200,
      response_time: 120,
    },
  };
  return textResponse(JSON.stringify(envelope), 'application/json');
}

/** Same-origin requests read from public/, the way Vite and Firebase serve it. */
function publicResponse(pathname: string): Response {
  const file = join(PUBLIC, decodeURIComponent(pathname));
  const inside = file.startsWith(PUBLIC + sep);
  if (!inside || !existsSync(file) || !statSync(file).isFile()) {
    return textResponse('Not Found', 'text/plain', 404);
  }
  return textResponse(readFileSync(file, 'utf8'), 'text/plain; charset=utf-8');
}

function normalise(url: string): string {
  try {
    return new URL(url).href;
  } catch {
    return url;
  }
}

/**
 * Creates a fetch that serves public/ for `origin`, the recorded upstream bodies directly or
 * through the allorigins proxy, and rejects anything else like a network failure.
 */
export function createNetworkMock(origin: string): NetworkMock {
  const unmocked: string[] = [];
  const site = new URL(origin).origin;

  const mockFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (init?.signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');

    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, origin);

    if (url.origin === site) return publicResponse(url.pathname);

    if (url.origin === ALLORIGINS && url.pathname === '/get') {
      const target = normalise(url.searchParams.get('url') ?? '');
      const upstream = UPSTREAM[target];
      if (upstream) return allOriginsResponse(target, upstream);
    } else {
      const upstream = UPSTREAM[url.href];
      if (upstream) return textResponse(readFixture(upstream), upstream.contentType);
    }

    unmocked.push(url.href);
    throw new TypeError('Failed to fetch');
  };

  return { fetch: mockFetch as typeof fetch, unmocked };
}
