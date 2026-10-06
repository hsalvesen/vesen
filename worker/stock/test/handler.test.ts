// The handler end to end: real routing, caching and providers, with fetch answered from the
// recorded fixtures and time controlled by fake timers.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CURATED_SYMBOLS,
  isErrorEnvelope,
  isQuoteEnvelope,
  isSearchEnvelope,
  isSnapshotEnvelope,
  type ErrorEnvelope,
  type HealthEnvelope,
  type QuoteEnvelope,
  type SearchEnvelope,
  type SnapshotEnvelope,
} from '../src/contract';
import { DEFAULT_USER_AGENT } from '../src/config';
import { handle } from '../src/handler';
import { refreshSnapshot } from '../src/snapshot';
import { chartFixture, fixture, hang, isYahooChart } from './support/fixtures';
import { VESEN, kvStore, request, testWorker, type TestWorker } from './support/worker';

/** 2026-10-06 03:30 UTC: the ASX is open, New York is closed. */
const RECORDED_AT_MS = 1_791_257_400_000;

const UPSTREAM_HOSTS = new Set(['query1.finance.yahoo.com', 'query2.finance.yahoo.com', 'cdn-api.cboe.com', 'finnhub.io']);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(RECORDED_AT_MS);
});

afterEach(() => {
  vi.useRealTimers();
});

async function call(worker: TestWorker, path: string, options?: Parameters<typeof request>[1]): Promise<Response> {
  return handle(request(path, options), worker.deps);
}

async function body<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

const serverError = (): Response => new Response('upstream error', { status: 500 });
const yahooDown = (url: URL): Response | undefined => (isYahooChart(url) ? serverError() : undefined);
const everythingDown = (): Response => serverError();

