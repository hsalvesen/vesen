// The market client's policy (docs/plan/07-stock-and-proxy.md, "Client data layer"): the Worker
// and the interim proxy, 8 s per attempt, one retry only after a fast failure, the budget,
// Retry-After, the 30 s memory, saved copies for the STALE state, the envelope guards and
// origin_not_allowed. fetch is faked, the clock is faked, and storage may throw; nothing here
// touches the network. worker/stock/test/client.test.ts runs the Worker's own handler in-process
// and reads its answers with this client.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chartFixture, fixture, fixtureJson } from '../../testing/quotes';
import { STORAGE_KEYS } from '../storage-keys';
import type { KV } from '../types';
import { createMarketClient, MARKET_LIMITS } from './client';
import type { QuoteEnvelope, Range, SnapshotEnvelope } from './contract';
import { interimUrl } from './interim';
import { normaliseYahooChart } from './normalise';
import type { FetchPhase, QuoteOutcome } from './port';

const BASE = 'https://stock.test';
/** 2026-10-06 03:30 UTC, when the upstream fixtures were recorded. */
const RECORDED_AT_MS = 1_791_257_400_000;

/** A Worker answer for `symbol`, normalised from its recorded Yahoo chart. */
function envelope(symbol: string, range: Range = '1d'): QuoteEnvelope {
  const result = normaliseYahooChart(fixtureJson(chartFixture(symbol, range)), symbol, range, RECORDED_AT_MS / 1000);
  if (result.ok === false) throw new Error(result.detail);
  return result.quote;
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const error = (code: string, status: number, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}): Response =>
  json({ v: 1, kind: 'error', error: { code, message: 'm', ...extra } }, status, headers);

type Handler = (url: URL, init: RequestInit | undefined) => Response | Promise<Response>;

const aborted = (): DOMException => new DOMException('The operation was aborted.', 'AbortError');

/** Never answers, until the request is aborted. */
const hang: Handler = (_url, init) =>
  new Promise((_, reject) => {
    init?.signal?.addEventListener('abort', () => reject(aborted()));
  });

const failed: Handler = () => Promise.reject(new TypeError('Failed to fetch'));

interface FakeFetch {
  readonly calls: string[];
  readonly inits: (RequestInit | undefined)[];
  /** Answers the next requests in order; the last one answers every request after. */
  answer(...handlers: Handler[]): void;
}

function fakeFetch(): FakeFetch {
  const calls: string[] = [];
  const inits: (RequestInit | undefined)[] = [];
  let queue: Handler[] = [() => json({})];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      calls.push(url);
      inits.push(init);
      if (init?.signal?.aborted) throw aborted();
      const handler = queue.length > 1 ? (queue.shift() as Handler) : (queue[0] as Handler);
      return handler(new URL(url), init);
    }),
  );
  return {
    calls,
    inits,
    answer(...handlers) {
      queue = handlers;
    },
  };
}

function memoryKv(): KV<'local'> & { readonly data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    persistent: true,
    get: (key) => data.get(key) ?? null,
    set: (key, value) => {
      data.set(key, value);
      return true;
    },
    remove: (key) => {
      data.delete(key);
    },
    getJson(key, parse) {
      const raw = data.get(key);
      if (raw === undefined) return undefined;
      try {
        return parse(JSON.parse(raw) as unknown);
      } catch {
        return undefined;
      }
    },
    setJson(key, value) {
      data.set(key, JSON.stringify(value));
      return true;
    },
  };
}

/** Storage that throws on every access, as a browser that blocks site data does. */
function throwingKv(): KV<'local'> {
  const boom = (): never => {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  };
  return { persistent: false, get: boom, set: boom, remove: boom, getJson: boom, setJson: boom };
}

let net: FakeFetch;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(RECORDED_AT_MS);
  net = fakeFetch();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function worker(options: { storage?: KV<'local'> | null; online?: () => boolean } = {}) {
  return createMarketClient({ baseUrl: BASE, storage: options.storage ?? null, now: () => Date.now(), random: () => 0.5, online: options.online ?? (() => true) });
}

/** Runs a lookup to the end, moving the fake clock as far as `ms` allows. */
async function settle<T>(promise: Promise<T>, ms = 20_000): Promise<T> {
  let done = false;
  void promise.finally(() => {
    done = true;
  });
  for (let waited = 0; waited < ms && !done; waited += 100) await vi.advanceTimersByTimeAsync(100);
  return promise;
}

