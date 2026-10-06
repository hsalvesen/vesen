// The few Cloudflare runtime types the Worker uses, declared locally so it type-checks without
// installing @cloudflare/workers-types. They are module-scoped and structural: the real runtime
// objects satisfy them, and they never clash with the official declarations if those are added.

export interface KVNamespace {
  get(key: string, type: 'text'): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number; metadata?: unknown }): Promise<void>;
  list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<{
    keys: Array<{ name: string; expiration?: number; metadata?: unknown }>;
    list_complete: boolean;
    cursor?: string;
  }>;
}

/** What a cron trigger passes to `scheduled()` (Cloudflare calls it ScheduledController). */
export interface ScheduledEvent {
  readonly scheduledTime: number;
  readonly cron: string;
}

export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

/** Bindings and vars from wrangler.toml, plus the optional FINNHUB_KEY secret. */
export interface Env {
  readonly SNAPSHOT?: KVNamespace;
  readonly ALLOWED_ORIGINS?: string;
  readonly PROVIDER_ORDER?: string;
  readonly UPSTREAM_UA?: string;
  readonly FINNHUB_KEY?: string;
}