describe('GET /v1/quote', () => {
  it('serves AAPL to vesen.app with CORS, cache and timing headers', async () => {
    const worker = testWorker();
    const response = await call(worker, '/v1/quote?symbol=aapl');
    expect(response.status).toBe(200);
    expect(Object.fromEntries(response.headers)).toMatchObject({
      'access-control-allow-origin': VESEN,
      vary: 'Origin',
      'access-control-expose-headers': 'Retry-After, X-Vesen-Cache, X-Vesen-Source',
      'cache-control': 'public, max-age=15',
      'content-type': 'application/json; charset=utf-8',
      'x-vesen-cache': 'miss',
      'x-vesen-source': 'yahoo',
    });
    expect(response.headers.get('server-timing')).toMatch(/^cache;desc="miss", upstream;dur=\d+, total;dur=\d+$/);

    const text = await response.text();
    expect(new TextEncoder().encode(text).length).toBeLessThan(4096);
    const quote = JSON.parse(text) as QuoteEnvelope;
    expect(isQuoteEnvelope(quote)).toBe(true);
    expect(quote).toMatchObject({ symbol: 'AAPL', price: 332.89, source: 'yahoo', stale: false, resolvedFrom: null });
    expect(worker.upstream.calls).toEqual([
      'https://query1.finance.yahoo.com/v8/finance/chart/AAPL?range=1d&interval=5m&includePrePost=false',
    ]);
    expect(worker.upstream.headers[0]?.['user-agent']).toBe(DEFAULT_USER_AGENT);

    const again = await call(worker, '/v1/quote?symbol=AAPL');
    expect(again.headers.get('x-vesen-cache')).toBe('hit');
    expect(again.headers.get('server-timing')).not.toContain('upstream');
    expect(worker.upstream.calls).toHaveLength(1);
  });

  it('keeps ranges apart in the cache', async () => {
    const worker = testWorker();
    const fiveDays = await body<QuoteEnvelope>(await call(worker, '/v1/quote?symbol=AAPL&range=5d'));
    expect(fiveDays.series).toMatchObject({ range: '5d', interval: '15m' });
    await call(worker, '/v1/quote?symbol=AAPL');
    expect(worker.upstream.calls).toHaveLength(2);
  });

  it('makes one upstream call for concurrent requests for the same symbol', async () => {
    const worker = testWorker();
    const responses = await Promise.all([1, 2, 3].map(() => call(worker, '/v1/quote?symbol=TEAM')));
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(worker.upstream.calls).toHaveLength(1);
  });

  it('rejects invalid symbols and ranges before any upstream call', async () => {
    const worker = testWorker();
    for (const symbol of ['AP PL!', '<img src=x onerror=alert(1)>', '../x', '%2F', '', 'ABCDEFGHIJKLMNOP', 'A..B']) {
      const response = await call(worker, `/v1/quote?symbol=${encodeURIComponent(symbol)}`);
      expect(response.status, symbol).toBe(400);
      const error = await body<ErrorEnvelope>(response);
      expect(isErrorEnvelope(error)).toBe(true);
      expect(error.error.code).toBe('invalid_symbol');
      expect(error.error.message.length).toBeLessThan(140);
    }
    const missing = await call(worker, '/v1/quote');
    expect((await body<ErrorEnvelope>(missing)).error.code).toBe('invalid_symbol');
    const range = await call(worker, '/v1/quote?symbol=AAPL&range=3mo');
    expect(range.status).toBe(400);
    expect((await body<ErrorEnvelope>(range)).error).toMatchObject({ code: 'bad_request' });
    expect(range.headers.get('cache-control')).toBe('no-store');
    expect(worker.upstream.calls).toEqual([]);
  });

  it('resolves a bare ASX code and remembers the resolution', async () => {
    const worker = testWorker();
    const quote = await body<QuoteEnvelope>(await call(worker, '/v1/quote?symbol=CBA'));
    expect(quote).toMatchObject({ symbol: 'CBA.AX', resolvedFrom: 'CBA', currency: 'AUD' });
    expect(worker.upstream.calls.map((c) => new URL(c).pathname)).toEqual([
      '/v8/finance/chart/CBA',
      '/v1/finance/search',
      '/v8/finance/chart/CBA.AX',
    ]);

    const again = await call(worker, '/v1/quote?symbol=cba');
    expect(again.headers.get('x-vesen-cache')).toBe('hit');
    expect((await body<QuoteEnvelope>(again)).resolvedFrom).toBe('CBA');
    expect(worker.upstream.calls).toHaveLength(3);
  });

  it('resolves a company name to the ticker that dominates the search', async () => {
    const worker = testWorker();
    expect(await body<QuoteEnvelope>(await call(worker, '/v1/quote?symbol=apple'))).toMatchObject({ symbol: 'AAPL', resolvedFrom: 'APPLE' });
  });

  it('resolves an alias without searching', async () => {
    const worker = testWorker();
    expect(await body<QuoteEnvelope>(await call(worker, '/v1/quote?symbol=sp500'))).toMatchObject({ symbol: '^GSPC', resolvedFrom: 'SP500' });
    expect(worker.upstream.calls.some((c) => c.includes('/search'))).toBe(false);
  });

  it('answers an unknown ticker with not_found and remembers it for ten minutes', async () => {
    const worker = testWorker();
    const response = await call(worker, '/v1/quote?symbol=ZZZZQQ');
    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('public, max-age=15');
    expect(await body<ErrorEnvelope>(response)).toEqual({
      v: 1,
      kind: 'error',
      error: { code: 'not_found', message: "No market data for 'ZZZZQQ'.", suggestions: [] },
    });
    const calls = worker.upstream.calls.length;
    expect((await call(worker, '/v1/quote?symbol=ZZZZQQ')).status).toBe(404);
    expect(worker.upstream.calls).toHaveLength(calls);
    vi.advanceTimersByTime(10 * 60_000);
    await call(worker, '/v1/quote?symbol=ZZZZQQ');
    expect(worker.upstream.calls.length).toBeGreaterThan(calls);
  });

  it('falls back from Yahoo to Cboe for US symbols, then leaves Yahoo alone for a minute', async () => {
    const worker = testWorker();
    worker.upstream.use((url) => (isYahooChart(url) ? new Response(fixture('yahoo-chart-429.txt'), { status: 429 }) : undefined));

    const response = await call(worker, '/v1/quote?symbol=AAPL');
    expect(response.headers.get('x-vesen-source')).toBe('cboe');
    expect(await body<QuoteEnvelope>(response)).toMatchObject({ source: 'cboe', provider: 'cboe', delayed: true, price: 332.85 });
    expect(worker.upstream.calls.map((c) => new URL(c).hostname)).toEqual([
      'query1.finance.yahoo.com',
      'query2.finance.yahoo.com',
      'cdn-api.cboe.com',
    ]);

    // Both Yahoo hosts are cooling down, so the next request goes straight to Cboe.
    await call(worker, '/v1/quote?symbol=AAPL&range=5d');
    expect(worker.upstream.calls.slice(3).map((c) => new URL(c).hostname)).toEqual(['cdn-api.cboe.com']);

    vi.advanceTimersByTime(61_000);
    await call(worker, '/v1/quote?symbol=AAPL&range=1mo');
    expect(new URL(worker.upstream.calls[4] ?? '').hostname).toBe('query1.finance.yahoo.com');
  });

  it('serves a stale copy for up to a day when every source fails, then gives up', async () => {
    const worker = testWorker();
    // WBC.AX is not curated, so no snapshot stands behind it; the CBA.AX recording stands in.
    worker.upstream.use((url) => (url.pathname.endsWith('/WBC.AX') ? new Response(fixture(chartFixture('CBA.AX'))) : undefined));
    expect((await call(worker, '/v1/quote?symbol=WBC.AX')).status).toBe(200);

    worker.upstream.use(everythingDown);
    vi.advanceTimersByTime(2 * 60_000);
    const stale = await call(worker, '/v1/quote?symbol=WBC.AX');
    expect(stale.status).toBe(200);
    expect(stale.headers.get('x-vesen-cache')).toBe('stale');
    expect(await body<QuoteEnvelope>(stale)).toMatchObject({ symbol: 'WBC.AX', stale: true, staleReason: 'upstream_unavailable' });

    vi.advanceTimersByTime(24 * 60 * 60_000);
    const gone = await call(worker, '/v1/quote?symbol=WBC.AX');
    expect(gone.status).toBe(503);
    expect(gone.headers.get('retry-after')).toBe('30');
    expect(await body<ErrorEnvelope>(gone)).toMatchObject({ error: { code: 'upstream_unavailable', retryAfter: 30 } });
  });

  it('says the stale copy is due to rate limiting when the upstream said 429', async () => {
    const worker = testWorker();
    worker.upstream.use((url) => (url.pathname.endsWith('/WBC.AX') ? new Response(fixture(chartFixture('CBA.AX'))) : undefined));
    await call(worker, '/v1/quote?symbol=WBC.AX');
    worker.upstream.use(() => new Response('', { status: 429 }));
    vi.advanceTimersByTime(2 * 60_000);
    expect(await body<QuoteEnvelope>(await call(worker, '/v1/quote?symbol=WBC.AX'))).toMatchObject({ staleReason: 'rate_limited' });
  });

  it('recomputes the market phase on a stale copy', async () => {
    const worker = testWorker();
    await call(worker, '/v1/quote?symbol=CBA.AX');
    worker.upstream.use(everythingDown);
    // Seven hours later the ASX session has closed.
    vi.advanceTimersByTime(7 * 60 * 60_000);
    const quote = await body<QuoteEnvelope>(await call(worker, '/v1/quote?symbol=CBA.AX'));
    expect(quote.stale).toBe(true);
    expect(quote.market.phase).toBe('closed');
  });

  it('falls back to the snapshot for a curated symbol with nothing cached', async () => {
    const worker = testWorker();
    worker.upstream.use(everythingDown);
    const response = await call(worker, '/v1/quote?symbol=CBA.AX');
    expect(response.status).toBe(200);
    expect(response.headers.get('x-vesen-source')).toBe('snapshot');
    expect(await body<QuoteEnvelope>(response)).toMatchObject({
      symbol: 'CBA.AX',
      source: 'snapshot',
      provider: 'yahoo',
      stale: true,
      staleReason: 'snapshot_builtin',
    });
  });

  it('prefers the stored snapshot, series included, over the built-in one', async () => {
    const { kv, store } = kvStore();
    const worker = testWorker({ snapshots: store });
    await refreshSnapshot(worker.deps, store);
    expect(kv.writes).toBe(1);

    const fresh = testWorker({ snapshots: store });
    fresh.upstream.use(everythingDown);
    const quote = await body<QuoteEnvelope>(await call(fresh, '/v1/quote?symbol=BHP.AX'));
    expect(quote).toMatchObject({ source: 'snapshot', staleReason: 'upstream_unavailable' });
    expect(quote.series?.range).toBe('1d');
    const fiveDays = await body<QuoteEnvelope>(await call(fresh, '/v1/quote?symbol=BHP.AX&range=5d'));
    expect(fiveDays.series).toBeNull();
  });

  it('stops trying within the request budget when an upstream hangs', async () => {
    const worker = testWorker();
    worker.upstream.use((url, init) => (isYahooChart(url) ? hang(url, init) : undefined));
    const pending = call(worker, '/v1/quote?symbol=AAPL');
    // query1 gets 3 s and query2 2.5 s; Cboe then answers within what is left.
    await vi.advanceTimersByTimeAsync(5500);
    const response = await pending;
    expect(response.status).toBe(200);
    expect(response.headers.get('x-vesen-source')).toBe('cboe');

    const nothing = testWorker();
    nothing.upstream.use(hang);
    const stuck = call(nothing, '/v1/quote?symbol=WBC.AX');
    await vi.advanceTimersByTimeAsync(6500);
    expect((await stuck).status).toBe(503);
  });
});

