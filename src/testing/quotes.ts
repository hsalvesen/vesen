// Quotes for the stock tests: the recorded Yahoo charts (worker/stock/test/fixtures) normalised as
// the Worker serves them, and every state a card or a table row can be in, built from them.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CURATED_SYMBOLS, type QuoteEnvelope, type Range } from '../services/market/contract';
import { normaliseYahooChart } from '../services/market/normalise';
import type { Market, QuoteOutcome, SearchOutcome } from '../services/market/port';

// Read by path rather than by URL, so DOM tests (whose URL is the DOM's) can load them too. The
// Worker's own test helpers are not imported, so the app's type check never reaches its code.
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'worker', 'stock', 'test', 'fixtures');

/** A recorded upstream body, exactly as received. */
export function fixture(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8');
}

export function fixtureJson(name: string): unknown {
  return JSON.parse(fixture(name)) as unknown;
}

/** The recorded chart's file: CBA.AX 1d → yahoo-chart-cba-ax-1d.json, ^AXJO → axjo. */
export function chartFixture(symbol: string, range = '1d'): string {
  return `yahoo-chart-${symbol.toLowerCase().replace(/^\^/, '').replace(/[.=]/g, '-')}-${range}.json`;
}

/** 2026-10-06 03:30 UTC (14:30 in Sydney, the ASX open; New York closed), when they were recorded. */
export const RECORDED_AT_MS = 1_791_257_400_000;

/** The Worker's answer for `symbol`, from its recorded chart. */
export function quoteOf(symbol: string, range: Range = '1d'): QuoteEnvelope {
  const result = normaliseYahooChart(fixtureJson(chartFixture(symbol, range)), symbol, range, RECORDED_AT_MS / 1000);
  if (result.ok === false) throw new Error(`${symbol}: ${result.detail}`);
  return result.quote;
}

/** Every recorded chart: the curated tickers' days, and Apple over five days. */
export function recordedQuotes(): [string, QuoteEnvelope][] {
  return [...CURATED_SYMBOLS.map((symbol): [string, QuoteEnvelope] => [`${symbol} 1d`, quoteOf(symbol)]), ['AAPL 5d', quoteOf('AAPL', '5d')]];
}

export const HOSTILE_NAME = '<img src=x onerror=alert(1)><script>alert(2)</script>';

const live = (quote: QuoteEnvelope, via: 'worker' | 'interim' = 'worker'): QuoteOutcome => ({ ok: true, quote, freshness: 'live', via });

/** Every state a card can be in, with what it was built from. */
export function cardStates(): [string, QuoteOutcome][] {
  const aapl = quoteOf('AAPL');
  const hourAgo = RECORDED_AT_MS - 2 * 60 * 60 * 1000;
  return [
    ['live from the Worker', live(aapl)],
    ['live through the interim proxy', live(aapl, 'interim')],
    ['from memory', { ok: true, quote: aapl, freshness: 'memory', via: 'worker' }],
    ['saved copy after a timeout', { ok: true, quote: aapl, freshness: 'saved', savedAt: hourAgo, reason: 'timeout', via: 'worker' }],
    ['saved copy while offline', { ok: true, quote: aapl, freshness: 'saved', savedAt: hourAgo, reason: 'offline', via: 'worker' }],
    ['stale from the Worker', live({ ...aapl, stale: true, staleReason: 'upstream_unavailable', fetchedAt: hourAgo / 1000 })],
    ['a snapshot', live({ ...quoteOf('TEAM'), source: 'snapshot', series: null })],
    [
      'Cboe, 15 minutes delayed',
      live({ ...aapl, source: 'cboe', provider: 'cboe', delayed: true, name: null, fiftyTwoWeekHigh: null, fiftyTwoWeekLow: null, series: null, openApprox: false }),
    ],
    ['a resolved name', live({ ...quoteOf('CBA.AX'), resolvedFrom: 'CBA' })],
    ['London pence', live({ ...quoteOf('BHP.AX'), symbol: 'VOD.L', name: 'Vodafone Group Plc', currency: 'GBp', exchange: 'LSE', price: 127.2 })],
    ['crypto over 24 hours', live(quoteOf('BTC-USD'))],
    ['a currency pair', live(quoteOf('AUDUSD=X'))],
    ['an index', live(quoteOf('^AXJO'))],
    ['five days', live(quoteOf('AAPL', '5d'))],
    ['a hostile name', live({ ...aapl, name: HOSTILE_NAME, exchange: '<b>NMS</b>' })],
    ['no periods, no change', live({ ...aapl, change: null, changePercent: null, previousClose: null, market: { ...aapl.market, periods: null, phase: 'unknown' } })],
  ];
}

/** A market for command tests: each ticker answers as `answers` says, and calls are recorded. */
export function fakeMarket(
  answers: Readonly<Record<string, QuoteOutcome>>,
  options: { recent?: readonly string[]; search?: SearchOutcome; backend?: Market['backend'] } = {},
): Market & { readonly calls: { symbol: string; range: Range; force: boolean; budgetMs: number | undefined }[] } {
  const calls: { symbol: string; range: Range; force: boolean; budgetMs: number | undefined }[] = [];
  return {
    calls,
    backend: options.backend ?? 'worker',
    async quote(symbol, range, opts = {}) {
      calls.push({ symbol, range, force: opts.force === true, budgetMs: opts.budgetMs });
      return answers[symbol] ?? { ok: false, error: { code: 'not_found' } };
    },
    async search() {
      return options.search ?? { ok: true, hits: [], from: 'local' };
    },
    recent: () => options.recent ?? [],
  };
}
