import { describe, expect, it } from 'vitest';
import {
  CURATED_SYMBOLS,
  RANGES,
  RANGE_INTERVAL,
  SYMBOL_ALIASES,
  SYMBOL_RE,
  isErrorEnvelope,
  isQuoteEnvelope,
  isRange,
  isSearchEnvelope,
  isSnapshotEnvelope,
  marketPhaseAt,
  normaliseSymbol,
  type MarketPeriods,
  type QuoteEnvelope,
} from './contract';

describe('SYMBOL_RE', () => {
  it('accepts tickers from every market vesen shows', () => {
    for (const symbol of ['AAPL', 'CBA.AX', '^AXJO', '^GSPC', 'BTC-USD', 'AUDUSD=X', 'BRK-B', '7203.T', 'VOD.L', 'GC=F']) {
      expect(SYMBOL_RE.test(symbol), symbol).toBe(true);
    }
  });

  it('rejects anything that could escape a URL path or carry markup', () => {
    for (const symbol of ['', 'aapl', 'AP PL', '<IMG>', '../X', 'A..B', '%2F', 'A/B', '^', '-A', 'ABCDEFGHIJKLMNOP', 'A\nB']) {
      expect(SYMBOL_RE.test(symbol), JSON.stringify(symbol)).toBe(false);
    }
  });
});

describe('normaliseSymbol', () => {
  it('trims, drops a dollar sign and upper-cases', () => {
    expect(normaliseSymbol('  aapl ')).toEqual({ ok: true, symbol: 'AAPL' });
    expect(normaliseSymbol('$aapl')).toEqual({ ok: true, symbol: 'AAPL' });
    expect(normaliseSymbol('$ tsla')).toEqual({ ok: true, symbol: 'TSLA' });
    expect(normaliseSymbol('^gspc')).toEqual({ ok: true, symbol: '^GSPC' });
    expect(normaliseSymbol('audusd=x')).toEqual({ ok: true, symbol: 'AUDUSD=X' });
  });

  it('maps exchange prefixes to Yahoo suffixes', () => {
    expect(normaliseSymbol('ASX:CBA')).toEqual({ ok: true, symbol: 'CBA.AX' });
    expect(normaliseSymbol('asx:cba')).toEqual({ ok: true, symbol: 'CBA.AX' });
    expect(normaliseSymbol('ASX:CBA.AX')).toEqual({ ok: true, symbol: 'CBA.AX' });
    expect(normaliseSymbol('LSE:VOD')).toEqual({ ok: true, symbol: 'VOD.L' });
    expect(normaliseSymbol('NASDAQ:AAPL')).toEqual({ ok: true, symbol: 'AAPL' });
  });

  it('leaves share classes and aliases alone', () => {
    expect(normaliseSymbol('BRK.B')).toEqual({ ok: true, symbol: 'BRK.B' });
    expect(normaliseSymbol('sp500')).toEqual({ ok: true, symbol: 'SP500' });
  });

  it('says why input is not a ticker', () => {
    expect(normaliseSymbol('')).toEqual({ ok: false, reason: 'empty' });
    expect(normaliseSymbol(' $ ')).toEqual({ ok: false, reason: 'empty' });
    expect(normaliseSymbol('ASX:')).toEqual({ ok: false, reason: 'empty' });
    expect(normaliseSymbol('ABCDEFGHIJKLMNOP')).toEqual({ ok: false, reason: 'too_long' });
    expect(normaliseSymbol('AP PL!')).toEqual({ ok: false, reason: 'characters' });
    expect(normaliseSymbol('<img src=x>')).toEqual({ ok: false, reason: 'characters' });
    expect(normaliseSymbol('XYZ:ABC')).toEqual({ ok: false, reason: 'characters' });
  });

  it('never turns a valid input into an invalid ticker', () => {
    for (const symbol of [...CURATED_SYMBOLS, ...[...SYMBOL_ALIASES.values()].map((a) => a.symbol)]) {
      const check = normaliseSymbol(symbol);
      expect(check.ok && SYMBOL_RE.test(check.symbol), symbol).toBe(true);
    }
  });
});

describe('ranges', () => {
  it('are 1d, 5d, 1mo, 6mo, 1y and 5y, each with an interval', () => {
    expect(RANGES).toEqual(['1d', '5d', '1mo', '6mo', '1y', '5y']);
    for (const range of RANGES) expect(RANGE_INTERVAL[range]).toBeTruthy();
    expect(isRange('5d')).toBe(true);
    expect(isRange('3mo')).toBe(false);
    expect(isRange('constructor')).toBe(false);
  });
});

