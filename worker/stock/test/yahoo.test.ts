import { describe, expect, it } from 'vitest';
import { MAX_SERIES_POINTS, isQuoteEnvelope, type QuoteEnvelope, type Range } from '../src/contract';
import { chartUrl, normaliseYahooChart } from '../src/providers/yahoo';
import { chartFixture, fixture, fixtureJson } from './support/fixtures';

/** 2026-10-06 03:30 UTC, when the fixtures were recorded. */
const RECORDED_AT = 1_791_257_400;

function normalise(symbol: string, range: Range = '1d', raw: unknown = fixtureJson(chartFixture(symbol, range))): QuoteEnvelope {
  const result = normaliseYahooChart(raw, symbol, range, RECORDED_AT);
  if (!result.ok) throw new Error(result.detail);
  expect(isQuoteEnvelope(result.quote)).toBe(true);
  return result.quote;
}

/** A recorded chart with some meta fields removed. */
function withoutMeta(symbol: string, keys: readonly string[]): unknown {
  const raw = fixtureJson(chartFixture(symbol)) as { chart: { result: Array<{ meta: Record<string, unknown> }> } };
  const meta = raw.chart.result[0]?.meta ?? {};
  for (const key of keys) delete meta[key];
  return raw;
}

describe('chartUrl', () => {
  it('encodes the symbol and asks for the range interval without extended hours', () => {
    expect(chartUrl('query1.finance.yahoo.com', '^AXJO', '1d')).toBe(
      'https://query1.finance.yahoo.com/v8/finance/chart/%5EAXJO?range=1d&interval=5m&includePrePost=false',
    );
    expect(chartUrl('query2.finance.yahoo.com', 'AUDUSD=X', '5y')).toContain('/AUDUSD%3DX?range=5y&interval=1wk');
  });
});