describe('origins and limits', () => {
  it('refuses other origins with 403 and makes no upstream call', async () => {
    const worker = testWorker();
    for (const path of ['/v1/quote?symbol=AAPL', '/v1/search?q=apple', '/v1/snapshot', '/v1/health']) {
      const response = await call(worker, path, { origin: 'https://evil.example' });
      expect(response.status, path).toBe(403);
      // Echoed, so a copy of vesen elsewhere can read why.
      expect(response.headers.get('access-control-allow-origin')).toBe('https://evil.example');
      expect(response.headers.get('vary')).toBe('Origin');
      expect((await body<ErrorEnvelope>(response)).error.code).toBe('origin_not_allowed');
    }
    const preflight = await call(worker, '/v1/quote', { origin: 'https://vesen.app.evil.com', method: 'OPTIONS' });
    expect(preflight.status).toBe(403);
    expect(worker.upstream.calls).toEqual([]);
  });

  it('answers a preflight from an allowed origin', async () => {
    const response = await call(testWorker(), '/v1/quote', { origin: 'http://localhost:3000', method: 'OPTIONS' });
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
    expect(response.headers.get('access-control-allow-methods')).toBe('GET, OPTIONS');
  });

  it('answers the 31st rapid request from one address with 429 and Retry-After', async () => {
    const worker = testWorker();
    for (let i = 0; i < 30; i += 1) expect((await call(worker, '/v1/quote?symbol=AAPL')).status).toBe(200);
    const limited = await call(worker, '/v1/quote?symbol=AAPL');
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('2');
    expect(limited.headers.get('access-control-allow-origin')).toBe(VESEN);
    expect(await body<ErrorEnvelope>(limited)).toMatchObject({ error: { code: 'rate_limited', retryAfter: 2 } });
    // Another address has its own bucket.
    expect((await call(worker, '/v1/quote?symbol=AAPL', { ip: '198.51.100.1' })).status).toBe(200);
  });

  it('counts every address in an IPv6 /64 against one bucket', async () => {
    const worker = testWorker();
    for (let i = 0; i < 30; i += 1) {
      const ip = `2001:db8:1:2::${(i + 1).toString(16)}`;
      expect((await call(worker, '/v1/quote?symbol=AAPL', { ip })).status).toBe(200);
    }
    expect((await call(worker, '/v1/quote?symbol=AAPL', { ip: '2001:db8:1:2:ffff::99' })).status).toBe(429);
    // The next /64 is someone else.
    expect((await call(worker, '/v1/quote?symbol=AAPL', { ip: '2001:db8:1:3::1' })).status).toBe(200);
  });

  it('serves requests with no Origin under a tighter limit and without CORS headers', async () => {
    const worker = testWorker();
    for (let i = 0; i < 10; i += 1) {
      const response = await call(worker, '/v1/quote?symbol=AAPL', { origin: null });
      expect(response.status).toBe(200);
      expect(response.headers.get('access-control-allow-origin')).toBeNull();
    }
    expect((await call(worker, '/v1/search?q=apple', { origin: null })).status).toBe(429);
  });

  it('rejects other methods and unknown paths', async () => {
    const worker = testWorker();
    const post = await call(worker, '/v1/quote?symbol=AAPL', { method: 'POST' });
    expect(post.status).toBe(405);
    expect(post.headers.get('allow')).toBe('GET, OPTIONS');
    const unknown = await call(worker, '/v1/fetch?url=https://example.com');
    expect(unknown.status).toBe(404);
    expect((await body<ErrorEnvelope>(unknown)).error.code).toBe('bad_request');
    expect(worker.upstream.calls).toEqual([]);
  });

  it('turns an unexpected exception into a 500 with no detail', async () => {
    const worker = testWorker();
    vi.spyOn(worker.deps.state.limits.quote, 'take').mockImplementation(() => {
      throw new Error('secret detail');
    });
    const response = await call(worker, '/v1/quote?symbol=AAPL');
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).not.toContain('secret');
    expect(isErrorEnvelope(JSON.parse(text))).toBe(true);
  });

  it('only ever calls the fixed upstream hosts', async () => {
    const worker = testWorker({ env: { FINNHUB_KEY: 'test-key' } });
    worker.upstream.use(yahooDown);
    for (const path of ['/v1/quote?symbol=AAPL', '/v1/quote?symbol=^AXJO', '/v1/quote?symbol=ZZZZ', '/v1/search?q=apple']) {
      await call(worker, path);
    }
    expect(worker.upstream.hosts().size).toBeGreaterThan(2);
    for (const host of worker.upstream.hosts()) expect(UPSTREAM_HOSTS.has(host), host).toBe(true);
  });
});