describe('marketPhaseAt', () => {
  // AAPL on 5 October 2026 (EDT): pre 04:00, regular 09:30 to 16:00, post to 20:00.
  const periods: MarketPeriods = {
    pre: { start: 1_791_187_200, end: 1_791_207_000 },
    regular: { start: 1_791_207_000, end: 1_791_230_400 },
    post: { start: 1_791_230_400, end: 1_791_244_800 },
  };

  it('follows the session through the day', () => {
    expect(marketPhaseAt('EQUITY', periods, 1_791_180_000)).toEqual({ phase: 'closed', opensAt: 1_791_207_000, closesAt: null });
    expect(marketPhaseAt('EQUITY', periods, 1_791_190_000)).toEqual({ phase: 'pre', opensAt: 1_791_207_000, closesAt: null });
    expect(marketPhaseAt('EQUITY', periods, 1_791_210_000)).toEqual({ phase: 'open', opensAt: null, closesAt: 1_791_230_400 });
    expect(marketPhaseAt('EQUITY', periods, 1_791_230_400)).toEqual({ phase: 'post', opensAt: null, closesAt: null });
    expect(marketPhaseAt('EQUITY', periods, 1_791_250_000)).toEqual({ phase: 'closed', opensAt: null, closesAt: null });
  });

  it('ignores empty pre and post periods', () => {
    const asx: MarketPeriods = { ...periods, pre: { start: 5, end: 5 }, post: null };
    expect(marketPhaseAt('EQUITY', asx, 5).phase).toBe('closed');
  });

  it('treats crypto as always open and missing periods as unknown', () => {
    expect(marketPhaseAt('CRYPTOCURRENCY', null, 0).phase).toBe('always_open');
    expect(marketPhaseAt('EQUITY', null, 0).phase).toBe('unknown');
  });
});

const quote: QuoteEnvelope = {
  v: 1,
  kind: 'quote',
  symbol: 'AAPL',
  name: 'Apple Inc.',
  type: 'EQUITY',
  exchange: 'NasdaqGS',
  currency: 'USD',
  priceHint: 2,
  price: 332.89,
  change: -0.8,
  changePercent: -0.2397,
  changeBasis: 'previous_close',
  previousClose: 333.69,
  open: 332.795,
  openApprox: true,
  dayHigh: 336.19,
  dayLow: 331.65,
  fiftyTwoWeekHigh: 345.34,
  fiftyTwoWeekLow: 243.42,
  volume: 34_328_912,
  market: { phase: 'closed', opensAt: null, closesAt: null, timezone: 'America/New_York', tzAbbr: 'EDT', periods: null },
  series: { range: '1d', interval: '5m', start: 1, end: 2, points: [[0, 331.9]], baseline: 333.69 },
  source: 'yahoo',
  provider: 'yahoo',
  delayed: false,
  asOf: 1_791_230_402,
  fetchedAt: 1_791_257_400,
  stale: false,
  staleReason: null,
  resolvedFrom: null,
};

describe('guards', () => {
  it('accept well-formed envelopes', () => {
    expect(isQuoteEnvelope(quote)).toBe(true);
    expect(isQuoteEnvelope({ ...quote, series: null, change: null })).toBe(true);
    expect(isSearchEnvelope({ v: 1, kind: 'search', query: 'apple', hits: [{ symbol: 'AAPL', name: null, exchange: null, type: 'EQUITY' }] })).toBe(true);
    expect(isSnapshotEnvelope({ v: 1, kind: 'snapshot', generatedAt: 1, quotes: [quote], missing: ['TEAM'] })).toBe(true);
    expect(isErrorEnvelope({ v: 1, kind: 'error', error: { code: 'rate_limited', message: 'slow down', retryAfter: 2 } })).toBe(true);
  });

  it('reject zeros-for-nulls swaps, unknown codes and other versions', () => {
    expect(isQuoteEnvelope({ ...quote, price: null })).toBe(false);
    expect(isQuoteEnvelope({ ...quote, volume: '34M' })).toBe(false);
    expect(isQuoteEnvelope({ ...quote, v: 2 })).toBe(false);
    expect(isQuoteEnvelope({ ...quote, source: 'allorigins' })).toBe(false);
    expect(isQuoteEnvelope({ ...quote, series: { ...quote.series, points: [[0]] } })).toBe(false);
    expect(isErrorEnvelope({ v: 1, kind: 'error', error: { code: 'teapot', message: '' } })).toBe(false);
    expect(isSearchEnvelope({ v: 1, kind: 'search', query: 'x', hits: [{ symbol: 'X', type: 'NFT' }] })).toBe(false);
    expect(isQuoteEnvelope(null)).toBe(false);
  });
});
