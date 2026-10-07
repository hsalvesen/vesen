// stock's requests answered from the recorded Yahoo charts (worker/stock/test/fixtures), so no
// end-to-end test reaches a market: through the interim proxy, and through the stock Worker too
// when the build names one (VITE_STOCK_API, as CI may set it).
import { readFileSync } from 'node:fs';
import type { Page, Route } from '@playwright/test';
import type { Range } from '../src/services/market/contract';
import { normaliseYahooChart } from '../src/services/market/normalise';

const FIXTURES = new URL('../worker/stock/test/fixtures/', import.meta.url);

/** The recorded chart for a symbol and range, or Yahoo's 404 for one with no recording. */
function chart(symbol: string, range: string): { readonly body: string; readonly status: number } {
  const slug = symbol.toLowerCase().replace(/^\^/, '').replace(/[.=]/g, '-');
  try {
    return { body: readFileSync(new URL(`yahoo-chart-${slug}-${range}.json`, FIXTURES), 'utf8'), status: 200 };
  } catch {
    return { body: readFileSync(new URL('yahoo-chart-zzzzqq-404.json', FIXTURES), 'utf8'), status: 404 };
  }
}

/** How the quote services answer: from the recordings, not at all, or never. */
export type QuoteMode = 'serve' | 'abort' | 'hang';

export interface QuoteRoutes {
  mode: QuoteMode;
  /** The requests seen, newest last. */
  readonly requests: string[];
}

function answer(route: Route, routes: QuoteRoutes, fulfil: () => Promise<void>): Promise<void> {
  routes.requests.push(route.request().url());
  if (routes.mode === 'abort') return route.abort('failed');
  // A request left unanswered: the service accepts it and never replies.
  if (routes.mode === 'hang') return new Promise(() => {});
  return fulfil();
}

/** Answers stock's requests as `mode` says; change `mode` on the result to change the answers. */
export async function routeQuotes(page: Page, mode: QuoteMode = 'serve'): Promise<QuoteRoutes> {
  const routes: QuoteRoutes = { mode, requests: [] };
  await page.route('https://api.allorigins.win/**', (route) =>
    answer(route, routes, () => {
      const target = new URL(new URL(route.request().url()).searchParams.get('url') ?? '');
      const symbol = decodeURIComponent(target.pathname.split('/').pop() ?? '');
      const { body, status } = chart(symbol, target.searchParams.get('range') ?? '1d');
      return route.fulfill({ json: { contents: body, status: { url: target.href, http_code: status } } });
    }),
  );

  const worker = (process.env.VITE_STOCK_API ?? '').trim().replace(/\/+$/, '');
  if (worker !== '') {
    await page.route(`${worker}/v1/**`, (route) =>
      answer(route, routes, () => {
        const url = new URL(route.request().url());
        const symbol = url.searchParams.get('symbol') ?? '';
        const range = (url.searchParams.get('range') ?? '1d') as Range;
        const { body } = chart(symbol, range);
        const result = normaliseYahooChart(JSON.parse(body) as unknown, symbol, range, Math.floor(Date.now() / 1000));
        const headers = { 'Access-Control-Allow-Origin': '*' };
        if (result.ok === true) return route.fulfill({ json: result.quote, headers });
        return route.fulfill({ status: 404, headers, json: { v: 1, kind: 'error', error: { code: 'not_found', message: 'No market data.' } } });
      }),
    );
  }
  return routes;
}
