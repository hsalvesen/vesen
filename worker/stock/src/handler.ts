// The HTTP surface, written against the Fetch API only, so the same handler can run on
// Cloudflare (index.ts), in tests, or behind a small adapter on another host.
//
//   GET /v1/quote?symbol=AAPL&range=1d   QuoteEnvelope
//   GET /v1/search?q=apple&limit=6       SearchEnvelope
//   GET /v1/snapshot                     SnapshotEnvelope (curated symbols, no series)
//   GET /v1/health                       HealthEnvelope
//
// Every failure is an ErrorEnvelope with the status from ERROR_STATUS.

import {
  DEFAULT_RANGE,
  ERROR_STATUS,
  RANGES,
  STOCK_API_PATHS,
  STOCK_API_VERSION,
  isRange,
  normaliseSymbol,
  type ApiError,
  type ErrorCode,
  type ErrorEnvelope,
  type HealthEnvelope,
  type QuoteSource,
  type SearchEnvelope,
  type SearchHit,
  type StockEnvelope,
} from './contract';
import { corsHeaders, type OriginVerdict } from './cors';
import { toSearchHit } from './providers/yahooSearch';
import type { TokenBucketLimiter } from './ratelimit';
import { lookupQuote, providerContext, searchCached, type CacheState, type ServiceDeps } from './service';
import { currentSnapshot, deliverSnapshot, snapshotFallback, type SnapshotStore } from './snapshot';

export interface HandlerDeps extends ServiceDeps {
  /** Null when no KV namespace is bound; the built-in copy then answers /v1/snapshot. */
  readonly snapshots: SnapshotStore | null;
}

/** What one request carries through the handler. */
interface Scope {
  readonly origin: string | null;
  readonly verdict: OriginVerdict;
  readonly ip: string;
  readonly startedAt: number;
  readonly metrics: { upstreamMs: number; calls: number };
  readonly deps: HandlerDeps;
}

interface ReplyOptions {
  readonly cache?: CacheState;
  readonly source?: QuoteSource;
  readonly retryAfter?: number;
  /** Lets browsers and the edge reuse the answer for 15 s. Errors other than not_found are not cached. */
  readonly cacheable?: boolean;
  readonly headers?: Readonly<Record<string, string>>;
}

/** Seconds a client should wait after upstream_unavailable. */
export const UNAVAILABLE_RETRY_AFTER_SEC = 30;

const MAX_QUERY_LENGTH = 40;
const DEFAULT_SEARCH_LIMIT = 6;
const MAX_SEARCH_LIMIT = 10;

export async function handle(request: Request, deps: HandlerDeps): Promise<Response> {
  const origin = request.headers.get('Origin');
  const scope: Scope = {
    origin,
    verdict: deps.config.origins.classify(origin),
    // Used only as a rate-limit key in memory; never logged.
    ip: request.headers.get('CF-Connecting-IP') ?? 'unknown',
    startedAt: deps.now(),
    metrics: { upstreamMs: 0, calls: 0 },
    deps,
  };

  try {
    if (scope.verdict === 'denied') {
      return fail(scope, 'origin_not_allowed', "This quote service answers vesen.app only. Run your own copy to use it on another site.");
    }
    if (request.method === 'OPTIONS') return preflight(scope);
    if (request.method !== 'GET') {
      return fail(scope, 'bad_request', 'Only GET is supported.', { status: 405, headers: { Allow: 'GET, OPTIONS' } });
    }

    const url = new URL(request.url);
    switch (url.pathname) {
      case STOCK_API_PATHS.quote:
        return await quoteRoute(url, scope);
      case STOCK_API_PATHS.search:
        return await searchRoute(url, scope);
      case STOCK_API_PATHS.snapshot:
        return await snapshotRoute(scope);
      case STOCK_API_PATHS.health:
        return healthRoute(scope);
      default:
        return fail(scope, 'bad_request', `Unknown path. Try ${STOCK_API_PATHS.quote}?symbol=AAPL.`, { status: 404 });
    }
  } catch {
    return fail(scope, 'internal', 'The quote service hit an unexpected error.');
  }
}

async function quoteRoute(url: URL, scope: Scope): Promise<Response> {
  const raw = url.searchParams.get('symbol') ?? '';
  const check = normaliseSymbol(raw);
  if (!check.ok) {
    return fail(
      scope,
      'invalid_symbol',
      `${quoted(raw)} isn't a valid ticker. Tickers look like AAPL, CBA.AX, ^AXJO, BTC-USD or AUDUSD=X.`,
    );
  }
  const range = url.searchParams.get('range') || DEFAULT_RANGE;
  if (!isRange(range)) return fail(scope, 'bad_request', `range must be one of ${RANGES.join(', ')}.`);

  const limited = rateLimit(scope, scope.deps.state.limits.quote);
  if (limited) return limited;

  const { deps } = scope;
  const outcome = await lookupQuote(check.symbol, range, deps, providerContext(deps, scope.metrics));
  if (outcome.ok) return reply(scope, 200, outcome.quote, { cache: outcome.cache, source: outcome.quote.source, cacheable: true });
  if (outcome.kind === 'not_found') {
    return fail(scope, 'not_found', `No market data for ${quoted(check.symbol)}.`, { suggestions: outcome.suggestions });
  }

  const fallback = await snapshotFallback(check.symbol, range, deps, deps.snapshots);
  if (fallback) return reply(scope, 200, fallback, { cache: 'stale', source: 'snapshot', cacheable: true });
  return fail(scope, 'upstream_unavailable', 'Market data is unavailable right now. Try again in a minute.', {
    retryAfter: UNAVAILABLE_RETRY_AFTER_SEC,
  });
}

