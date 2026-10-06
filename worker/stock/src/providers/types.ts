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

export type Rec = Readonly<Record<string, unknown>>;

export function isRecord(value: unknown): value is Rec {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A finite number, or null. Missing, NaN and non-numbers all become null, never 0. */
export function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** A finite positive number, or null: volume 0 means "not reported" for indices and FX. */
export function positive(value: unknown): number | null {
  const n = num(value);
  return n !== null && n > 0 ? n : null;
}

/**
 * Display text from an upstream: control and bidirectional-override characters removed (so a
 * name cannot reorder the text around it), spaces collapsed, length capped.
 */
export function text(value: unknown, max = 120): string | null {
  if (typeof value !== 'string') return null;
  const clean = value
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/[‎‏‪-‮⁦-⁩]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return clean === '' ? null : clean.slice(0, max);
}

export function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** US-listed common stock or ETF symbols, which Cboe and Finnhub can answer: AAPL, BRK-B. */
export function isUsListed(symbol: string): boolean {
  return /^[A-Z]{1,5}(?:-[A-Z])?$/.test(symbol);
}
