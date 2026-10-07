// The interim source for `stock`, until the owned stock Worker is deployed: Yahoo Finance's v8
// chart, which sends no CORS header, read through the public api.allorigins.win proxy. It is slow
// and sometimes down, so every card it feeds says "via public proxy, may be slow", and the client
// gives it the same deadlines, retry and saved-copy fallback as the Worker. The proxy sees the
// ticker and the visitor's IP address; `privacy` says so while this is the source.
//
// The chart is normalised by the same code the Worker uses (normalise.ts), into the same
// QuoteEnvelope, marked as Yahoo's.

import { fetchAndRead } from '../net';
import type { Range } from './contract';
import { failedAttempt, retryAfterSeconds, type AttemptResult } from './attempt';
import { chartUrl, isRecord, normaliseYahooChart, num } from './normalise';

export const INTERIM_PROXY = 'https://api.allorigins.win/get';

/** The Yahoo host the proxy is asked to fetch. */
export const INTERIM_UPSTREAM = 'query1.finance.yahoo.com';

/** The proxy URL for one chart. */
export function interimUrl(symbol: string, range: Range): string {
  return `${INTERIM_PROXY}?url=${encodeURIComponent(chartUrl(INTERIM_UPSTREAM, symbol, range))}`;
}

function parse(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * What the proxy's answer says. It wraps Yahoo's response as `{ contents, status: { http_code } }`
 * and answers 200 even when Yahoo did not; its own failures (Cloudflare's 520 and 522) are quick
 * and worth one more try.
 */
export function readInterim(status: number, retryAfter: string | null, body: string, symbol: string, range: Range, nowSec: number): AttemptResult {
  if (status === 429) {
    const seconds = retryAfterSeconds(retryAfter);
    return {
      ok: false,
      failure: { code: 'rate_limited', ...(seconds === undefined ? {} : { retryAfter: seconds }) },
      fast: false,
      ...(seconds === undefined ? {} : { retryAfterMs: seconds * 1000 }),
    };
  }
  const unavailable: AttemptResult = { ok: false, failure: { code: 'upstream_unavailable' }, fast: status >= 500 || status === 200 };
  if (status !== 200) return unavailable;

  const envelope = parse(body);
  if (!isRecord(envelope)) return unavailable;
  const upstream = isRecord(envelope.status) ? num(envelope.status.http_code) : null;
  if (upstream === 429) return { ok: false, failure: { code: 'rate_limited' }, fast: false };
  const chart = typeof envelope.contents === 'string' ? parse(envelope.contents) : undefined;
  if (chart === undefined) return unavailable;

  const result = normaliseYahooChart(chart, symbol, range, nowSec);
  if (result.ok === true) return { ok: true, quote: result.quote };
  if (result.kind === 'not_found') return { ok: false, failure: { code: 'not_found' }, fast: false };
  return unavailable;
}

/** One chart through the proxy, within `timeoutMs`. */
export async function interimAttempt(
  symbol: string,
  range: Range,
  signal: AbortSignal,
  timeoutMs: number,
  nowSec: () => number,
): Promise<AttemptResult> {
  try {
    const response = await fetchAndRead(interimUrl(symbol, range), { signal, timeoutMs, throwHttpErrors: false }, async (r) => ({
      status: r.status,
      retryAfter: r.headers.get('retry-after'),
      body: await r.text(),
    }));
    return readInterim(response.status, response.retryAfter, response.body, symbol, range, nowSec());
  } catch (error) {
    return failedAttempt(error, signal);
  }
}