describe('normaliseYahooChart', () => {
  it('reads a US stock: price, change from the previous close, first-bar open, session window', () => {
    const quote = normalise('AAPL');
    expect(quote).toMatchObject({
      symbol: 'AAPL',
      name: 'Apple Inc.',
      type: 'EQUITY',
      exchange: 'NasdaqGS',
      currency: 'USD',
      priceHint: 2,
      price: 332.89,
      previousClose: 333.69,
      change: -0.8,
      changePercent: -0.2397,
      changeBasis: 'previous_close',
      open: 332.795,
      openApprox: true,
      dayHigh: 336.19,
      dayLow: 331.65,
      fiftyTwoWeekHigh: 345.34,
      fiftyTwoWeekLow: 243.42,
      volume: 34_328_912,
      source: 'yahoo',
      provider: 'yahoo',
      asOf: 1_791_230_402,
      fetchedAt: RECORDED_AT,
      stale: false,
      resolvedFrom: null,
    });
    expect(quote.market).toMatchObject({ phase: 'closed', timezone: 'America/New_York', tzAbbr: 'EDT' });
    // The 1d x-axis is the regular session, 09:30 to 16:00 EDT.
    expect(quote.series).toMatchObject({ range: '1d', interval: '5m', start: 1_791_207_000, end: 1_791_230_400, baseline: 333.69 });
    // Closes are rounded to two places past the price hint.
    expect(quote.series?.points[0]).toEqual([0, 336.0736]);
    expect(quote.series?.points).toHaveLength(79);
  });

  it('reads an ASX stock in Australian dollars while the market is open', () => {
    const quote = normalise('CBA.AX');
    expect(quote).toMatchObject({ currency: 'AUD', exchange: 'ASX', name: 'Commonwealth Bank of Australia', price: 152.09 });
    expect(quote.market).toMatchObject({ phase: 'open', timezone: 'Australia/Sydney', tzAbbr: 'AEDT', closesAt: 1_791_263_520 });
    // The window comes from tradingPeriods, which matches the bars.
    expect(quote.series?.start).toBe(1_791_241_200);
    expect(quote.series?.end).toBe(1_791_263_520);
  });

  it('measures crypto over 24 hours, as Yahoo does', () => {
    const quote = normalise('BTC-USD');
    expect(quote).toMatchObject({ type: 'CRYPTOCURRENCY', changeBasis: '24h', changePercent: -0.698, change: -600.891 });
    expect(quote.market.phase).toBe('always_open');
  });

  it('keeps four decimals for FX and treats volume 0 as missing', () => {
    const quote = normalise('AUDUSD=X');
    expect(quote).toMatchObject({ type: 'CURRENCY', priceHint: 4, price: 0.6978, volume: null, currency: 'USD' });
    for (const [, close] of quote.series?.points ?? []) expect(String(close).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(6);
  });

  it('reads an index with no volume', () => {
    expect(normalise('^AXJO')).toMatchObject({ type: 'INDEX', volume: null, currency: 'AUD', name: 'S&P/ASX 200 [XJO]' });
  });

  it('uses the previous close, not the close before the range, for 5d', () => {
    const quote = normalise('AAPL', '5d');
    expect(quote.previousClose).toBe(333.69);
    expect(quote.change).toBe(-0.8);
    expect(quote.series?.points).toHaveLength(MAX_SERIES_POINTS);
    expect(quote.series?.interval).toBe('15m');
    // The 5d chart compares against its own first close and spans the bars.
    expect(quote.series?.baseline).not.toBe(333.69);
    expect(quote.series?.points[0]?.[0]).toBe(0);
    expect(quote.series?.end).toBeGreaterThan(quote.series?.start ?? 0);
    // Open is the first bar of the last session, not of the whole range.
    expect(quote.open).toBe(332.795);
  });

  it('keeps every 1d body for the curated symbols under 4 KB', () => {
    for (const symbol of ['AAPL', 'TEAM', 'CBA.AX', 'BHP.AX', '^AXJO', '^GSPC', 'BTC-USD', 'AUDUSD=X', 'MSFT', 'NVDA']) {
      const quote = normalise(symbol);
      expect(quote.series?.points.length ?? 0, symbol).toBeLessThanOrEqual(MAX_SERIES_POINTS);
      expect(new TextEncoder().encode(JSON.stringify(quote)).length, symbol).toBeLessThan(4096);
    }
  });

  it('turns missing fields into null, never 0', () => {
    const quote = normalise(
      'AAPL',
      '1d',
      withoutMeta('AAPL', [
        'previousClose',
        'chartPreviousClose',
        'regularMarketVolume',
        'regularMarketDayHigh',
        'regularMarketDayLow',
        'fiftyTwoWeekHigh',
        'fiftyTwoWeekLow',
        'longName',
        'shortName',
        'currency',
        'exchangeTimezoneName',
        'currentTradingPeriod',
        'priceHint',
      ]),
    );
    expect(quote).toMatchObject({
      previousClose: null,
      change: null,
      changePercent: null,
      volume: null,
      dayHigh: null,
      dayLow: null,
      fiftyTwoWeekHigh: null,
      fiftyTwoWeekLow: null,
      name: null,
      currency: null,
      priceHint: 2,
    });
    expect(quote.market).toMatchObject({ phase: 'unknown', timezone: null, periods: null });
    expect(quote.series?.baseline).toBeNull();
  });

  it('falls back to the last close when the meta has no price', () => {
    const quote = normalise('AAPL', '1d', withoutMeta('AAPL', ['regularMarketPrice']));
    expect(quote.price).toBe(332.89);
  });

  it('chartPreviousClose stands in for a missing previousClose on 1d only', () => {
    expect(normalise('AAPL', '1d', withoutMeta('AAPL', ['previousClose'])).previousClose).toBe(333.69);
    const fiveDays = fixtureJson(chartFixture('AAPL', '5d')) as { chart: { result: Array<{ meta: Record<string, unknown> }> } };
    delete fiveDays.chart.result[0]?.meta.previousClose;
    expect(normalise('AAPL', '5d', fiveDays).previousClose).toBeNull();
  });

  it("is not_found only for Yahoo's own Not Found body", () => {
    expect(normaliseYahooChart(fixtureJson('yahoo-chart-zzzzqq-404.json'), 'ZZZZQQ', '1d', RECORDED_AT)).toMatchObject({
      ok: false,
      kind: 'not_found',
    });
    for (const raw of [undefined, {}, { chart: {} }, { chart: { result: [] } }, { chart: { result: [{ meta: {} }] } }, fixture('yahoo-chart-429.txt')]) {
      expect(normaliseYahooChart(raw, 'AAPL', '1d', RECORDED_AT)).toMatchObject({ ok: false, kind: 'unavailable' });
    }
  });

  it('cleans display text from the upstream', () => {
    const raw = withoutMeta('AAPL', ['longName']) as { chart: { result: Array<{ meta: Record<string, unknown> }> } };
    const meta = raw.chart.result[0]?.meta ?? {};
    meta.shortName = 'Apple\u0000\n Inc.‮';
    meta.currency = '<b>';
    expect(normalise('AAPL', '1d', raw)).toMatchObject({ name: 'Apple Inc.', currency: null });
  });
});
