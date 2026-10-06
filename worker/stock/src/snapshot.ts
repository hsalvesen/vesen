// The curated snapshot: every 15 minutes a cron fetches the CURATED_SYMBOLS and writes one JSON
// value to KV, so the example chips always have a recent copy even when the providers fail.
// When KV is empty or unbound, a copy built into the Worker (recorded on 6 October 2026, and
// always marked stale) answers instead.

import { LIFETIMES } from './cache';
import {
  CURATED_SYMBOLS,
  STOCK_API_VERSION,
  isSnapshotEnvelope,
  type QuoteEnvelope,
  type Range,
  type SnapshotEnvelope,
} from './contract';
import type { KVNamespace } from './env';
import { asStale, fetchFromProviders, providerContext, withCurrentPhase, type ServiceDeps } from './service';
import builtinJson from './snapshot-builtin.json';

export const SNAPSHOT_KEY = 'snapshot:v1';

/** Two missed cron runs and the copy counts as outdated. */
export const SNAPSHOT_OUTDATED_SEC = 30 * 60;

/** Kept copies older than this are dropped rather than carried forward. */
const SNAPSHOT_MAX_AGE_SEC = 7 * 24 * 60 * 60;

const CONCURRENCY = 3;

export interface SnapshotStore {
  read(): Promise<SnapshotEnvelope | null>;
  write(snapshot: SnapshotEnvelope): Promise<void>;
}

export function kvSnapshotStore(kv: KVNamespace): SnapshotStore {
  return {
    async read() {
      const raw = await kv.get(SNAPSHOT_KEY, 'text');
      if (raw === null) return null;
      try {
        const parsed: unknown = JSON.parse(raw);
        return isSnapshotEnvelope(parsed) ? parsed : null;
      } catch {
        return null;
      }
    },
    async write(snapshot) {
      await kv.put(SNAPSHOT_KEY, JSON.stringify(snapshot));
    },
  };
}

let builtinCache: SnapshotEnvelope | null | undefined;

/** The copy shipped inside the Worker, or null if it ever stops matching the contract. */
export function builtinSnapshot(): SnapshotEnvelope | null {
  if (builtinCache === undefined) {
    const parsed: unknown = builtinJson;
    builtinCache = isSnapshotEnvelope(parsed) ? parsed : null;
  }
  return builtinCache;
}

export interface RefreshReport {
  readonly written: boolean;
  readonly refreshed: readonly string[];
  readonly failed: readonly string[];
}

/** Fetches every curated symbol and merges the results over the previous copy. */
export async function buildSnapshot(
  deps: ServiceDeps,
  previous: SnapshotEnvelope | null,
): Promise<{ snapshot: SnapshotEnvelope; refreshed: string[]; failed: string[] }> {
  const nowSec = Math.floor(deps.now() / 1000);
  const kept = new Map((previous?.quotes ?? []).filter((q) => nowSec - q.fetchedAt < SNAPSHOT_MAX_AGE_SEC).map((q) => [q.symbol, q]));
  const fresh = new Map<string, QuoteEnvelope>();
  const metrics = { upstreamMs: 0, calls: 0 };

  const queue = [...CURATED_SYMBOLS];
  const worker = async (): Promise<void> => {
    for (let symbol = queue.shift(); symbol !== undefined; symbol = queue.shift()) {
      const result = await fetchFromProviders(symbol, '1d', deps, providerContext(deps, metrics));
      if (result.ok) {
        fresh.set(symbol, { ...result.quote, source: 'snapshot', stale: false, staleReason: null, resolvedFrom: null });
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const quotes: QuoteEnvelope[] = [];
  const missing: string[] = [];
  for (const symbol of CURATED_SYMBOLS) {
    const quote = fresh.get(symbol) ?? kept.get(symbol);
    if (quote) quotes.push(quote);
    else missing.push(symbol);
  }
  return {
    snapshot: { v: STOCK_API_VERSION, kind: 'snapshot', generatedAt: nowSec, quotes, missing },
    refreshed: CURATED_SYMBOLS.filter((symbol) => fresh.has(symbol)),
    failed: CURATED_SYMBOLS.filter((symbol) => !fresh.has(symbol)),
  };
}

/** The scheduled job. It writes only when at least one quote is new, which keeps KV writes low. */
export async function refreshSnapshot(deps: ServiceDeps, store: SnapshotStore): Promise<RefreshReport> {
  const previous = await store.read().catch(() => null);
  const { snapshot, refreshed, failed } = await buildSnapshot(deps, previous);
  if (refreshed.length === 0) return { written: false, refreshed, failed };
  await store.write(snapshot);
  deps.state.snapshot.set(SNAPSHOT_KEY, snapshot, deps.now(), LIFETIMES.snapshot);
  return { written: true, refreshed, failed };
}

export type SnapshotOrigin = 'kv' | 'builtin';

/** The stored copy, read from KV at most once a minute per isolate, else the built-in one. */
export async function currentSnapshot(
  deps: ServiceDeps,
  store: SnapshotStore | null,
): Promise<{ snapshot: SnapshotEnvelope; origin: SnapshotOrigin } | null> {
  const cached = deps.state.snapshot.get(SNAPSHOT_KEY, deps.now());
  if (cached) return { snapshot: cached.value, origin: 'kv' };
  const stored = store ? await store.read().catch(() => null) : null;
  if (stored) {
    deps.state.snapshot.set(SNAPSHOT_KEY, stored, deps.now(), LIFETIMES.snapshot);
    return { snapshot: stored, origin: 'kv' };
  }
  const builtin = builtinSnapshot();
  return builtin ? { snapshot: builtin, origin: 'builtin' } : null;
}

/** A snapshot quote as /v1/snapshot serves it: dated honestly, phase recomputed, series dropped. */
export function deliverSnapshotQuote(quote: QuoteEnvelope, origin: SnapshotOrigin, nowMs: number): QuoteEnvelope {
  const ageSec = Math.floor(nowMs / 1000) - quote.fetchedAt;
  const reason = origin === 'builtin' ? 'snapshot_builtin' : ageSec > SNAPSHOT_OUTDATED_SEC ? 'snapshot_outdated' : null;
  const delivered = reason === null ? withCurrentPhase(quote, nowMs) : asStale(quote, reason, nowMs);
  return { ...delivered, series: null };
}

export function deliverSnapshot(snapshot: SnapshotEnvelope, origin: SnapshotOrigin, nowMs: number): SnapshotEnvelope {
  return { ...snapshot, quotes: snapshot.quotes.map((quote) => deliverSnapshotQuote(quote, origin, nowMs)) };
}

/**
 * The last resort for /v1/quote when every provider failed and nothing is cached: the snapshot's
 * copy of a curated symbol. Its series covers 1d, so other ranges get the quote without a chart.
 */
export async function snapshotFallback(
  symbol: string,
  range: Range,
  deps: ServiceDeps,
  store: SnapshotStore | null,
): Promise<QuoteEnvelope | null> {
  const current = await currentSnapshot(deps, store);
  const quote = current?.snapshot.quotes.find((q) => q.symbol === symbol);
  if (!current || !quote) return null;
  const stale = asStale(quote, current.origin === 'builtin' ? 'snapshot_builtin' : 'upstream_unavailable', deps.now());
  return stale.series?.range === range ? stale : { ...stale, series: null };
}