describe('GET /v1/search', () => {
  it('returns filtered hits for a company name', async () => {
    const worker = testWorker();
    const response = await call(worker, '/v1/search?q=%20apple%20');
    expect(response.headers.get('x-vesen-cache')).toBe('miss');
    const result = await body<SearchEnvelope>(response);
    expect(isSearchEnvelope(result)).toBe(true);
    expect(result.query).toBe('apple');
    expect(result.hits.map((h) => h.symbol)).toEqual(['AAPL', 'APLE', 'AAPL.TO', 'APC.DE']);
    expect(Object.keys(result.hits[0] ?? {})).toEqual(['symbol', 'name', 'exchange', 'type']);

    const limited = await body<SearchEnvelope>(await call(worker, '/v1/search?q=Apple&limit=2'));
    expect(limited.hits).toHaveLength(2);
    expect(worker.upstream.calls).toHaveLength(1);
  });

  it('validates the query and the limit', async () => {
    const worker = testWorker();
    for (const query of ['', '%20', 'x'.repeat(41)]) {
      expect((await call(worker, `/v1/search?q=${query}`)).status).toBe(400);
    }
    expect((await call(worker, '/v1/search?q=apple&limit=11')).status).toBe(400);
    expect((await call(worker, '/v1/search?q=apple&limit=two')).status).toBe(400);
    expect(worker.upstream.calls).toEqual([]);
  });

  it('allows 20 searches a minute per address', async () => {
    const worker = testWorker();
    for (let i = 0; i < 20; i += 1) expect((await call(worker, `/v1/search?q=apple`)).status).toBe(200);
    expect((await call(worker, '/v1/search?q=apple')).status).toBe(429);
  });

  it('is unavailable, not empty, when the search upstream fails', async () => {
    const worker = testWorker();
    worker.upstream.use(everythingDown);
    const response = await call(worker, '/v1/search?q=apple');
    expect(response.status).toBe(503);
    expect((await body<ErrorEnvelope>(response)).error.code).toBe('upstream_unavailable');
  });
});

