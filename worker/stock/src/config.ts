// Settings read from wrangler.toml vars and secrets, with safe defaults for each.

import type { ProviderId } from './contract';
import { originPolicy, type OriginPolicy } from './cors';
import type { Env } from './env';

export const WORKER_VERSION = '1.0.0';

export const DEFAULT_USER_AGENT = 'Mozilla/5.0 (compatible; vesen-stock/1.0; +https://www.vesen.app)';

export const DEFAULT_ALLOWED_ORIGINS = [
  'https://www.vesen.app',
  'https://vesen.app',
  'https://vesenterminal--*.web.app',
  'http://localhost:*',
  'http://127.0.0.1:*',
].join(',');

export const DEFAULT_PROVIDER_ORDER: readonly ProviderId[] = ['yahoo', 'cboe'];

export interface WorkerConfig {
  readonly origins: OriginPolicy;
  /** Providers in the order they are tried. Finnhub is present only when its key is set. */
  readonly providers: readonly ProviderId[];
  /** Yahoo answers 429 to curl's and full browser User-Agents, but 200 to a short honest one. */
  readonly userAgent: string;
  readonly finnhubKey: string | null;
  readonly version: string;
}

const KNOWN_PROVIDERS: readonly ProviderId[] = ['yahoo', 'cboe', 'finnhub'];

export function providerOrder(raw: string | undefined, hasFinnhubKey: boolean): ProviderId[] {
  const listed = (raw ?? '')
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter((name): name is ProviderId => (KNOWN_PROVIDERS as readonly string[]).includes(name));
  const order = [...new Set(listed.length > 0 ? listed : DEFAULT_PROVIDER_ORDER)];
  if (hasFinnhubKey && !order.includes('finnhub')) order.push('finnhub');
  return hasFinnhubKey ? order : order.filter((id) => id !== 'finnhub');
}

export function configFromEnv(env: Env): WorkerConfig {
  const finnhubKey = env.FINNHUB_KEY?.trim() || null;
  const userAgent = env.UPSTREAM_UA?.trim() ?? '';
  return {
    origins: originPolicy(env.ALLOWED_ORIGINS?.trim() || DEFAULT_ALLOWED_ORIGINS),
    providers: providerOrder(env.PROVIDER_ORDER, finnhubKey !== null),
    userAgent: /^[\x20-\x7e]{1,200}$/.test(userAgent) ? userAgent : DEFAULT_USER_AGENT,
    finnhubKey,
    version: WORKER_VERSION,
  };
}
