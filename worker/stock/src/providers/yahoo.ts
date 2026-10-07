// Yahoo Finance v8 chart: the primary source for every market. Unofficial and unauthenticated;
// it answers a short, honest User-Agent and rate-limits browser-like ones, so the Worker rotates
// between query1 and query2 and backs off a host for a minute after a 429.
//
// The normaliser is shared with the app's interim provider (src/services/market/normalise.ts).

import { chartUrl, normaliseYahooChart } from '../normalise';
import { getText, parseJson } from '../upstream';
import { coolDown, coolingDown, type ProviderContext, type QuoteProvider } from './types';

export { chartUrl, normaliseYahooChart };

export const YAHOO_HOSTS = [
  { host: 'query1.finance.yahoo.com', timeoutMs: 3000 },
  { host: 'query2.finance.yahoo.com', timeoutMs: 2500 },
] as const;

export const yahooProvider: QuoteProvider = {
  id: 'yahoo',
  supports: () => true,
  async quote(symbol, range, ctx) {
    let rateLimited = false;
    let detail = 'no host available';
    for (const { host, timeoutMs } of YAHOO_HOSTS) {
      if (coolingDown(ctx, host)) {
        rateLimited = true;
        detail = `${host} is cooling down after a 429`;
        continue;
      }
      const response = await getText(chartUrl(host, symbol, range), ctx, { timeoutMs });
      if (!response.ok) {
        detail = `${host}: ${response.reason}`;
        if (response.reason === 'no_time') break;
        continue;
      }
      if (response.status === 429) {
        coolDown(ctx, host);
        rateLimited = true;
        detail = `${host}: HTTP 429`;
        continue;
      }
      if (response.status === 200 || response.status === 404) {
        const result = normaliseYahooChart(parseJson(response.body), symbol, range, nowSec(ctx));
        if (result.ok || result.kind === 'not_found') return result;
        detail = `${host}: ${result.detail}`;
        continue;
      }
      detail = `${host}: HTTP ${response.status}`;
    }
    return { ok: false, kind: rateLimited ? 'rate_limited' : 'unavailable', detail };
  },
};

function nowSec(ctx: ProviderContext): number {
  return Math.floor(ctx.now() / 1000);
}
