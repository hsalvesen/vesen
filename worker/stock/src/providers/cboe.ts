// Cboe delayed quotes: the fallback for US-listed stocks, ETFs and a few indices when Yahoo is
// unavailable. Fifteen minutes delayed, no name, no 52-week range and no chart, so the card
// hides what is missing. It answers 403 for anything it does not cover, such as CBA.

import { zoneAbbreviation, zonedTimeToEpoch } from '../time';
import type { InstrumentType, QuoteEnvelope } from '../contract';
import { getText, parseJson } from '../upstream';
import {
  coolDown,
  coolingDown,
  isRecord,
  isUsListed,
  num,
  positive,
  round,
  type ProviderResult,
  type QuoteProvider,
} from './types';

export const CBOE_HOST = 'cdn-api.cboe.com';
const TIMEOUT_MS = 2500;
const US_EASTERN = 'America/New_York';

/** Yahoo's index tickers that Cboe publishes under its own names (each checked to answer 200). */
const CBOE_INDEXES: ReadonlyMap<string, string> = new Map([
  ['^GSPC', '_SPX'],
  ['^DJI', '_DJI'],
  ['^NDX', '_NDX'],
  ['^VIX', '_VIX'],
]);

/** Cboe's name for a Yahoo symbol, or null when Cboe does not cover it. Share classes use a dot: BRK-B → BRK.B. */
export function cboeSymbol(symbol: string): string | null {
  const index = CBOE_INDEXES.get(symbol);
  if (index !== undefined) return index;
  return isUsListed(symbol) ? symbol.replace('-', '.') : null;
}

export const cboeProvider: QuoteProvider = {
  id: 'cboe',
  supports: (symbol) => cboeSymbol(symbol) !== null,
  async quote(symbol, _range, ctx) {
    const target = cboeSymbol(symbol);
    if (target === null) return { ok: false, kind: 'unavailable', detail: 'not covered by Cboe' };
    if (coolingDown(ctx, CBOE_HOST)) return { ok: false, kind: 'rate_limited', detail: 'Cboe is cooling down after a 429' };

    const url = `https://${CBOE_HOST}/api/global/delayed_quotes/quotes/${encodeURIComponent(target)}.json`;
    const response = await getText(url, ctx, { timeoutMs: TIMEOUT_MS });
    if (!response.ok) return { ok: false, kind: 'unavailable', detail: `cboe: ${response.reason}` };
    if (response.status === 429) {
      coolDown(ctx, CBOE_HOST);
      return { ok: false, kind: 'rate_limited', detail: 'cboe: HTTP 429' };
    }
    if (response.status !== 200) return { ok: false, kind: 'unavailable', detail: `cboe: HTTP ${response.status}` };
    return normaliseCboeQuote(parseJson(response.body), symbol, Math.floor(ctx.now() / 1000));
  },
};

function securityType(value: unknown): InstrumentType {
  switch (value) {
    case 'stock':
      return 'EQUITY';
    case 'etf':
      return 'ETF';
    case 'index':
      return 'INDEX';
    default:
      return 'OTHER';
  }
}

export function normaliseCboeQuote(raw: unknown, symbol: string, fetchedAt: number): ProviderResult {
  const data = isRecord(raw) && isRecord(raw.data) ? raw.data : null;
  const price = data ? num(data.current_price) : null;
  if (!data || price === null) return { ok: false, kind: 'unavailable', detail: 'cboe: no price' };

  const change = num(data.price_change);
  const reportedPrevious = num(data.prev_day_close);
  // After the close Cboe's index rows report prev_day_close equal to the price; the change is
  // still right, so the previous close is derived from it.
  const previousClose =
    change !== null && (reportedPrevious === null || (reportedPrevious === price && change !== 0))
      ? round(price - change, 4)
      : reportedPrevious;
  const changePercent =
    num(data.price_change_percent) ??
    (change !== null && previousClose !== null && previousClose !== 0 ? round((change / previousClose) * 100, 4) : null);
  const asOf = (typeof data.last_trade_time === 'string' ? zonedTimeToEpoch(data.last_trade_time, US_EASTERN) : null) ?? fetchedAt;

  const quote: QuoteEnvelope = {
    v: 1,
    kind: 'quote',
    symbol,
    name: null,
    type: securityType(data.security_type),
    exchange: null,
    currency: 'USD',
    priceHint: 2,
    price,
    change,
    changePercent,
    changeBasis: 'previous_close',
    previousClose,
    open: num(data.open),
    openApprox: false,
    dayHigh: num(data.high),
    dayLow: num(data.low),
    fiftyTwoWeekHigh: null,
    fiftyTwoWeekLow: null,
    volume: positive(data.volume),
    market: {
      phase: 'unknown',
      opensAt: null,
      closesAt: null,
      timezone: US_EASTERN,
      tzAbbr: zoneAbbreviation(US_EASTERN, asOf),
      periods: null,
    },
    series: null,
    source: 'cboe',
    provider: 'cboe',
    delayed: true,
    asOf,
    fetchedAt,
    stale: false,
    staleReason: null,
    resolvedFrom: null,
  };
  return { ok: true, quote };
}
