// Recorded upstream bodies (see ../fixtures/README.md) and a fake fetch that serves them, so no
// test touches the network.
import { existsSync, readFileSync } from 'node:fs';
import type { FetchLike } from '../../src/upstream';

const FIXTURES = new URL('../fixtures/', import.meta.url);

export function fixture(name: string): string {
  return readFileSync(new URL(name, FIXTURES), 'utf8');
}

export function fixtureJson(name: string): unknown {
  return JSON.parse(fixture(name)) as unknown;
}

function hasFixture(name: string): boolean {
  return existsSync(new URL(name, FIXTURES));
}

/** The file-name slug of a symbol: CBA.AX → cba-ax, ^AXJO → axjo, AUDUSD=X → audusd-x. */
export function slug(symbol: string): string {
  return symbol.toLowerCase().replace(/^\^/, '').replace(/[.=]/g, '-');
}

export function chartFixture(symbol: string, range = '1d'): string {
  return `yahoo-chart-${slug(symbol)}-${range}.json`;
}

const json = (body: string, status = 200): Response =>
  new Response(body, { status, headers: { 'content-type': 'application/json;charset=utf-8' } });

/** What the recorded upstreams answer for `url`. */
export function recorded(url: URL): Response {
  if (url.hostname === 'query1.finance.yahoo.com' || url.hostname === 'query2.finance.yahoo.com') {
    const chart = /^\/v8\/finance\/chart\/([^/]+)$/.exec(url.pathname);
    if (chart?.[1] !== undefined) {
      const name = chartFixture(decodeURIComponent(chart[1]), url.searchParams.get('range') ?? '1d');
      return hasFixture(name) ? json(fixture(name)) : json(fixture('yahoo-chart-zzzzqq-404.json'), 404);
    }
    if (url.pathname === '/v1/finance/search') {
      const name = `yahoo-search-${(url.searchParams.get('q') ?? '').toLowerCase().replace(/\s+/g, '-')}.json`;
      return json(fixture(hasFixture(name) ? name : 'yahoo-search-zzzzqq.json'));
    }
  }
  if (url.hostname === 'cdn-api.cboe.com') {
    const quote = /^\/api\/global\/delayed_quotes\/quotes\/([^/]+)\.json$/.exec(url.pathname);
    const name = quote?.[1] !== undefined ? `cboe-quote-${quote[1].toLowerCase().replace(/^_/, '')}.json` : '';
    if (name !== '' && hasFixture(name)) return json(fixture(name));
    return new Response(fixture('cboe-quote-cba-403.xml'), { status: 403, headers: { 'content-type': 'application/xml' } });
  }
  if (url.hostname === 'finnhub.io') return json(fixture('finnhub-quote-401.json'), 401);
  return new Response('not recorded', { status: 599 });
}

export type Override = (url: URL, init: RequestInit | undefined) => Response | Promise<Response> | undefined;

export interface FakeUpstream {
  readonly fetch: FetchLike;
  /** Every URL requested, in order. */
  readonly calls: string[];
  /** Answers before the recordings; the latest override wins. Return undefined to fall through. */
  use(override: Override): void;
  /** Headers sent with each request, in order. */
  readonly headers: Array<Record<string, string>>;
  hosts(): Set<string>;
}

export function fakeUpstream(): FakeUpstream {
  const calls: string[] = [];
  const headers: Array<Record<string, string>> = [];
  const overrides: Override[] = [];
  return {
    calls,
    headers,
    use(override) {
      overrides.unshift(override);
    },
    hosts: () => new Set(calls.map((call) => new URL(call).hostname)),
    async fetch(input, init) {
      calls.push(input);
      headers.push(Object.fromEntries(new Headers(init?.headers).entries()));
      const url = new URL(input);
      for (const override of overrides) {
        const answer = await override(url, init);
        if (answer) return answer;
      }
      return recorded(url);
    },
  };
}

/** Answers like a host that never replies, until the request's signal aborts. */
export function hang(_url: URL, init: RequestInit | undefined): Promise<Response> {
  return new Promise((_, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
  });
}

export const isYahooChart = (url: URL): boolean => url.hostname.endsWith('.finance.yahoo.com') && url.pathname.startsWith('/v8/');
