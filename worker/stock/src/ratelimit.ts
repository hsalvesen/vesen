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

/** The eight 16-bit groups of an IPv6 address, or null when it is not one. */
function ipv6Groups(address: string): number[] | null {
  let text = address.trim().toLowerCase();
  const zone = text.indexOf('%');
  if (zone !== -1) text = text.slice(0, zone);
  // A dotted IPv4 tail (::ffff:192.0.2.1) is the last two groups.
  const tail = /^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (tail) {
    const bytes = tail.slice(2).map(Number);
    if (bytes.some((byte) => byte > 255)) return null;
    const [a = 0, b = 0, c = 0, d = 0] = bytes;
    text = `${tail[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const split = (part: string | undefined): string[] => (part ? part.split(':') : []);
  const head = split(halves[0]);
  const rest = split(halves[1]);
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...rest];
  if (!groups.every((group) => /^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.map((group) => Number.parseInt(group, 16));
}

/**
 * The key a client's requests are counted under: an IPv4 address as it is, and an IPv6 address
 * by its /64. A single IPv6 client normally holds a whole /64 and could take a fresh bucket for
 * every request from a new address in it. An IPv4-mapped IPv6 address counts as its IPv4 address.
 */
export function rateLimitKey(ip: string): string {
  if (!ip.includes(':')) return ip;
  const groups = ipv6Groups(ip);
  if (groups === null) return ip;
  const [g0, g1, g2, g3, g4, g5, g6 = 0, g7 = 0] = groups;
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff) {
    return `${g6 >> 8}.${g6 & 0xff}.${g7 >> 8}.${g7 & 0xff}`;
  }
  return `${groups
    .slice(0, 4)
    .map((group) => group.toString(16))
    .join(':')}::/64`;
}

/** Per-client limits for each kind of request, and per-provider limits that protect the upstreams. */
export const LIMITS = {
  quote: { capacity: 30, periodSec: 60 },
  search: { capacity: 20, periodSec: 60 },
  /** Requests with no Origin header: curl, scripts and the canary. */
  anonymous: { capacity: 10, periodSec: 60 },
  upstream: { capacity: 100, periodSec: 60, maxKeys: 16 },
} as const satisfies Record<string, BucketOptions>;
