import { describe, expect, it } from 'vitest';
import { isQuoteEnvelope } from '../src/contract';
import { cboeProvider, cboeSymbol, normaliseCboeQuote } from '../src/providers/cboe';
import { finnhubProvider, normaliseFinnhubQuote } from '../src/providers/finnhub';
import type { ProviderContext } from '../src/providers/types';
import { fakeUpstream, fixtureJson } from './support/fixtures';

const RECORDED_AT = 1_791_257_400;

function context(finnhubKey: string | null = null): { ctx: ProviderContext; upstream: ReturnType<typeof fakeUpstream> } {
  const upstream = fakeUpstream();
  return {
    upstream,
    ctx: {
      fetch: upstream.fetch,
      now: () => RECORDED_AT * 1000,
      deadline: RECORDED_AT * 1000 + 6500,
      userAgent: 'Mozilla/5.0 (compatible; vesen-stock/1.0; +https://www.vesen.app)',
      metrics: { upstreamMs: 0, calls: 0 },
      cooldowns: new Map(),
      finnhubKey,
    },
  };
}

describe('Cboe', () => {
  it('covers US listings and the indices it publishes', () => {
    expect(cboeSymbol('AAPL')).toBe('AAPL');
    expect(cboeSymbol('BRK-B')).toBe('BRK.B');
    expect(cboeSymbol('^GSPC')).toBe('_SPX');
    expect(cboeSymbol('CBA.AX')).toBeNull();
    expect(cboeSymbol('BTC-USD')).toBeNull();
    expect(cboeSymbol('AUDUSD=X')).toBeNull();
    expect(cboeSymbol('^AXJO')).toBeNull();
  });

  it('reads a delayed quote with the official open and no name or 52-week range', () => {
    const result = normaliseCboeQuote(fixtureJson('cboe-quote-aapl.json'), 'AAPL', RECORDED_AT);
    if (!result.ok) throw new Error(result.detail);
    expect(isQuoteEnvelope(result.quote)).toBe(true);
    expect(result.quote).toMatchObject({
      symbol: 'AAPL',
      price: 332.85,
      change: -0.8,
      changePercent: -0.2397,
      previousClose: 333.69,
      open: 332.96,
      openApprox: false,
      dayHigh: 336.21,
      dayLow: 331.65,
      volume: 34_400_850,
      name: null,
      fiftyTwoWeekHigh: null,
      currency: 'USD',
      source: 'cboe',
      delayed: true,
      series: null,
      // 2026-10-05 15:59:59 in New York is 19:59:59 UTC.
      asOf: 1_791_230_399,
    });
    expect(result.quote.market).toMatchObject({ phase: 'unknown', timezone: 'America/New_York', tzAbbr: 'EDT' });
  });

  it("derives an index's previous close from its change when Cboe repeats the price", () => {
    const result = normaliseCboeQuote(fixtureJson('cboe-quote-spx.json'), '^GSPC', RECORDED_AT);
    expect(result).toMatchObject({ ok: true, quote: { symbol: '^GSPC', type: 'INDEX', previousClose: 7722.72, volume: null } });
  });

  it('answers unavailable, not not_found, to a 403 for a symbol it does not cover', async () => {
    const { ctx, upstream } = context();
    expect(await cboeProvider.quote('ZZZZ', '1d', ctx)).toMatchObject({ ok: false, kind: 'unavailable' });
    expect(upstream.calls).toEqual(['https://cdn-api.cboe.com/api/global/delayed_quotes/quotes/ZZZZ.json']);
    expect(normaliseCboeQuote({ data: {} }, 'AAPL', RECORDED_AT)).toMatchObject({ ok: false, kind: 'unavailable' });
  });
});

describe('Finnhub', () => {
  it('is skipped without a key and sends the key in a header, not the URL', async () => {
    const none = context();
    expect(await finnhubProvider.quote('AAPL', '1d', none.ctx)).toMatchObject({ ok: false, kind: 'unavailable' });
    expect(none.upstream.calls).toEqual([]);

    const keyed = context('test-key');
    // The recorded answer to a missing or wrong key is 401.
    expect(await finnhubProvider.quote('AAPL', '1d', keyed.ctx)).toMatchObject({ ok: false, kind: 'unavailable' });
    expect(keyed.upstream.calls).toEqual(['https://finnhub.io/api/v1/quote?symbol=AAPL']);
    expect(keyed.upstream.headers[0]?.['x-finnhub-token']).toBe('test-key');
  });

  it("normalises Finnhub's documented quote shape and rejects its all-zero unknown-symbol answer", () => {
    // Constructed from Finnhub's published /quote schema: no free key was available to record one.
    const body = { c: 332.89, d: -0.8, dp: -0.2397, h: 336.19, l: 331.65, o: 332.96, pc: 333.69, t: 1_791_230_400 };
    const result = normaliseFinnhubQuote(body, 'AAPL', RECORDED_AT);
    expect(result).toMatchObject({ ok: true, quote: { price: 332.89, previousClose: 333.69, open: 332.96, source: 'finnhub', asOf: 1_791_230_400 } });
    expect(result.ok && isQuoteEnvelope(result.quote)).toBe(true);
    expect(normaliseFinnhubQuote({ c: 0, d: null, dp: null, h: 0, l: 0, o: 0, pc: 0, t: 0 }, 'ZZZZ', RECORDED_AT)).toMatchObject({
      ok: false,
    });
  });
});
