// Token buckets kept in the isolate's memory. Cloudflare runs many isolates, so a limit here is
// per isolate rather than global; that is enough to stop one visitor or a loop hammering the
// upstreams, and the free plan's daily request cap bounds the rest.

export interface LimitResult {
  readonly ok: boolean;
  /** Whole seconds until one more request would be allowed; 0 when `ok`. */
  readonly retryAfterSec: number;
}

export interface BucketOptions {
  /** Requests allowed in a burst. */
  readonly capacity: number;
  /** Seconds it takes to refill from empty to `capacity`. */
  readonly periodSec: number;
  /** Keys remembered at once; the least recently used is dropped first. */
  readonly maxKeys?: number;
}

interface Bucket {
  tokens: number;
  updatedMs: number;
}

export class TokenBucketLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly capacity: number;
  private readonly ratePerMs: number;
  private readonly maxKeys: number;

  constructor(options: BucketOptions) {
    this.capacity = options.capacity;
    this.ratePerMs = options.capacity / (options.periodSec * 1000);
    this.maxKeys = options.maxKeys ?? 10_000;
  }

  take(key: string, nowMs: number): LimitResult {
    const capacity = this.capacity;
    const previous = this.buckets.get(key);
    const tokens = previous
      ? Math.min(capacity, previous.tokens + Math.max(0, nowMs - previous.updatedMs) * this.ratePerMs)
      : capacity;

    // Re-inserting keeps the Map in least-recently-used order, so eviction drops idle keys.
    this.buckets.delete(key);
    if (tokens >= 1) {
      this.buckets.set(key, { tokens: tokens - 1, updatedMs: nowMs });
      this.evict();
      return { ok: true, retryAfterSec: 0 };
    }
    this.buckets.set(key, { tokens, updatedMs: nowMs });
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((1 - tokens) / this.ratePerMs / 1000)) };
  }

  get size(): number {
    return this.buckets.size;
  }

  private evict(): void {
    while (this.buckets.size > this.maxKeys) {
      const oldest = this.buckets.keys().next();
      if (oldest.done) return;
      this.buckets.delete(oldest.value);
    }
  }
}

/** Per-IP limits for each kind of request, and per-provider limits that protect the upstreams. */
export const LIMITS = {
  quote: { capacity: 30, periodSec: 60 },
  search: { capacity: 20, periodSec: 60 },
  /** Requests with no Origin header: curl, scripts and the canary. */
  anonymous: { capacity: 10, periodSec: 60 },
  upstream: { capacity: 100, periodSec: 60, maxKeys: 16 },
} as const satisfies Record<string, BucketOptions>;
