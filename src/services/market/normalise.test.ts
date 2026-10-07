// The chart normaliser is one file shared by the stock Worker and the app's interim source, so a
// quote reads the same whichever served it. These tests run it over every recorded Yahoo chart
// in worker/stock/test/fixtures; the Worker's own tests cover the field-by-field details, and
// worker/stock/test/client.test.ts that the Worker uses this very code.
import { describe, expect, it } from 'vitest';
import { chartFixture, fixture, fixtureJson } from '../../testing/quotes';
import { findBoundaryViolations } from '../../../scripts/check-boundaries.mjs';
import { readFileSync } from 'node:fs';
import { CURATED_SYMBOLS, MAX_SERIES_POINTS, isQuoteEnvelope, type Range } from './contract';
import { readInterim } from './interim';
import { chartUrl, downsample, normaliseYahooChart, num, positive, round, text } from './normalise';

const RECORDED_AT = 1_791_257_400;

/** The proxy's envelope around a recorded Yahoo body. */
const proxied = (contents: string, httpCode = 200): string => JSON.stringify({ contents, status: { http_code: httpCode } });

describe('one normaliser for the Worker and the app', () => {
  it('uses no browser API, so the Worker can bundle it', () => {
    const source = readFileSync(new URL('./normalise.ts', import.meta.url), 'utf8');
    expect(findBoundaryViolations(source, 'src/services/market/normalise.ts')).toEqual([]);
  });

  it.each([...CURATED_SYMBOLS])('reads %s the same through the interim proxy as the Worker does', (symbol) => {
    const body = fixture(chartFixture(symbol));
    const direct = normaliseYahooChart(JSON.parse(body) as unknown, symbol, '1d', RECORDED_AT);
    expect(direct.ok).toBe(true);
    if (direct.ok === false) return;
    expect(isQuoteEnvelope(direct.quote)).toBe(true);
    expect(direct.quote.series?.points.length ?? 0).toBeLessThanOrEqual(MAX_SERIES_POINTS);
    expect(readInterim(200, null, proxied(body), symbol, '1d', RECORDED_AT)).toEqual({ ok: true, quote: direct.quote });
  });

  it('reads a 5-day chart through the proxy as well', () => {
    const body = fixture(chartFixture('AAPL', '5d'));
    const result = readInterim(200, null, proxied(body), 'AAPL', '5d', RECORDED_AT);
    expect(result).toMatchObject({ ok: true, quote: { series: { range: '5d', interval: '15m' } } });
  });

  it("reads Yahoo's 404 as not_found, and anything unreadable as unavailable", () => {
    expect(readInterim(200, null, proxied(fixture('yahoo-chart-zzzzqq-404.json'), 404), 'ZZZZQQ', '1d', RECORDED_AT)).toEqual({
      ok: false,
      failure: { code: 'not_found' },
      fast: false,
    });
    expect(readInterim(200, null, proxied('{"chart":{"result":[{"meta":{}}]}}'), 'AAPL', '1d', RECORDED_AT)).toMatchObject({
      ok: false,
      failure: { code: 'upstream_unavailable' },
    });
    expect(readInterim(429, '7', '', 'AAPL', '1d', RECORDED_AT)).toEqual({ ok: false, failure: { code: 'rate_limited', retryAfter: 7 }, fast: false, retryAfterMs: 7000 });
    expect(readInterim(522, null, 'error code: 522', 'AAPL', '1d', RECORDED_AT)).toEqual({ ok: false, failure: { code: 'upstream_unavailable' }, fast: true });
    expect(readInterim(404, null, 'Not Found', 'AAPL', '1d', RECORDED_AT)).toEqual({ ok: false, failure: { code: 'upstream_unavailable' }, fast: false });
  });

  it('turns hostile or missing values into null, never 0 or text that reorders the page', () => {
    const raw = fixtureJson(chartFixture('AAPL')) as { chart: { result: Array<{ meta: Record<string, unknown> }> } };
    const meta = raw.chart.result[0]?.meta ?? {};
    meta.longName = '<img src=x onerror=alert(1)>‮\u0007 Apple';
    meta.regularMarketVolume = '34328912';
    meta.fiftyTwoWeekHigh = Number.NaN;
    meta.previousClose = null;
    meta.chartPreviousClose = 'x';
    const result = normaliseYahooChart(raw, 'AAPL', '1d' as Range, RECORDED_AT);
    expect(result.ok).toBe(true);
    if (result.ok === false) return;
    // Kept as text (the card escapes it); the override and the bell are gone.
    expect(result.quote.name).toBe('<img src=x onerror=alert(1)> Apple');
    expect(result.quote).toMatchObject({ volume: null, fiftyTwoWeekHigh: null, previousClose: null, change: null, changePercent: null });
  });

  it('has small checked-value helpers', () => {
    expect([num(1), num('1'), num(Number.POSITIVE_INFINITY), num(null)]).toEqual([1, null, null, null]);
    expect([positive(0), positive(-1), positive(2)]).toEqual([null, null, 2]);
    expect([text('  a\n b  '), text(''), text(3), text('abcdef', 3)]).toEqual(['a b', null, null, 'abc']);
    expect(round(1.23456, 2)).toBe(1.23);
    expect(chartUrl('query1.finance.yahoo.com', 'AUDUSD=X', '1y')).toBe(
      'https://query1.finance.yahoo.com/v8/finance/chart/AUDUSD%3DX?range=1y&interval=1d&includePrePost=false',
    );
  });

  it('downsamples to the limit, keeping the ends', () => {
    const points = Array.from({ length: 500 }, (_, i) => [i, Math.sin(i / 10)] as const);
    const sampled = downsample(points, 48);
    expect(sampled).toHaveLength(48);
    expect(sampled[0]).toEqual(points[0]);
    expect(sampled[47]).toEqual(points[499]);
    expect(downsample(points.slice(0, 10), 48)).toHaveLength(10);
  });
});
