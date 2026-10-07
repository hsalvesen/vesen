// How the stock command reaches market data. The client (client.ts) touches fetch and storage,
// so only the composition root builds it (app/bootstrap.ts provides it here, lazily, so its code
// loads with the first quote); DOM-free command code asks for it here and sees only these types.
// Tests provide a fake.
//
// Which backend this build uses is decided at build time: the owned stock Worker when
// VITE_STOCK_API is set, otherwise the interim public proxy (interim.ts), which is labelled as such
// wherever its data shows.

import type { ErrorCode, QuoteEnvelope, Range, SearchHit } from './contract';

/** `worker`: the owned stock Worker; `interim`: Yahoo through a public proxy until it is deployed. */
export type MarketBackend = 'worker' | 'interim';

/**
 * The stock Worker's base URL without a trailing slash, or null when the build has none. CI passes
 * an unset repository variable as an empty string, which counts as none.
 */
export function stockApiBase(raw: string | undefined = import.meta.env.VITE_STOCK_API): string | null {
  const value = (raw ?? '').trim().replace(/\/+$/, '');
  return /^https?:\/\/[^\s/?#]+(?:\/[^\s?#]*)?$/i.test(value) ? value : null;
}

/** The backend this build uses. */
export function marketBackend(): MarketBackend {
  return stockApiBase() === null ? 'interim' : 'worker';
}

// ── What a lookup comes to ─────────────────────────────────────────────────────────────────

/** Said while a quote is on its way: slower than usual, much slower, and the one retry. */
export type FetchPhase = 'slow' | 'very-slow' | 'retry';

/**
 * Why a lookup failed: the Worker's own codes, or what the app saw on the way there.
 * `not_configured` means no client was provided, as in a copy of vesen built without one.
 */
export type FailureCode = ErrorCode | 'timeout' | 'offline' | 'network' | 'not_configured' | 'cancelled';

export interface MarketFailure {
  readonly code: FailureCode;
  /** Seconds to wait before asking again, when the service said. */
  readonly retryAfter?: number;
  /** For not_found: instruments the visitor may have meant. */
  readonly suggestions?: readonly SearchHit[];
}

export interface QuoteOptions {
  /** The command's signal: ^C, Stop, or its budget. */
  readonly signal?: AbortSignal;
  /** Skips the 30 s memory and asks again (stock -f). */
  readonly force?: boolean;
  /** The whole lookup, retry and fallbacks included, in ms; MARKET_LIMITS.budgetMs by default. */
  readonly budgetMs?: number;
  /** Told when the answer is slower than usual, and when the one retry starts (attempt 2). */
  readonly onPhase?: (phase: FetchPhase, attempt: number) => void;
}

/**
 * A quote, live (`live` fetched now, `memory` from the last 30 s), or an older copy when live data
 * failed (`saved`: the last good copy in this browser, or the Worker's snapshot of a curated
 * ticker). `savedAt` is in milliseconds; the envelope's own times are Unix seconds.
 */
export type QuoteOutcome =
  | { readonly ok: true; readonly quote: QuoteEnvelope; readonly freshness: 'live' | 'memory'; readonly via: MarketBackend }
  | {
      readonly ok: true;
      readonly quote: QuoteEnvelope;
      readonly freshness: 'saved';
      readonly savedAt: number;
      /** Why live data was not shown. */
      readonly reason: FailureCode;
      readonly via: MarketBackend;
    }
  | { readonly ok: false; readonly error: MarketFailure };

/** Search hits from the Worker, or from the short list of names this app knows. */
export type SearchOutcome =
  | { readonly ok: true; readonly hits: readonly SearchHit[]; readonly from: 'worker' | 'local' }
  | { readonly ok: false; readonly error: MarketFailure };

export interface Market {
  readonly backend: MarketBackend;
  /** Never rejects: every failure, a cancel included, is an outcome. */
  quote(symbol: string, range: Range, options?: QuoteOptions): Promise<QuoteOutcome>;
  /** Never rejects. */
  search(query: string, options?: { readonly signal?: AbortSignal }): Promise<SearchOutcome>;
  /** Tickers looked up lately, newest first, from this browser's storage; no network. */
  recent(): readonly string[];
}

// ── The provider ───────────────────────────────────────────────────────────────────────────

let provider: (() => Promise<Market>) | null = null;
let current: Promise<Market> | null = null;

/** Sets where the client comes from (the composition root, or a test); null removes it. */
export function provideMarket(load: (() => Promise<Market>) | null): void {
  provider = load;
  current = null;
}

/**
 * The client, loaded once; null when none was provided. A load that fails (its chunk, offline)
 * is tried again the next time.
 */
export function getMarket(): Promise<Market> | null {
  if (provider === null) return null;
  if (current === null) {
    const loading = provider();
    loading.catch(() => {
      if (current === loading) current = null;
    });
    current = loading;
  }
  return current;
}
