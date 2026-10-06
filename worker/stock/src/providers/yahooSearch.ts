// Yahoo Finance search: company names to tickers ("apple" → AAPL) and did-you-mean suggestions.
// Only equities, ETFs, indices, crypto and currencies are kept; futures, options and funds are
// dropped so a name never resolves to a derivative.

import { SEARCH_TYPES, SYMBOL_RE, type InstrumentType, type SearchHit } from '../contract';
import { getText, parseJson } from '../upstream';
import { coolDown, coolingDown, isRecord, num, text, type ProviderContext } from './types';

/** A hit with Yahoo's relevance score, which name resolution needs and the wire format leaves out. */
export interface RankedHit extends SearchHit {
  readonly score: number;
}

export type SearchResult =
  | { readonly ok: true; readonly hits: readonly RankedHit[] }
  | { readonly ok: false; readonly kind: 'rate_limited' | 'unavailable'; readonly detail: string };

export const SEARCH_HOSTS = [
  { host: 'query2.finance.yahoo.com', timeoutMs: 3000 },
  { host: 'query1.finance.yahoo.com', timeoutMs: 2500 },
] as const;

/** Upstream results asked for; filtering usually leaves fewer. */
const QUOTES_COUNT = 10;

export function searchUrl(host: string, query: string): string {
  return `https://${host}/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=${QUOTES_COUNT}&newsCount=0&listsCount=0`;
}

export async function searchYahoo(query: string, ctx: ProviderContext): Promise<SearchResult> {
  let rateLimited = false;
  let detail = 'no host available';
  for (const { host, timeoutMs } of SEARCH_HOSTS) {
    if (coolingDown(ctx, host)) {
      rateLimited = true;
      detail = `${host} is cooling down after a 429`;
      continue;
    }
    const response = await getText(searchUrl(host, query), ctx, { timeoutMs });
    if (!response.ok) {
      detail = `${host}: ${response.reason}`;
      if (response.reason === 'no_time') break;
      continue;
    }
    if (response.status === 429) {
      coolDown(ctx, host);
      rateLimited = true;
      detail = `${host}: HTTP 429`;
      continue;
    }
    const hits = response.status === 200 ? normaliseYahooSearch(parseJson(response.body)) : null;
    if (hits) return { ok: true, hits };
    detail = `${host}: ${response.status === 200 ? 'unreadable body' : `HTTP ${response.status}`}`;
  }
  return { ok: false, kind: rateLimited ? 'rate_limited' : 'unavailable', detail };
}

/** The usable hits, best first, or null when the body is not a search response. */
export function normaliseYahooSearch(raw: unknown): RankedHit[] | null {
  if (!isRecord(raw) || !Array.isArray(raw.quotes)) return null;
  const seen = new Set<string>();
  const hits: RankedHit[] = [];
  for (const item of raw.quotes as unknown[]) {
    if (!isRecord(item) || typeof item.symbol !== 'string') continue;
    const type = item.quoteType;
    if (typeof type !== 'string' || !(SEARCH_TYPES as readonly string[]).includes(type)) continue;
    const symbol = item.symbol.toUpperCase();
    if (!SYMBOL_RE.test(symbol) || seen.has(symbol)) continue;
    seen.add(symbol);
    hits.push({
      symbol,
      name: text(item.longname) ?? text(item.shortname),
      exchange: text(item.exchDisp, 40) ?? text(item.exchange, 40),
      type: type as InstrumentType,
      score: num(item.score) ?? 0,
    });
  }
  // Stable, so Yahoo's own order breaks ties.
  return hits.sort((a, b) => b.score - a.score);
}

export function toSearchHit({ symbol, name, exchange, type }: RankedHit): SearchHit {
  return { symbol, name, exchange, type };
}
