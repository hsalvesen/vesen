// The quote service behind the HTTP routes and the scheduled snapshot: the provider chain, the
// caches, name resolution and stale-if-error. Nothing here knows about HTTP or Cloudflare.

import { LIFETIMES, TtlCache, quoteLifetime } from './cache';
import type { WorkerConfig } from './config';
import { marketPhaseAt, type ProviderId, type QuoteEnvelope, type Range, type SearchHit, type SnapshotEnvelope, type StaleReason } from './contract';
import { cboeProvider } from './providers/cboe';
import { finnhubProvider } from './providers/finnhub';
import type { ProviderContext, ProviderResult, QuoteProvider } from './providers/types';
import { yahooProvider } from './providers/yahoo';
import { searchYahoo, type RankedHit } from './providers/yahooSearch';
import { LIMITS, TokenBucketLimiter } from './ratelimit';
import { aliasFor, pickResolution, suggestionsFrom } from './resolve';
import { MIN_ATTEMPT_MS, type FetchLike } from './upstream';

/** Everything that outlives one request. One per isolate, created when the module loads. */
export interface IsolateState {
  readonly quotes: TtlCache<QuoteEnvelope>;
  readonly searches: TtlCache<readonly RankedHit[]>;
  readonly resolutions: TtlCache<string>;
  readonly notFound: TtlCache<readonly SearchHit[]>;
  readonly snapshot: TtlCache<SnapshotEnvelope>;
  readonly cooldowns: Map<string, number>;
  readonly limits: {
    readonly quote: TokenBucketLimiter;
    readonly search: TokenBucketLimiter;
    readonly anonymous: TokenBucketLimiter;
    readonly upstream: TokenBucketLimiter;
  };
}

export function createIsolateState(): IsolateState {
  return {
    quotes: new TtlCache(500),
    searches: new TtlCache(200),
    resolutions: new TtlCache(200),
    notFound: new TtlCache(500),
    snapshot: new TtlCache(1),
    cooldowns: new Map(),
    limits: {
      quote: new TokenBucketLimiter(LIMITS.quote),
      search: new TokenBucketLimiter(LIMITS.search),
      anonymous: new TokenBucketLimiter(LIMITS.anonymous),
      upstream: new TokenBucketLimiter(LIMITS.upstream),
    },
  };
}

export interface ServiceDeps {
  readonly config: WorkerConfig;
  readonly state: IsolateState;
  readonly fetch: FetchLike;
  /** Epoch milliseconds. */
  readonly now: () => number;
}

/** The whole upstream budget for one request: provider attempts, a search and a resolved retry. */
export const REQUEST_BUDGET_MS = 6500;

export function providerContext(
  deps: ServiceDeps,
  metrics: { upstreamMs: number; calls: number },
  budgetMs = REQUEST_BUDGET_MS,
): ProviderContext {
  return {
    fetch: deps.fetch,
    now: deps.now,
    deadline: deps.now() + budgetMs,
    userAgent: deps.config.userAgent,
    metrics,
    cooldowns: deps.state.cooldowns,
    finnhubKey: deps.config.finnhubKey,
  };
}

const PROVIDERS: Readonly<Record<ProviderId, QuoteProvider>> = {
  yahoo: yahooProvider,
  cboe: cboeProvider,
  finnhub: finnhubProvider,
};

/** Tries each configured provider in turn until one answers. Yahoo's not_found ends the chain. */
export async function fetchFromProviders(
  symbol: string,
  range: Range,
  deps: ServiceDeps,
  ctx: ProviderContext,
): Promise<ProviderResult> {
  let rateLimited = false;
  const details: string[] = [];
  for (const id of deps.config.providers) {
    const provider = PROVIDERS[id];
    if (!provider.supports(symbol, range)) continue;
    if (ctx.deadline - ctx.now() < MIN_ATTEMPT_MS) {
      details.push('out of time');
      break;
    }
    if (!deps.state.limits.upstream.take(id, ctx.now()).ok) {
      rateLimited = true;
      details.push(`${id}: vesen's own upstream limit`);
      continue;
    }
    const result = await provider.quote(symbol, range, ctx);
    if (result.ok) return result;
    if (result.kind === 'not_found' && id === 'yahoo') return result;
    if (result.kind === 'rate_limited') rateLimited = true;
    details.push(result.detail);
  }
  return { ok: false, kind: rateLimited ? 'rate_limited' : 'unavailable', detail: details.join('; ') || 'no provider covers this symbol' };
}

export type CacheState = 'hit' | 'miss' | 'stale';

export type QuoteOutcome =
  | { readonly ok: true; readonly quote: QuoteEnvelope; readonly cache: CacheState }
  | { readonly ok: false; readonly kind: 'not_found'; readonly suggestions: readonly SearchHit[] }
  | { readonly ok: false; readonly kind: 'rate_limited' | 'unavailable' };