describe('GET /v1/snapshot and the scheduled refresh', () => {
  it('answers from the built-in copy, marked stale, when nothing is stored', async () => {
    const response = await call(testWorker(), '/v1/snapshot');
    expect(response.status).toBe(200);
    expect(response.headers.get('x-vesen-cache')).toBe('stale');
    const snapshot = await body<SnapshotEnvelope>(response);
    expect(isSnapshotEnvelope(snapshot)).toBe(true);
    expect(snapshot.quotes.map((q) => q.symbol)).toEqual([...CURATED_SYMBOLS]);
    for (const quote of snapshot.quotes) {
      expect(quote).toMatchObject({ source: 'snapshot', stale: true, staleReason: 'snapshot_builtin', series: null });
    }
  });

  it('writes every curated quote with its series and serves it fresh', async () => {
    const { kv, store } = kvStore();
    const worker = testWorker({ snapshots: store });
    const report = await refreshSnapshot(worker.deps, store);
    expect(report).toEqual({ written: true, refreshed: [...CURATED_SYMBOLS], failed: [] });

    const stored = JSON.parse(kv.data.get('snapshot:v1') ?? 'null') as SnapshotEnvelope;
    expect(isSnapshotEnvelope(stored)).toBe(true);
    expect(stored.quotes.every((q) => q.series !== null && q.source === 'snapshot')).toBe(true);

    const response = await call(testWorker({ snapshots: store }), '/v1/snapshot');
    expect(response.headers.get('x-vesen-cache')).toBe('hit');
    const served = await body<SnapshotEnvelope>(response);
    expect(served.quotes.every((q) => !q.stale && q.series === null)).toBe(true);
    expect(new TextEncoder().encode(JSON.stringify(served)).length).toBeLessThan(16_384);
  });

  it('marks the stored copy outdated after two missed runs', async () => {
    const { store } = kvStore();
    const worker = testWorker({ snapshots: store });
    await refreshSnapshot(worker.deps, store);
    vi.advanceTimersByTime(31 * 60_000);
    const served = await body<SnapshotEnvelope>(await call(testWorker({ snapshots: store }), '/v1/snapshot'));
    expect(served.quotes.every((q) => q.stale && q.staleReason === 'snapshot_outdated')).toBe(true);
  });

  it('keeps the previous copy of symbols that fail and skips the write when nothing is new', async () => {
    const { kv, store } = kvStore();
    await refreshSnapshot(testWorker({ snapshots: store }).deps, store);

    vi.advanceTimersByTime(15 * 60_000);
    const yahooFailing = testWorker({ snapshots: store });
    yahooFailing.upstream.use(yahooDown);
    const partial = await refreshSnapshot(yahooFailing.deps, store);
    // Cboe answers for the symbols it has recordings of; the rest keep their earlier copies.
    expect(partial).toMatchObject({ written: true, refreshed: ['AAPL', '^GSPC'] });
    expect(partial.failed).toEqual(['TEAM', 'CBA.AX', 'BHP.AX', '^AXJO', 'BTC-USD', 'AUDUSD=X', 'MSFT', 'NVDA']);
    const merged = JSON.parse(kv.data.get('snapshot:v1') ?? 'null') as SnapshotEnvelope;
    expect(merged.quotes).toHaveLength(CURATED_SYMBOLS.length);
    expect(merged.quotes.find((q) => q.symbol === 'CBA.AX')?.provider).toBe('yahoo');

    const down = testWorker({ snapshots: store });
    down.upstream.use(everythingDown);
    const writes = kv.writes;
    expect(await refreshSnapshot(down.deps, store)).toMatchObject({ written: false, refreshed: [] });
    expect(kv.writes).toBe(writes);
  });
});

describe('GET /v1/health', () => {
  it('reports the version and providers without calling upstream', async () => {
    const worker = testWorker();
    const response = await call(worker, '/v1/health');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await body<HealthEnvelope>(response)).toEqual({
      v: 1,
      kind: 'health',
      ok: true,
      version: '1.0.0',
      providers: ['yahoo', 'cboe'],
      snapshot: false,
      time: RECORDED_AT_MS / 1000,
    });
    expect(worker.upstream.calls).toEqual([]);
  });
});
