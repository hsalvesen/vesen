// An in-isolate cache with request coalescing and stale-if-error. The Cache API does nothing on
// workers.dev, so this Map is the only cache until vesen.app's DNS moves to Cloudflare.

import type { MarketPhase } from './contract';

export interface CacheHit<T> {
  readonly value: T;
  readonly fresh: boolean;
  readonly storedAt: number;
}

export interface Lifetime {
  /** Milliseconds the value is served as fresh. */
  readonly freshMs: number;
  /** Milliseconds after storing that the value may still be served when every source fails. */
  readonly staleMs: number;
}

interface Entry<T> {
  readonly value: T;
  readonly storedAt: number;
  readonly freshUntil: number;
  readonly staleUntil: number;
}

export class TtlCache<T> {
  private readonly entries = new Map<string, Entry<T>>();
  private readonly inflight = new Map<string, Promise<unknown>>();
  private readonly maxEntries: number;

  constructor(maxEntries = 500) {
    this.maxEntries = maxEntries;
  }

  /** The value for `key`, fresh or stale, or null once it is past its stale lifetime. */
  get(key: string, nowMs: number): CacheHit<T> | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (nowMs >= entry.staleUntil) {
      this.entries.delete(key);
      return null;
    }
    // Re-inserting keeps the Map in least-recently-used order for eviction.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return { value: entry.value, fresh: nowMs < entry.freshUntil, storedAt: entry.storedAt };
  }

  set(key: string, value: T, nowMs: number, lifetime: Lifetime): void {
    this.entries.delete(key);
    this.entries.set(key, {
      value,
      storedAt: nowMs,
      freshUntil: nowMs + lifetime.freshMs,
      staleUntil: nowMs + Math.max(lifetime.freshMs, lifetime.staleMs),
    });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  /**
   * Runs `load` once for concurrent callers with the same key: the second request for AAPL while
   * the first is still upstream waits for the same answer instead of making a second call.
   */
  coalesce<R>(key: string, load: () => Promise<R>): Promise<R> {
    const running = this.inflight.get(key);
    if (running) return running as Promise<R>;
    const promise = load().finally(() => this.inflight.delete(key));
    this.inflight.set(key, promise);
    return promise;
  }

  get size(): number {
    return this.entries.size;
  }
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

/** Stale copies are served for up to a day when every source fails. */
export const STALE_IF_ERROR_MS = 24 * HOUR;

/** 60 s while a market moves (open, or crypto and FX around the clock), 300 s otherwise. */
export function quoteLifetime(phase: MarketPhase): Lifetime {
  const moving = phase === 'open' || phase === 'always_open' || phase === 'unknown';
  return { freshMs: (moving ? 60 : 300) * SECOND, staleMs: STALE_IF_ERROR_MS };
}

export const LIFETIMES = {
  search: { freshMs: HOUR, staleMs: STALE_IF_ERROR_MS },
  /** A name that resolved to a ticker (`CBA` → CBA.AX). */
  resolution: { freshMs: 24 * HOUR, staleMs: 24 * HOUR },
  /** A symbol the upstream said does not exist. */
  notFound: { freshMs: 10 * MINUTE, staleMs: 10 * MINUTE },
  /** The snapshot read from KV, so each isolate reads it at most once a minute. */
  snapshot: { freshMs: MINUTE, staleMs: MINUTE },
} as const satisfies Record<string, Lifetime>;
