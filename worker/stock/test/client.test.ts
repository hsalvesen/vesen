// The contract between the Worker and the app, run end to end in-process: the Worker's handler,
// over the recorded upstreams, answers the app's own market client (src/services/market/client.ts),
// which reads every answer through the contract's guards. Either side changing shape breaks it.
// It also pins that the Worker normalises with the app's code, so the interim source and the
// Worker read Yahoo the same way.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMarketClient } from '../../../src/services/market/client';
import * as shared from '../../../src/services/market/normalise';
import { downsample } from '../src/downsample';
import { handle } from '../src/handler';
import { chartUrl, normaliseYahooChart } from '../src/providers/yahoo';
import { isRecord, num, text } from '../src/providers/types';
import { testWorker } from './support/worker';

afterEach(() => vi.unstubAllGlobals());

/** fetch answered by the Worker's handler for a page on `origin`. */
function serveWorker(origin = 'https://www.vesen.app'): void {
  const { deps } = testWorker();
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return handle(new Request(url, { headers: { Origin: origin, 'CF-Connecting-IP': '203.0.113.7' } }), deps);
  });
}

const client = () => createMarketClient({ baseUrl: 'https://vesen-stock.example.workers.dev', storage: null, online: () => true });

describe("the app's client against the Worker", () => {
  it('reads a quote, a resolved name, a ticker that does not exist and a search', async () => {
    serveWorker();
    const market = client();
    expect(market.backend).toBe('worker');

    const aapl = await market.quote('AAPL', '1d');
    expect(aapl).toMatchObject({ ok: true, freshness: 'live', via: 'worker', quote: { symbol: 'AAPL', price: 332.89, currency: 'USD', source: 'yahoo', resolvedFrom: null } });

    const cba = await market.quote('CBA', '1d');
    expect(cba).toMatchObject({ ok: true, quote: { symbol: 'CBA.AX', resolvedFrom: 'CBA' } });

    const week = await market.quote('AAPL', '5d');
    expect(week).toMatchObject({ ok: true, quote: { series: { range: '5d' } } });

    expect(await market.quote('ZZZZQQ', '1d')).toMatchObject({ ok: false, error: { code: 'not_found' } });

    const found = await market.search('commonwealth bank');
    expect(found).toMatchObject({ ok: true, from: 'worker' });
    if (found.ok === true) expect(found.hits[0]?.symbol).toBe('CBA.AX');
  });

  it('reads the refusal a copy of vesen on another domain gets', async () => {
    serveWorker('https://evil.example');
    expect(await client().quote('AAPL', '1d')).toEqual({ ok: false, error: { code: 'origin_not_allowed' } });
  });
});

describe('one normaliser', () => {
  it('is the same code in the Worker and the app', () => {
    expect(normaliseYahooChart).toBe(shared.normaliseYahooChart);
    expect(chartUrl).toBe(shared.chartUrl);
    expect(downsample).toBe(shared.downsample);
    expect([isRecord, num, text]).toEqual([shared.isRecord, shared.num, shared.text]);
  });
});
