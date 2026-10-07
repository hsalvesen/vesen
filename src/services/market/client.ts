// The market client behind `stock` (docs/plan/07-stock-and-proxy.md, "Client data layer"). It asks
// the owned stock Worker when the build names one (VITE_STOCK_API), and otherwise the interim
// public proxy (interim.ts); either way the answer is the contract's QuoteEnvelope.
//
// The policy, so the terminal never hangs:
// - 8 s per attempt, and the whole lookup within its budget (10 s for the command, less a little
//   so a saved copy can still be drawn);
// - at most one retry, and only after a fast failure (a failed connection, a 5xx or an unreadable
//   body within 3 s), after a 400-800 ms pause, and only with 3 s of the budget left;
// - a 429 is tried once more only when Retry-After is 3 s or less;
// - an offline browser makes no request;
// - answers are remembered for 30 s, and two lookups of one quote share one request;
// - the last good copy of each ticker is kept in vesen:stock:v1 with the recent tickers, and
//   shown, marked stale, when live data fails for a reason that may pass.
//
// Every envelope is checked by the contract's guards before anything reads it.

import { combineSignals } from '../../lib/signals';
import { createMemo, fetchAndRead, isOnline, type Memo } from '../net';
import { STORAGE_KEYS } from '../storage-keys';
import type { KV } from '../types';
import { AttemptTimeout, failedAttempt, failureFromError, retryAfterSeconds, type Attempt, type AttemptResult } from './attempt';
import {
  CURATED_SYMBOLS,
  STOCK_API_PATHS,
  isErrorEnvelope,
  isQuoteEnvelope,
  isSearchEnvelope,
  isSnapshotEnvelope,
  type QuoteEnvelope,
  type Range,
  type SearchHit,
} from './contract';
import { interimAttempt } from './interim';
import { resolveLocal, searchLocal, suggestLocal } from './names';
import { downsample } from './normalise';
import {
  stockApiBase,
  type FailureCode,
  type Market,
  type MarketBackend,
  type MarketFailure,
  type QuoteOptions,
  type QuoteOutcome,
  type SearchOutcome,
} from './port';

export const MARKET_LIMITS = {
  /** One request. */
  attemptMs: 8000,
  /** The whole lookup by default: under the command's 10 s, so a saved copy can still be drawn. */
  budgetMs: 9500,
  /** A failure this quick may be retried. */
  fastFailureMs: 3000,
  /** A retry starts only with this much of the budget left. */
  retryNeedsMs: 3000,
  /** The pause before a retry: 400 ms plus up to this much. */
  retryJitterMs: 400,
  retryBaseMs: 400,
  /** Retry-After is honoured, once, up to this long. */
  maxRetryAfterMs: 3000,
  /** An attempt that would get less time than this is not started. */
  minAttemptMs: 250,
  /** Answers are reused for this long. */
  memoryMs: 30_000,
  /** A failure is remembered for this long, unless the visitor forces a fresh look. */
  failureCooldownMs: 5000,
  /** The status line says the lookup is slow after this long, and very slow after the next. */
  slowAfterMs: 2500,
  verySlowAfterMs: 6000,
  /** Saved copies older than this are not shown. */
  savedMaxAgeMs: 7 * 24 * 60 * 60 * 1000,
  /** Tickers whose last good quote is kept, and recent tickers listed. */
  savedQuotes: 12,
  recents: 8,
  /** A saved quote's chart is cut to this many points. */
  savedPoints: 48,
} as const;

export interface MarketClientOptions {
  /** The Worker's base URL; null uses the interim proxy. Defaults to VITE_STOCK_API. */
  readonly baseUrl?: string | null;
  /** Where the last good quotes and the recent tickers are kept; null keeps them for the page. */
  readonly storage?: KV<'local'> | null;
  readonly now?: () => number;
  readonly random?: () => number;
  /** False when the browser says it is offline. */
  readonly online?: () => boolean;
}

// ── Failures ───────────────────────────────────────────────────────────────────────────────