async function searchRoute(url: URL, scope: Scope): Promise<Response> {
  const query = (url.searchParams.get('q') ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (query === '' || query.length > MAX_QUERY_LENGTH) {
    return fail(scope, 'bad_request', `q must be 1 to ${MAX_QUERY_LENGTH} characters.`);
  }
  const limitParam = url.searchParams.get('limit');
  const limit = limitParam === null ? DEFAULT_SEARCH_LIMIT : Number(limitParam);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_SEARCH_LIMIT) {
    return fail(scope, 'bad_request', `limit must be a whole number from 1 to ${MAX_SEARCH_LIMIT}.`);
  }

  const limited = rateLimit(scope, scope.deps.state.limits.search);
  if (limited) return limited;

  const outcome = await searchCached(query, scope.deps, providerContext(scope.deps, scope.metrics));
  if (!outcome.ok) {
    return fail(scope, 'upstream_unavailable', 'Search is unavailable right now. Try again in a minute.', {
      retryAfter: UNAVAILABLE_RETRY_AFTER_SEC,
    });
  }
  const body: SearchEnvelope = {
    v: STOCK_API_VERSION,
    kind: 'search',
    query,
    hits: outcome.hits.slice(0, limit).map(toSearchHit),
  };
  return reply(scope, 200, body, { cache: outcome.cache, source: 'yahoo', cacheable: true });
}

async function snapshotRoute(scope: Scope): Promise<Response> {
  const limited = rateLimit(scope, scope.deps.state.limits.quote);
  if (limited) return limited;
  const current = await currentSnapshot(scope.deps, scope.deps.snapshots);
  if (!current) {
    return fail(scope, 'upstream_unavailable', 'No snapshot is available yet.', { retryAfter: UNAVAILABLE_RETRY_AFTER_SEC });
  }
  const body = deliverSnapshot(current.snapshot, current.origin, scope.deps.now());
  return reply(scope, 200, body, { cache: current.origin === 'kv' ? 'hit' : 'stale', source: 'snapshot', cacheable: true });
}

function healthRoute(scope: Scope): Response {
  const { config, snapshots, now } = scope.deps;
  const body: HealthEnvelope = {
    v: STOCK_API_VERSION,
    kind: 'health',
    ok: true,
    version: config.version,
    providers: config.providers,
    snapshot: snapshots !== null,
    time: Math.floor(now() / 1000),
  };
  return reply(scope, 200, body, {});
}

function preflight(scope: Scope): Response {
  return new Response(null, {
    status: 204,
    headers: {
      ...corsHeaders(scope.origin, scope.verdict),
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Max-Age': '86400',
    },
  });
}

/** Requests with no Origin share one tighter bucket per IP. */
function rateLimit(scope: Scope, limiter: TokenBucketLimiter): Response | null {
  const bucket = scope.verdict === 'anonymous' ? scope.deps.state.limits.anonymous : limiter;
  const result = bucket.take(scope.ip, scope.deps.now());
  if (result.ok) return null;
  return fail(scope, 'rate_limited', `Too many requests. Try again in ${result.retryAfterSec} s.`, {
    retryAfter: result.retryAfterSec,
  });
}

/** Up to 24 characters of what was typed, quoted, with control characters removed. */
function quoted(raw: string): string {
  const clean = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return `'${clean.length > 24 ? `${clean.slice(0, 23)}…` : clean}'`;
}

function fail(
  scope: Scope,
  code: ErrorCode,
  message: string,
  extra: { status?: number; retryAfter?: number; suggestions?: readonly SearchHit[]; headers?: Readonly<Record<string, string>> } = {},
): Response {
  const error: ApiError = {
    code,
    message,
    ...(extra.retryAfter !== undefined ? { retryAfter: extra.retryAfter } : {}),
    ...(code === 'not_found' ? { suggestions: extra.suggestions ?? [] } : {}),
  };
  const body: ErrorEnvelope = { v: STOCK_API_VERSION, kind: 'error', error };
  return reply(scope, extra.status ?? ERROR_STATUS[code], body, {
    ...(extra.retryAfter !== undefined ? { retryAfter: extra.retryAfter } : {}),
    ...(extra.headers ? { headers: extra.headers } : {}),
    cacheable: code === 'not_found',
  });
}

function reply(scope: Scope, status: number, body: StockEnvelope, options: ReplyOptions): Response {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': options.cacheable ? 'public, max-age=15' : 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...corsHeaders(scope.origin, scope.verdict),
    ...options.headers,
    'Server-Timing': serverTiming(scope, options.cache),
  };
  if (options.cache) headers['X-Vesen-Cache'] = options.cache;
  if (options.source) headers['X-Vesen-Source'] = options.source;
  if (options.retryAfter !== undefined) headers['Retry-After'] = String(options.retryAfter);
  return new Response(JSON.stringify(body), { status, headers });
}

function serverTiming(scope: Scope, cache: CacheState | undefined): string {
  const parts: string[] = [];
  if (cache) parts.push(`cache;desc="${cache}"`);
  if (scope.metrics.calls > 0) parts.push(`upstream;dur=${scope.metrics.upstreamMs}`);
  parts.push(`total;dur=${scope.deps.now() - scope.startedAt}`);
  return parts.join(', ');
}
