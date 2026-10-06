// Finnhub: an optional keyed tier, used only when the FINNHUB_KEY secret is set. Its free plan
// covers US markets only. The key goes in a header, so it never appears in a logged URL.

import { zoneAbbreviation } from '../time';
import type { QuoteEnvelope } from '../contract';
import { getText, parseJson } from '../upstream';
import {
  coolDown,
  coolingDown,
  isRecord,
  isUsListed,
  num,
  round,
  type ProviderResult,
  type QuoteProvider,
} from './types';

export const FINNHUB_HOST = 'finnhub.io';
const TIMEOUT_MS = 2500;
const US_EASTERN = 'America/New_York';

export const finnhubProvider: QuoteProvider = {
  id: 'finnhub',
  supports: (symbol) => isUsListed(symbol),
  async quote(symbol, _range, ctx) {
    if (ctx.finnhubKey === null) return { ok: false, kind: 'unavailable', detail: 'finnhub: no key' };
    if (coolingDown(ctx, FINNHUB_HOST)) return { ok: false, kind: 'rate_limited', detail: 'Finnhub is cooling down after a 429' };

    const url = `https://${FINNHUB_HOST}/api/v1/quote?symbol=${encodeURIComponent(symbol.replace('-', '.'))}`;
    const response = await getText(url, ctx, { timeoutMs: TIMEOUT_MS, headers: { 'X-Finnhub-Token': ctx.finnhubKey } });
    if (!response.ok) return { ok: false, kind: 'unavailable', detail: `finnhub: ${response.reason}` };
    if (response.status === 429) {
      coolDown(ctx, FINNHUB_HOST);
      return { ok: false, kind: 'rate_limited', detail: 'finnhub: HTTP 429' };
    }
    if (response.status !== 200) return { ok: false, kind: 'unavailable', detail: `finnhub: HTTP ${response.status}` };
    return normaliseFinnhubQuote(parseJson(response.body), symbol, Math.floor(ctx.now() / 1000));
  },
};

/** Finnhub's quote is `{ c, d, dp, h, l, o, pc, t }`; an unknown symbol comes back as all zeros. */
export function normaliseFinnhubQuote(raw: unknown, symbol: string, fetchedAt: number): ProviderResult {
  const price = isRecord(raw) ? num(raw.c) : null;
  if (!isRecord(raw) || price === null || price === 0) return { ok: false, kind: 'unavailable', detail: 'finnhub: no price' };

  const nonZero = (value: unknown): number | null => {
    const n = num(value);
    return n === 0 ? null : n;
  };
  const previousClose = nonZero(raw.pc);
  const asOf = nonZero(raw.t) ?? fetchedAt;

  const quote: QuoteEnvelope = {
    v: 1,
    kind: 'quote',
    symbol,
    name: null,
    type: 'OTHER',
    exchange: null,
    currency: 'USD',
    priceHint: 2,
    price,
    change: num(raw.d) ?? (previousClose !== null ? round(price - previousClose, 4) : null),
    changePercent: num(raw.dp),
    changeBasis: 'previous_close',
    previousClose,
    open: nonZero(raw.o),
    openApprox: false,
    dayHigh: nonZero(raw.h),
    dayLow: nonZero(raw.l),
    fiftyTwoWeekHigh: null,
    fiftyTwoWeekLow: null,
    volume: null,
    market: {
      phase: 'unknown',
      opensAt: null,
      closesAt: null,
      timezone: US_EASTERN,
      tzAbbr: zoneAbbreviation(US_EASTERN, asOf),
      periods: null,
    },
    series: null,
    source: 'finnhub',
    provider: 'finnhub',
    delayed: false,
    asOf,
    fetchedAt,
    stale: false,
    staleReason: null,
    resolvedFrom: null,
  };
  return { ok: true, quote };
}