/** Failures a saved copy may stand in for: they may pass. */
const TRANSIENT: ReadonlySet<FailureCode> = new Set<FailureCode>([
  'timeout',
  'offline',
  'network',
  'rate_limited',
  'upstream_unavailable',
  'internal',
]);

class LookupFailed extends Error {
  constructor(readonly failure: MarketFailure) {
    super(failure.code);
    this.name = 'LookupFailed';
  }
}

const CANCELLED: unique symbol = Symbol('cancelled');

/** Waits `ms`, or until `signal` aborts; resolves false when it aborted. */
function pause(ms: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const done = (finished: boolean): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      resolve(finished);
    };
    const onAbort = (): void => done(false);
    const timer = setTimeout(() => done(true), Math.max(0, ms));
    signal.addEventListener('abort', onAbort);
  });
}

// ── The Worker ─────────────────────────────────────────────────────────────────────────────

interface RawResponse {
  readonly status: number;
  readonly retryAfter: string | null;
  readonly body: string;
}

async function getRaw(url: string, signal: AbortSignal, timeoutMs: number): Promise<RawResponse> {
  // A simple GET with no custom headers, so the browser sends no preflight.
  return fetchAndRead(url, { signal, timeoutMs, throwHttpErrors: false }, async (response) => ({
    status: response.status,
    retryAfter: response.headers.get('retry-after'),
    body: await response.text(),
  }));
}

function parseBody(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
}

/** What a Worker response says, as an attempt's result. */
export function readWorkerQuote(response: RawResponse): AttemptResult {
  const parsed = parseBody(response.body);
  if (response.status === 200 && isQuoteEnvelope(parsed)) return { ok: true, quote: parsed };
  if (isErrorEnvelope(parsed)) {
    const { code, suggestions } = parsed.error;
    const retryAfter = retryAfterSeconds(response.retryAfter, parsed.error.retryAfter);
    const failure: MarketFailure = {
      code,
      ...(retryAfter === undefined ? {} : { retryAfter }),
      ...(suggestions === undefined ? {} : { suggestions: suggestions.slice(0, 5) }),
    };
    // A 5xx is worth one more try unless the Worker asked for a longer pause (503 says 30 s).
    const fast = response.status >= 500 && (retryAfter === undefined || retryAfter * 1000 <= MARKET_LIMITS.maxRetryAfterMs);
    return { ok: false, failure, fast, ...(retryAfter === undefined ? {} : { retryAfterMs: retryAfter * 1000 }) };
  }
  // Not the Worker talking: an error page from the platform in front of it (Cloudflare's 1027
  // when the day's quota is spent, say), or a body cut short.
  if (response.status === 429) {
    const retryAfter = retryAfterSeconds(response.retryAfter);
    return {
      ok: false,
      failure: { code: 'rate_limited', ...(retryAfter === undefined ? {} : { retryAfter }) },
      fast: false,
      ...(retryAfter === undefined ? {} : { retryAfterMs: retryAfter * 1000 }),
    };
  }
  return { ok: false, failure: { code: response.status === 403 ? 'origin_not_allowed' : 'upstream_unavailable' }, fast: response.status !== 403 };
}

function workerAttempt(base: string, symbol: string, range: Range): Attempt {
  const url = `${base}${STOCK_API_PATHS.quote}?symbol=${encodeURIComponent(symbol)}&range=${range}`;
  return async (signal, timeoutMs) => {
    try {
      return readWorkerQuote(await getRaw(url, signal, timeoutMs));
    } catch (error) {
      return failedAttempt(error, signal);
    }
  };
}

// ── Saved copies ───────────────────────────────────────────────────────────────────────────

interface SavedQuote {
  readonly savedAt: number;
  readonly quote: QuoteEnvelope;
}

interface Stored {
  readonly v: 1;
  /** Newest first. */
  readonly quotes: readonly SavedQuote[];
  /** Newest first. */
  readonly recents: readonly string[];
}

const EMPTY: Stored = { v: 1, quotes: [], recents: [] };

