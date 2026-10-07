import type { ProviderId, QuoteEnvelope, Range } from '../contract';
import type { UpstreamContext } from '../upstream';

/** What a provider found. `not_found` from Yahoo is authoritative and stops the chain. */
export type ProviderResult =
  | { readonly ok: true; readonly quote: QuoteEnvelope }
  | { readonly ok: false; readonly kind: 'not_found' | 'rate_limited' | 'unavailable'; readonly detail: string };

export interface ProviderContext extends UpstreamContext {
  /** Host → epoch ms until which it is skipped after answering 429. Lives as long as the isolate. */
  readonly cooldowns: Map<string, number>;
  readonly finnhubKey: string | null;
}

export interface QuoteProvider {
  readonly id: ProviderId;
  supports(symbol: string, range: Range): boolean;
  quote(symbol: string, range: Range, ctx: ProviderContext): Promise<ProviderResult>;
}

/** After a 429 a host is left alone for this long. */
export const COOLDOWN_MS = 60_000;

export function coolingDown(ctx: ProviderContext, host: string): boolean {
  const until = ctx.cooldowns.get(host);
  if (until === undefined) return false;
  if (ctx.now() < until) return true;
  ctx.cooldowns.delete(host);
  return false;
}

export function coolDown(ctx: ProviderContext, host: string): void {
  ctx.cooldowns.set(host, ctx.now() + COOLDOWN_MS);
}

// The checked-value helpers are shared with the chart normaliser.
export { isRecord, num, positive, round, text, type Rec } from '../normalise';

/** US-listed common stock or ETF symbols, which Cboe and Finnhub can answer: AAPL, BRK-B. */
export function isUsListed(symbol: string): boolean {
  return /^[A-Z]{1,5}(?:-[A-Z])?$/.test(symbol);
}