const live = (outcome: QuoteOutcome): QuoteEnvelope => {
  if (outcome.ok === false || outcome.freshness === 'saved') throw new Error(`not live: ${JSON.stringify(outcome)}`);
  return outcome.quote;
};

describe('the Worker', () => {
  it('asks /v1/quote with a simple GET, checks the envelope and saves the last good copy', async () => {
    const kv = memoryKv();
    net.answer(() => json(envelope('AAPL')));
    const outcome = await worker({ storage: kv }).quote('AAPL', '1d');
    expect(live(outcome).price).toBe(332.89);
    expect(outcome).toMatchObject({ ok: true, freshness: 'live', via: 'worker' });
    expect(net.calls).toEqual([`${BASE}/v1/quote?symbol=AAPL&range=1d`]);
    // No custom headers and no body, so the browser sends no preflight.
    expect(net.inits[0]?.headers).toBeUndefined();
    expect(net.inits[0]?.method).toBeUndefined();
    const stored = JSON.parse(kv.data.get(STORAGE_KEYS.stock.key) ?? '{}') as { quotes: { quote: QuoteEnvelope }[]; recents: string[] };
    expect(stored.recents).toEqual(['AAPL']);
    expect(stored.quotes[0]?.quote.symbol).toBe('AAPL');
    // The saved chart is cut down to stay small.
    expect(stored.quotes[0]?.quote.series?.points.length).toBeLessThanOrEqual(MARKET_LIMITS.savedPoints);
  });

  it('encodes the symbol and asks for the range', async () => {
    net.answer(() => json(envelope('^AXJO')));
    await worker().quote('^AXJO', '5d').catch(() => undefined);
    expect(net.calls[0]).toBe(`${BASE}/v1/quote?symbol=%5EAXJO&range=5d`);
  });

  it('reuses an answer for 30 s, shares one request between two lookups, and asks again when forced', async () => {
    net.answer(() => json(envelope('AAPL')));
    const client = worker();
    const [a, b] = await Promise.all([client.quote('AAPL', '1d'), client.quote('AAPL', '1d')]);
    expect(net.calls).toHaveLength(1);
    expect(a).toMatchObject({ freshness: 'live' });
    expect(b).toMatchObject({ freshness: 'memory' });

    await vi.advanceTimersByTimeAsync(29_000);
    expect(await client.quote('AAPL', '1d')).toMatchObject({ freshness: 'memory' });
    expect(net.calls).toHaveLength(1);

    expect(await client.quote('AAPL', '1d', { force: true })).toMatchObject({ freshness: 'live' });
    expect(net.calls).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(31_000);
    await client.quote('AAPL', '1d');
    expect(net.calls).toHaveLength(3);
    // Another range is another answer.
    await client.quote('AAPL', '5d');
    expect(net.calls).toHaveLength(4);
  });

  it('tries once more after a fast failure, after a pause, and says so', async () => {
    net.answer(failed, () => json(envelope('AAPL')));
    const phases: [FetchPhase, number][] = [];
    const outcome = await settle(worker().quote('AAPL', '1d', { onPhase: (phase, attempt) => phases.push([phase, attempt]) }));
    expect(live(outcome).symbol).toBe('AAPL');
    expect(net.calls).toHaveLength(2);
    expect(phases).toEqual([['retry', 2]]);
  });

  it('waits 400 to 800 ms before the retry', async () => {
    net.answer(failed, () => json(envelope('AAPL')));
    const pending = worker().quote('AAPL', '1d');
    await vi.advanceTimersByTimeAsync(399);
    expect(net.calls).toHaveLength(1);
    // random() is 0.5: 400 + 200 ms.
    await vi.advanceTimersByTimeAsync(201);
    expect(net.calls).toHaveLength(2);
    await pending;
  });

  it('retries a 5xx, and an unreadable body such as an error page from the platform', async () => {
    net.answer(() => error('internal', 500), () => json(envelope('AAPL')));
    expect(live(await settle(worker().quote('AAPL', '1d'))).symbol).toBe('AAPL');

    net.answer(() => new Response('<html>error code: 1027</html>', { status: 200, headers: { 'content-type': 'text/html' } }), () => json(envelope('AAPL')));
    expect(live(await settle(worker().quote('AAPL', '1d'))).symbol).toBe('AAPL');
  });

  it('retries at most once', async () => {
    net.answer(failed);
    const outcome = await settle(worker().quote('ZS', '1d'));
    expect(outcome).toEqual({ ok: false, error: { code: 'network' } });
    expect(net.calls).toHaveLength(2);
  });

  it('does not retry the upstream_unavailable that asks for 30 s, and keeps its Retry-After', async () => {
    net.answer(() => error('upstream_unavailable', 503, { retryAfter: 30 }, { 'Retry-After': '30' }));
    const outcome = await settle(worker().quote('ZS', '1d'));
    expect(outcome).toEqual({ ok: false, error: { code: 'upstream_unavailable', retryAfter: 30 } });
    expect(net.calls).toHaveLength(1);
  });

  it('gives up after 8 s with no retry, within the budget', async () => {
    net.answer(hang);
    const started = Date.now();
    const outcome = await settle(worker().quote('ZS', '1d'));
    expect(outcome).toEqual({ ok: false, error: { code: 'timeout' } });
    expect(net.calls).toHaveLength(1);
    expect(Date.now() - started).toBeLessThanOrEqual(MARKET_LIMITS.attemptMs + 200);
  });

  it('keeps a slow failure and the retry within the budget', async () => {
    // A connection that fails after 2 s, then one that never answers: the retry gets what is left.
    net.answer(
      () => new Promise<Response>((_, reject) => setTimeout(() => reject(new TypeError('Failed to fetch')), 2000)),
      hang,
    );
    const started = Date.now();
    const outcome = await settle(worker().quote('AAPL', '1d', { budgetMs: 9500 }));
    expect(outcome).toEqual({ ok: false, error: { code: 'timeout' } });
    expect(net.calls).toHaveLength(2);
    expect(Date.now() - started).toBeLessThanOrEqual(9500 + 200);
  });

  it('does not retry a fast failure when under 3 s of the budget is left', async () => {
    net.answer(() => new Promise<Response>((_, reject) => setTimeout(() => reject(new TypeError('Failed to fetch')), 1500)));
    const outcome = await settle(worker().quote('ZS', '1d', { budgetMs: 4000 }));
    expect(outcome).toEqual({ ok: false, error: { code: 'network' } });
    expect(net.calls).toHaveLength(1);
  });

  it('does not retry a failure that took longer than 3 s', async () => {
    net.answer(() => new Promise<Response>((_, reject) => setTimeout(() => reject(new TypeError('Failed to fetch')), 3500)));
    const outcome = await settle(worker().quote('ZS', '1d'));
    expect(outcome).toEqual({ ok: false, error: { code: 'network' } });
    expect(net.calls).toHaveLength(1);
  });

  it('says it is slow at 2.5 s and very slow at 6 s', async () => {
    net.answer(() => new Promise<Response>((resolve) => setTimeout(() => resolve(json(envelope('AAPL'))), 7000)));
    const phases: FetchPhase[] = [];
    await settle(worker().quote('AAPL', '1d', { onPhase: (phase) => phases.push(phase) }));
    expect(phases).toEqual(['slow', 'very-slow']);
  });

  it('honours a Retry-After of 3 s or less, once', async () => {
    net.answer(() => error('rate_limited', 429, { retryAfter: 2 }, { 'Retry-After': '2' }), () => json(envelope('AAPL')));
    const pending = worker().quote('AAPL', '1d');
    await vi.advanceTimersByTimeAsync(1900);
    expect(net.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(200);
    expect(net.calls).toHaveLength(2);
    expect(live(await pending).symbol).toBe('AAPL');
  });

  it('fails a longer Retry-After at once as rate_limited, with the saved copy when there is one', async () => {
    const kv = memoryKv();
    const client = worker({ storage: kv });
    net.answer(() => json(envelope('AAPL')));
    await client.quote('AAPL', '1d');

    net.answer(() => error('rate_limited', 429, { retryAfter: 30 }, { 'Retry-After': '30' }));
    await vi.advanceTimersByTimeAsync(60_000);
    const fresh = createMarketClient({ baseUrl: BASE, storage: memoryKv(), now: () => Date.now(), online: () => true });
    expect(await fresh.quote('ZS', '1d')).toEqual({ ok: false, error: { code: 'rate_limited', retryAfter: 30 } });

    const outcome = await client.quote('AAPL', '1d');
    expect(outcome).toMatchObject({ ok: true, freshness: 'saved', reason: 'rate_limited' });
    expect(net.calls).toHaveLength(3);
  });

  it('returns not_found with its suggestions, with no retry and no saved copy', async () => {
    const kv = memoryKv();
    const suggestions = [{ symbol: 'ZS', name: 'Zscaler, Inc.', exchange: 'NasdaqGS', type: 'EQUITY' }];
    net.answer(() => error('not_found', 404, { suggestions }));
    const outcome = await worker({ storage: kv }).quote('ZZZZQQ', '1d');
    expect(outcome).toEqual({ ok: false, error: { code: 'not_found', suggestions } });
    expect(net.calls).toHaveLength(1);
  });

  it('reports origin_not_allowed, from the envelope or a bare 403', async () => {
    net.answer(() => error('origin_not_allowed', 403));
    expect(await worker().quote('AAPL', '1d')).toEqual({ ok: false, error: { code: 'origin_not_allowed' } });
    net.answer(() => new Response('Forbidden', { status: 403 }));
    expect(await worker().quote('AAPL', '1d')).toEqual({ ok: false, error: { code: 'origin_not_allowed' } });
  });

  it('turns an envelope that fails the guards into upstream_unavailable, never a broken card', async () => {
    const bad = [
      { ...envelope('AAPL'), price: '332.89' },
      { ...envelope('AAPL'), previousClose: 'NaN' },
      { ...envelope('AAPL'), v: 2 },
      { ...envelope('AAPL'), series: { ...envelope('AAPL').series, points: [[0, 'x']] } },
      { chart: { result: [] } },
    ];
    for (const body of bad) {
      net.answer(() => json(body));
      expect(await settle(worker().quote('AAPL', '1d'))).toEqual({ ok: false, error: { code: 'upstream_unavailable' } });
    }
  });

  it('stops at once for a cancel, with no saved copy and nothing saved', async () => {
    const kv = memoryKv();
    const client = worker({ storage: kv });
    net.answer(() => json(envelope('AAPL')));
    await client.quote('AAPL', '1d');
    kv.data.clear();

    net.answer(hang);
    const controller = new AbortController();
    const pending = client.quote('AAPL', '5d', { signal: controller.signal });
    await vi.advanceTimersByTimeAsync(500);
    controller.abort();
    expect(await pending).toEqual({ ok: false, error: { code: 'cancelled' } });
    expect(kv.data.size).toBe(0);
    // Already cancelled: nothing is asked.
    const calls = net.calls.length;
    expect(await client.quote('AAPL', '1d', { signal: controller.signal })).toEqual({ ok: false, error: { code: 'cancelled' } });
    expect(net.calls).toHaveLength(calls);
  });

  it('works with storage that throws on every access, keeping copies for the page', async () => {
    const client = worker({ storage: throwingKv() });
    net.answer(() => json(envelope('AAPL')));
    expect(live(await client.quote('AAPL', '1d')).symbol).toBe('AAPL');
    expect(client.recent()).toEqual(['AAPL']);
    net.answer(failed);
    const outcome = await settle(client.quote('AAPL', '1d', { force: true }));
    expect(outcome).toMatchObject({ ok: true, freshness: 'saved', reason: 'network' });
  });

  it('makes no request offline, and shows the saved copy, or says it is offline', async () => {
    const kv = memoryKv();
    let online = true;
    const client = worker({ storage: kv, online: () => online });
    net.answer(() => json(envelope('AAPL')));
    await client.quote('AAPL', '1d');
    const calls = net.calls.length;
    online = false;
    expect(await client.quote('AAPL', '1d')).toMatchObject({ ok: true, freshness: 'saved', reason: 'offline', savedAt: RECORDED_AT_MS });
    expect(await client.quote('TEAM', '1d')).toEqual({ ok: false, error: { code: 'offline' } });
    expect(net.calls).toHaveLength(calls);
  });

  it('shows the saved copy, marked with why, when live data times out', async () => {
    const kv = memoryKv();
    const client = worker({ storage: kv });
    net.answer(() => json(envelope('CBA.AX')));
    await client.quote('CBA.AX', '1d');
    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000);

    net.answer(hang);
    const outcome = await settle(client.quote('CBA.AX', '1d', { force: true }));
    expect(outcome).toMatchObject({ ok: true, freshness: 'saved', reason: 'timeout', savedAt: RECORDED_AT_MS });
  });

  it('does not show a saved copy older than a week', async () => {
    const kv = memoryKv();
    const client = worker({ storage: kv });
    net.answer(() => json(envelope('AAPL')));
    await client.quote('AAPL', '1d');
    await vi.advanceTimersByTimeAsync(MARKET_LIMITS.savedMaxAgeMs + 60_000);
    net.answer(failed);
    expect(await settle(client.quote('AAPL', '1d', { force: true }))).toEqual({ ok: false, error: { code: 'network' } });
  });

  it("finds a name's saved copy by what it resolved to", async () => {
    const kv = memoryKv();
    const client = worker({ storage: kv });
    net.answer(() => json({ ...envelope('CBA.AX'), resolvedFrom: 'CBA' }));
    await client.quote('CBA', '1d');
    expect(client.recent()).toEqual(['CBA.AX']);
    net.answer(failed);
    const outcome = await settle(client.quote('CBA', '1d', { force: true }));
    expect(outcome).toMatchObject({ ok: true, freshness: 'saved' });
    if (outcome.ok === true) expect(outcome.quote.symbol).toBe('CBA.AX');
  });

  it("asks for the Worker's snapshot of a curated ticker when there is no saved copy", async () => {
    const quote = { ...envelope('TEAM'), source: 'snapshot', series: null };
    const snapshot: SnapshotEnvelope = { v: 1, kind: 'snapshot', generatedAt: RECORDED_AT_MS / 1000, quotes: [quote as QuoteEnvelope], missing: [] };
    net.answer((url) => (url.pathname === '/v1/snapshot' ? json(snapshot) : error('upstream_unavailable', 503, { retryAfter: 30 }, { 'Retry-After': '30' })));
    const outcome = await settle(worker().quote('TEAM', '1d'));
    expect(outcome).toMatchObject({ ok: true, freshness: 'saved', reason: 'upstream_unavailable', savedAt: RECORDED_AT_MS });
    expect(net.calls).toEqual([`${BASE}/v1/quote?symbol=TEAM&range=1d`, `${BASE}/v1/snapshot`]);
    // A ticker that is not curated has no snapshot to ask for.
    const other = await settle(worker().quote('ZS', '1d'));
    expect(other).toEqual({ ok: false, error: { code: 'upstream_unavailable', retryAfter: 30 } });
  });

  it('lists recent tickers, newest first, at most 8', async () => {
    const client = worker({ storage: memoryKv() });
    for (const symbol of ['AAPL', 'TEAM', 'MSFT', 'NVDA', 'CBA.AX', 'BHP.AX', '^AXJO', '^GSPC', 'BTC-USD', 'AAPL']) {
      net.answer(() => json(envelope(symbol)));
      await client.quote(symbol, '1d');
    }
    expect(client.recent()).toEqual(['AAPL', 'BTC-USD', '^GSPC', '^AXJO', 'BHP.AX', 'CBA.AX', 'NVDA', 'MSFT']);
  });

  it('searches through /v1/search, and the known names when it fails', async () => {
    const hits = [{ symbol: 'CBA.AX', name: 'Commonwealth Bank of Australia', exchange: 'ASX', type: 'EQUITY' }];
    net.answer(() => json({ v: 1, kind: 'search', query: 'commonwealth bank', hits }));
    expect(await worker().search('commonwealth bank')).toEqual({ ok: true, hits, from: 'worker' });
    expect(net.calls[0]).toBe(`${BASE}/v1/search?q=commonwealth%20bank&limit=6`);

    net.answer(failed);
    expect(await worker().search('apple')).toMatchObject({ ok: true, from: 'local', hits: [{ symbol: 'AAPL' }] });
    expect(await worker().search('zzzzqq')).toEqual({ ok: false, error: { code: 'network' } });
    net.answer(() => error('origin_not_allowed', 403));
    expect(await worker().search('apple')).toEqual({ ok: false, error: { code: 'origin_not_allowed' } });
  });
});