function readStored(raw: unknown): Stored | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const { v, quotes, recents } = raw as Record<string, unknown>;
  if (v !== 1 || !Array.isArray(quotes) || !Array.isArray(recents)) return undefined;
  return {
    v: 1,
    quotes: quotes.filter(
      (entry): entry is SavedQuote =>
        typeof entry === 'object' &&
        entry !== null &&
        Number.isFinite((entry as SavedQuote).savedAt) &&
        isQuoteEnvelope((entry as SavedQuote).quote),
    ),
    recents: recents.filter((symbol): symbol is string => typeof symbol === 'string' && symbol.length <= 16),
  };
}

/** A quote small enough to keep: its chart cut to a few dozen points. */
function forSaving(quote: QuoteEnvelope): QuoteEnvelope {
  const series = quote.series;
  if (series === null || series.points.length <= MARKET_LIMITS.savedPoints) return quote;
  return { ...quote, series: { ...series, points: downsample(series.points, MARKET_LIMITS.savedPoints) } };
}

class SavedQuotes {
  /** What this page has written, so a browser that blocks storage still keeps it for the session. */
  private memory: Stored = EMPTY;

  constructor(private readonly kv: KV<'local'> | null) {}

  private read(): Stored {
    if (this.kv === null) return this.memory;
    try {
      return this.kv.getJson(STORAGE_KEYS.stock.key, readStored) ?? this.memory;
    } catch {
      return this.memory;
    }
  }

  private write(next: Stored): void {
    this.memory = next;
    try {
      this.kv?.setJson(STORAGE_KEYS.stock.key, next);
    } catch {
      // Kept in memory for the page.
    }
  }

  /** The last good copy of `symbol`, or of what it resolved to (CBA → CBA.AX). */
  get(symbol: string, now: number): SavedQuote | null {
    const found = this.read().quotes.find((entry) => entry.quote.symbol === symbol || entry.quote.resolvedFrom === symbol);
    return found && now - found.savedAt <= MARKET_LIMITS.savedMaxAgeMs ? found : null;
  }

  save(quote: QuoteEnvelope, now: number): void {
    const stored = this.read();
    const quotes = [{ savedAt: now, quote: forSaving(quote) }, ...stored.quotes.filter((entry) => entry.quote.symbol !== quote.symbol)];
    this.write({ ...stored, quotes: quotes.slice(0, MARKET_LIMITS.savedQuotes) });
  }

  remember(symbol: string): void {
    const stored = this.read();
    const recents = [symbol, ...stored.recents.filter((seen) => seen !== symbol)].slice(0, MARKET_LIMITS.recents);
    this.write({ ...stored, recents });
  }

  recents(): readonly string[] {
    return this.read().recents;
  }
}

// ── The client ─────────────────────────────────────────────────────────────────────────────

interface Lookup {
  readonly quote: QuoteEnvelope;
}