/** A stored copy with its market phase recomputed for now, so it never claims a closed market is open. */
export function withCurrentPhase(quote: QuoteEnvelope, nowMs: number): QuoteEnvelope {
  const phase = marketPhaseAt(quote.type, quote.market.periods, Math.floor(nowMs / 1000));
  return { ...quote, market: { ...quote.market, ...phase } };
}

/** A stored copy served because live data was unavailable. */
export function asStale(quote: QuoteEnvelope, reason: StaleReason, nowMs: number): QuoteEnvelope {
  return { ...withCurrentPhase(quote, nowMs), stale: true, staleReason: reason };
}

/** One symbol through the cache: fresh hit, else one coalesced upstream load, else a stale copy. */
export async function getQuote(symbol: string, range: Range, deps: ServiceDeps, ctx: ProviderContext): Promise<QuoteOutcome> {
  const { quotes } = deps.state;
  const key = `${symbol}:${range}`;
  const cached = quotes.get(key, deps.now());
  if (cached?.fresh) return { ok: true, quote: cached.value, cache: 'hit' };

  const result = await quotes.coalesce(key, async () => {
    const loaded = await fetchFromProviders(symbol, range, deps, ctx);
    if (loaded.ok) quotes.set(key, loaded.quote, deps.now(), quoteLifetime(loaded.quote.market.phase));
    return loaded;
  });
  if (result.ok) return { ok: true, quote: result.quote, cache: 'miss' };
  if (result.kind === 'not_found') return { ok: false, kind: 'not_found', suggestions: [] };

  const stale = quotes.get(key, deps.now());
  if (stale) {
    const reason = result.kind === 'rate_limited' ? 'rate_limited' : 'upstream_unavailable';
    return { ok: true, quote: asStale(stale.value, reason, deps.now()), cache: 'stale' };
  }
  return { ok: false, kind: result.kind };
}

export type SearchOutcome =
  | { readonly ok: true; readonly hits: readonly RankedHit[]; readonly cache: CacheState }
  | { readonly ok: false; readonly kind: 'rate_limited' | 'unavailable' };

export async function searchCached(query: string, deps: ServiceDeps, ctx: ProviderContext): Promise<SearchOutcome> {
  const { searches } = deps.state;
  const key = query.toLowerCase();
  const cached = searches.get(key, deps.now());
  if (cached?.fresh) return { ok: true, hits: cached.value, cache: 'hit' };

  const result = await searches.coalesce(key, async () => {
    if (!deps.state.limits.upstream.take('yahoo-search', deps.now()).ok) {
      return { ok: false, kind: 'rate_limited', detail: "vesen's own upstream limit" } as const;
    }
    const found = await searchYahoo(query, ctx);
    if (found.ok) searches.set(key, found.hits, deps.now(), LIFETIMES.search);
    return found;
  });
  if (result.ok) return { ok: true, hits: result.hits, cache: 'miss' };
  const stale = searches.get(key, deps.now());
  return stale ? { ok: true, hits: stale.value, cache: 'stale' } : { ok: false, kind: result.kind };
}

/**
 * A symbol as a visitor typed it, resolved when it does not exist: a remembered resolution, an
 * alias, or a dominant search match. Anything else is not_found with suggestions, remembered for
 * ten minutes so a mistyped ticker costs one upstream round, not one per keystroke.
 */
export async function lookupQuote(symbol: string, range: Range, deps: ServiceDeps, ctx: ProviderContext): Promise<QuoteOutcome> {
  const { resolutions, notFound } = deps.state;
  const remembered = resolutions.get(symbol, deps.now());
  if (remembered) return withResolvedFrom(await getQuote(remembered.value, range, deps, ctx), symbol);

  const missing = notFound.get(symbol, deps.now());
  if (missing) return { ok: false, kind: 'not_found', suggestions: missing.value };

  const direct = await getQuote(symbol, range, deps, ctx);
  if (direct.ok || direct.kind !== 'not_found') return direct;

  const alias = aliasFor(symbol);
  const search = alias === null ? await searchCached(symbol, deps, ctx) : null;
  const target = alias ?? (search?.ok ? pickResolution(symbol, search.hits) : null);
  if (target !== null && target !== symbol) {
    resolutions.set(symbol, target, deps.now(), LIFETIMES.resolution);
    return withResolvedFrom(await getQuote(target, range, deps, ctx), symbol);
  }

  const suggestions = search?.ok ? suggestionsFrom(search.hits, symbol) : [];
  if (search?.ok) notFound.set(symbol, suggestions, deps.now(), LIFETIMES.notFound);
  return { ok: false, kind: 'not_found', suggestions };
}

function withResolvedFrom(outcome: QuoteOutcome, asked: string): QuoteOutcome {
  return outcome.ok && outcome.quote.symbol !== asked ? { ...outcome, quote: { ...outcome.quote, resolvedFrom: asked } } : outcome;
}