describe('the interim proxy', () => {
  function interim(storage: KV<'local'> | null = null) {
    return createMarketClient({ baseUrl: null, storage, now: () => Date.now(), random: () => 0.5, online: () => true });
  }

  /** The proxy's envelope around a Yahoo body. */
  const proxied = (contents: string | null, httpCode = 200, status = 200): Response =>
    json({ contents, status: { url: 'x', content_type: 'application/json', http_code: httpCode, response_time: 1 } }, status);

  /** Answers like the proxy in front of the recorded Yahoo charts. */
  const yahoo: Handler = (url) => {
    const target = new URL(url.searchParams.get('url') ?? '');
    const symbol = decodeURIComponent(target.pathname.split('/').pop() ?? '');
    try {
      return proxied(fixture(chartFixture(symbol, target.searchParams.get('range') ?? '1d')));
    } catch {
      return proxied(fixture('yahoo-chart-zzzzqq-404.json'), 404);
    }
  };

  it('reads Yahoo through the proxy into the same envelope, marked as the interim source', async () => {
    net.answer(yahoo);
    const client = interim();
    expect(client.backend).toBe('interim');
    const outcome = await client.quote('CBA.AX', '1d');
    expect(outcome).toMatchObject({ ok: true, freshness: 'live', via: 'interim' });
    expect(live(outcome)).toEqual(envelope('CBA.AX'));
    expect(net.calls).toEqual([interimUrl('CBA.AX', '1d')]);
    expect(net.calls[0]).toBe(
      'https://api.allorigins.win/get?url=https%3A%2F%2Fquery1.finance.yahoo.com%2Fv8%2Ffinance%2Fchart%2FCBA.AX%3Frange%3D1d%26interval%3D5m%26includePrePost%3Dfalse',
    );
  });

  it('resolves a name Yahoo does not know from the known names, and says so', async () => {
    net.answer(yahoo);
    const outcome = await interim().quote('CBA', '1d');
    expect(live(outcome)).toMatchObject({ symbol: 'CBA.AX', resolvedFrom: 'CBA' });
    expect(net.calls).toEqual([interimUrl('CBA', '1d'), interimUrl('CBA.AX', '1d')]);
    expect(live(await interim().quote('APPLE', '1d'))).toMatchObject({ symbol: 'AAPL', resolvedFrom: 'APPLE' });
  });

  it('reports a ticker that does not exist, with suggestions from the known names', async () => {
    net.answer(yahoo);
    expect(await interim().quote('ZZZZQQ', '1d')).toEqual({ ok: false, error: { code: 'not_found', suggestions: [] } });
    const typo = await interim().quote('APPL', '1d');
    expect(typo).toMatchObject({ ok: false, error: { code: 'not_found', suggestions: [{ symbol: 'AAPL' }] } });
  });

  it("retries the proxy's own quick failures, and reads a rate-limited Yahoo as rate_limited", async () => {
    net.answer(() => new Response('error code: 522', { status: 522 }), yahoo);
    expect(live(await settle(interim().quote('AAPL', '1d'))).symbol).toBe('AAPL');
    net.answer(() => proxied(fixture('yahoo-chart-429.txt'), 429));
    expect(await settle(interim().quote('AAPL', '1d'))).toEqual({ ok: false, error: { code: 'rate_limited' } });
  });

  it('treats an empty or unreadable relay as unavailable, and shows the saved copy', async () => {
    const kv = memoryKv();
    const client = interim(kv);
    net.answer(yahoo);
    await client.quote('AAPL', '1d');
    for (const handler of [() => proxied(null), () => proxied('not json'), () => json({ nope: true })] satisfies Handler[]) {
      net.answer(handler);
      expect(await settle(interim().quote('AAPL', '1d'))).toEqual({ ok: false, error: { code: 'upstream_unavailable' } });
      expect(await settle(client.quote('AAPL', '1d', { force: true }))).toMatchObject({ ok: true, freshness: 'saved', reason: 'upstream_unavailable' });
    }
  });

  it('searches the known names, with no request', async () => {
    expect(await interim().search('commonwealth bank')).toMatchObject({ ok: true, from: 'local', hits: [{ symbol: 'CBA.AX' }] });
    expect(net.calls).toEqual([]);
  });
});