export function createMarketClient(options: MarketClientOptions = {}): Market {
  const base = options.baseUrl === undefined ? stockApiBase() : options.baseUrl === null ? null : stockApiBase(options.baseUrl);
  const backend: MarketBackend = base === null ? 'interim' : 'worker';
  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;
  const online = options.online ?? isOnline;
  const saved = new SavedQuotes(options.storage ?? null);
  const memo: Memo = createMemo({ now, failureCooldownMs: MARKET_LIMITS.failureCooldownMs });

  const attemptFor = (symbol: string, range: Range): Attempt =>
    base === null ? (signal, timeoutMs) => interimAttempt(symbol, range, signal, timeoutMs, () => Math.floor(now() / 1000)) : workerAttempt(base, symbol, range);

  /**
   * One request, and at most one more: after a fast failure with time to spare, or after a
   * Retry-After of 3 s or less. `deadline` is in now() time.
   */
  async function withRetry(attempt: Attempt, deadline: number, signal: AbortSignal, onRetry: () => void): Promise<AttemptResult> {
    let tries = 0;
    for (;;) {
      tries += 1;
      const left = deadline - now();
      if (left < MARKET_LIMITS.minAttemptMs) return { ok: false, failure: { code: 'timeout' }, fast: false };
      const budget = new AbortController();
      const timer = setTimeout(() => budget.abort(new AttemptTimeout()), Math.min(MARKET_LIMITS.attemptMs, left));
      const started = now();
      let result: AttemptResult;
      try {
        result = await attempt(combineSignals(signal, budget.signal), Math.min(MARKET_LIMITS.attemptMs, left));
      } finally {
        clearTimeout(timer);
      }
      if (result.ok === true || tries > 1 || signal.aborted) return result;

      const remaining = deadline - now();
      let wait: number | null = null;
      if (result.failure.code === 'rate_limited') {
        const asked = result.retryAfterMs;
        if (asked !== undefined && asked <= MARKET_LIMITS.maxRetryAfterMs && remaining - asked >= MARKET_LIMITS.minAttemptMs * 4) wait = asked;
      } else if (result.fast && now() - started <= MARKET_LIMITS.fastFailureMs && remaining >= MARKET_LIMITS.retryNeedsMs) {
        wait = result.retryAfterMs ?? MARKET_LIMITS.retryBaseMs + Math.floor(random() * MARKET_LIMITS.retryJitterMs);
      }
      if (wait === null) return result;
      if (!(await pause(wait, signal))) return { ok: false, failure: { code: 'cancelled' }, fast: false };
      onRetry();
    }
  }

  /** The live lookup, shared by everyone asking for the same quote at once. Throws LookupFailed. */
  async function load(symbol: string, range: Range, budgetMs: number, onRetry: () => void): Promise<Lookup> {
    // Shared, so it does not stop for one caller's ^C; each caller stops waiting on its own.
    const never = new AbortController().signal;
    const deadline = now() + budgetMs;
    const first = await withRetry(attemptFor(symbol, range), deadline, never, onRetry);
    if (first.ok === true) return { quote: first.quote };
    if (first.failure.code !== 'not_found' || base !== null) throw new LookupFailed(first.failure);

    // The Worker resolves names itself; the interim proxy needs the short list of known names.
    const target = resolveLocal(symbol);
    if (target === null) {
      throw new LookupFailed({ code: 'not_found', suggestions: suggestLocal(symbol) });
    }
    const second = await withRetry(attemptFor(target.symbol, range), deadline, never, onRetry);
    if (second.ok === false) throw new LookupFailed(second.failure);
    return { quote: { ...second.quote, resolvedFrom: symbol } };
  }

  /** The Worker's copy of a curated ticker, for when the quote route fails. */
  async function snapshotQuote(symbol: string, deadline: number, signal: AbortSignal): Promise<QuoteEnvelope | null> {
    if (base === null || !(CURATED_SYMBOLS as readonly string[]).includes(symbol)) return null;
    const left = Math.min(MARKET_LIMITS.attemptMs, deadline - now());
    if (left < 1000 || signal.aborted) return null;
    try {
      const envelope = await memo('snapshot', 60_000, async () => {
        const response = await getRaw(`${base}${STOCK_API_PATHS.snapshot}`, new AbortController().signal, left);
        const parsed = parseBody(response.body);
        if (response.status !== 200 || !isSnapshotEnvelope(parsed)) throw new LookupFailed({ code: 'upstream_unavailable' });
        return parsed;
      });
      return envelope.quotes.find((quote) => quote.symbol === symbol) ?? null;
    } catch {
      return null;
    }
  }

  /** Waits for `promise`, or gives up as soon as `signal` aborts. */
  function untilCancelled<T>(promise: Promise<T>, signal: AbortSignal): Promise<T | typeof CANCELLED> {
    if (signal.aborted) return Promise.resolve(CANCELLED);
    return new Promise((resolve, reject) => {
      const onAbort = (): void => resolve(CANCELLED);
      signal.addEventListener('abort', onAbort, { once: true });
      promise.then(
        (value) => {
          signal.removeEventListener('abort', onAbort);
          resolve(value);
        },
        (error: unknown) => {
          signal.removeEventListener('abort', onAbort);
          reject(error);
        },
      );
    });
  }

  async function quote(symbol: string, range: Range, opts: QuoteOptions = {}): Promise<QuoteOutcome> {
    const signal = opts.signal ?? new AbortController().signal;
    const budgetMs = opts.budgetMs ?? MARKET_LIMITS.budgetMs;
    const deadline = now() + budgetMs;
    const cancelled: QuoteOutcome = { ok: false, error: { code: 'cancelled' } };
    if (signal.aborted) return cancelled;

    const fallback = async (failure: MarketFailure): Promise<QuoteOutcome> => {
      if (signal.aborted) return cancelled;
      if (TRANSIENT.has(failure.code)) {
        const copy = saved.get(symbol, now());
        if (copy) return { ok: true, quote: copy.quote, freshness: 'saved', savedAt: copy.savedAt, reason: failure.code, via: backend };
        if (failure.code !== 'offline') {
          const snapshot = await snapshotQuote(symbol, deadline, signal);
          if (snapshot) return { ok: true, quote: snapshot, freshness: 'saved', savedAt: snapshot.fetchedAt * 1000, reason: failure.code, via: backend };
        }
      }
      return { ok: false, error: failure };
    };

    if (!online()) return fallback({ code: 'offline' });

    const key = `quote:${symbol}:${range}`;
    if (opts.force === true) memo.forget(key);

    // The status line hears when this is slower than usual.
    const timers = [
      setTimeout(() => opts.onPhase?.('slow', 1), MARKET_LIMITS.slowAfterMs),
      setTimeout(() => opts.onPhase?.('very-slow', 1), MARKET_LIMITS.verySlowAfterMs),
    ];
    let started = false;
    try {
      const shared = memo(key, MARKET_LIMITS.memoryMs, () => {
        started = true;
        return load(symbol, range, budgetMs, () => opts.onPhase?.('retry', 2));
      });
      const result = await untilCancelled(shared, signal);
      if (result === CANCELLED) return cancelled;
      saved.remember(result.quote.symbol);
      if (started) saved.save(result.quote, now());
      return { ok: true, quote: result.quote, freshness: started ? 'live' : 'memory', via: backend };
    } catch (error) {
      if (signal.aborted) return cancelled;
      return fallback(error instanceof LookupFailed ? error.failure : { code: 'internal' });
    } finally {
      for (const timer of timers) clearTimeout(timer);
    }
  }

  async function search(query: string, opts: { readonly signal?: AbortSignal } = {}): Promise<SearchOutcome> {
    const local = (): SearchOutcome => ({ ok: true, hits: searchLocal(query), from: 'local' });
    if (base === null) return local();
    const signal = opts.signal ?? new AbortController().signal;
    if (!online()) return { ok: false, error: { code: 'offline' } };
    const url = `${base}${STOCK_API_PATHS.search}?q=${encodeURIComponent(query)}&limit=6`;
    try {
      const response = await getRaw(url, signal, MARKET_LIMITS.attemptMs);
      const parsed = parseBody(response.body);
      if (response.status === 200 && isSearchEnvelope(parsed)) return { ok: true, hits: parsed.hits.slice(0, 6), from: 'worker' };
      if (isErrorEnvelope(parsed) && (parsed.error.code === 'origin_not_allowed' || parsed.error.code === 'bad_request')) {
        return { ok: false, error: { code: parsed.error.code } };
      }
      return localOr(local(), 'upstream_unavailable');
    } catch (error) {
      const { code } = failureFromError(error, signal);
      if (code === 'cancelled') return { ok: false, error: { code } };
      return localOr(local(), code);
    }
  }

  return {
    backend,
    quote,
    search,
    recent: () => saved.recents(),
  };
}

/** The known names when the Worker's search failed, or the failure when they have nothing. */
function localOr(local: SearchOutcome, code: FailureCode): SearchOutcome {
  return local.ok === true && local.hits.length > 0 ? local : { ok: false, error: { code } };
}

export type { Attempt, AttemptResult, SearchHit };
