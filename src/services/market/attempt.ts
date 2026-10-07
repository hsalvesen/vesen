// One request for a quote, from either source, and how its failure reads: the pieces the client
// (client.ts) and the interim source (interim.ts) share.

import { isNetError } from '../net';
import type { QuoteEnvelope } from './contract';
import type { MarketFailure } from './port';

/** What one request came to, before retries and fallbacks. */
export type AttemptResult =
  | { readonly ok: true; readonly quote: QuoteEnvelope }
  | {
      readonly ok: false;
      readonly failure: MarketFailure;
      /** May be tried again at once: a failed connection, a 5xx, an unreadable body. */
      readonly fast: boolean;
      /** The server asked for a pause this long, in ms, before trying again. */
      readonly retryAfterMs?: number;
    };

/** One request under `signal`, within `timeoutMs`. */
export type Attempt = (signal: AbortSignal, timeoutMs: number) => Promise<AttemptResult>;

/** The reason the lookup's own deadline aborts an attempt with, as opposed to the visitor's cancel. */
export class AttemptTimeout extends Error {
  constructor() {
    super('out of time');
    this.name = 'AttemptTimeout';
  }
}

/** What a request that threw comes to: the visitor's cancel, the deadline, or the connection. */
export function failureFromError(error: unknown, signal: AbortSignal): MarketFailure & { readonly fast: boolean } {
  const outOfTime = signal.reason instanceof AttemptTimeout;
  if (signal.aborted && !outOfTime) return { code: 'cancelled', fast: false };
  if (isNetError(error)) {
    switch (error.kind) {
      case 'timeout':
        return { code: 'timeout', fast: false };
      case 'abort':
        return { code: outOfTime ? 'timeout' : 'cancelled', fast: false };
      case 'offline':
        return { code: 'offline', fast: false };
      case 'parse':
        return { code: 'upstream_unavailable', fast: true };
      case 'http':
        return { code: 'upstream_unavailable', fast: (error.status ?? 0) >= 500 };
      case 'cors':
      case 'network':
        return { code: 'network', fast: true };
    }
  }
  return outOfTime ? { code: 'timeout', fast: false } : { code: 'network', fast: true };
}

/** Seconds from a Retry-After header, else from the envelope; undefined when neither says (or it is a date). */
export function retryAfterSeconds(header: string | null | undefined, envelope?: number): number | undefined {
  const fromHeader = header != null && /^\s*\d+\s*$/.test(header) ? Number(header) : undefined;
  const value = fromHeader ?? envelope;
  return value !== undefined && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** A failed attempt from a request that threw. */
export function failedAttempt(error: unknown, signal: AbortSignal): AttemptResult {
  const { fast, ...failure } = failureFromError(error, signal);
  return { ok: false, failure, fast };
}
