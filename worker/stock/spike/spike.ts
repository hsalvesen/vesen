// Stage 0 spike: a throwaway Worker that checks whether Yahoo answers Cloudflare's addresses.
// A cron samples every 10 minutes; opening /sample from another network (home Wi-Fi, then phone
// data) adds samples from the Cloudflare location nearest that network. /report applies the
// 95% gate. Delete the Worker after 24 hours (see README.md, "Stage 0 spike").

import type { ExecutionContext, KVNamespace, ScheduledEvent } from '../src/env';
import { evaluateGate, type ProbeGroup, type ProbeResult, type Sample } from './gate';

interface SpikeEnv {
  readonly SPIKE: KVNamespace;
}

const USER_AGENT = 'Mozilla/5.0 (compatible; vesen-stock/1.0; +https://www.vesen.app)';
const TIMEOUT_MS = 5000;
const SAMPLE_TTL_SEC = 7 * 24 * 60 * 60;

/** The symbols the production Worker must handle, including a ticker that does not exist. */
export const SPIKE_SYMBOLS = ['AAPL', 'TEAM', 'CBA.AX', 'BHP.AX', 'VOD.L', '7203.T', '^GSPC', '^AXJO', 'BTC-USD', 'AUDUSD=X', 'BRK-B', 'ZZZZQQ'];

interface Probe {
  readonly target: string;
  readonly group: ProbeGroup;
  readonly url: string;
}

export function probes(): Probe[] {
  const chart = (host: string, symbol: string): Probe => ({
    target: `${host.split('.')[0] ?? host} ${symbol}`,
    group: 'yahoo-chart',
    url: `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=5m&includePrePost=false`,
  });
  return [
    ...SPIKE_SYMBOLS.flatMap((symbol) => [chart('query1.finance.yahoo.com', symbol), chart('query2.finance.yahoo.com', symbol)]),
    {
      target: 'search apple',
      group: 'yahoo-search',
      url: 'https://query2.finance.yahoo.com/v1/finance/search?q=apple&quotesCount=6&newsCount=0&listsCount=0',
    },
    { target: 'cboe AAPL', group: 'cboe', url: 'https://cdn-api.cboe.com/api/global/delayed_quotes/quotes/AAPL.json' },
  ];
}

async function probe(target: Probe): Promise<ProbeResult> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(target.url, { headers: { 'User-Agent': USER_AGENT }, signal: controller.signal });
    await response.arrayBuffer();
    return { target: target.target, group: target.group, status: response.status, ms: Date.now() - started };
  } catch {
    return { target: target.target, group: target.group, status: 0, ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

/** The location a cron run executes in, which no request tells it. */
async function cronColo(): Promise<string> {
  try {
    const trace = await (await fetch('https://www.cloudflare.com/cdn-cgi/trace')).text();
    return /^colo=([A-Z]{3})$/m.exec(trace)?.[1] ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

async function takeSample(env: SpikeEnv, colo: string, trigger: Sample['trigger']): Promise<Sample> {
  const queue = probes();
  const results: ProbeResult[] = [];
  const worker = async (): Promise<void> => {
    for (let next = queue.shift(); next; next = queue.shift()) results.push(await probe(next));
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  const sample: Sample = { at: Math.floor(Date.now() / 1000), colo, trigger, results };
  const key = `sample:${new Date(sample.at * 1000).toISOString()}:${colo}:${trigger}`;
  await env.SPIKE.put(key, JSON.stringify(sample), { expirationTtl: SAMPLE_TTL_SEC });
  return sample;
}

async function allSamples(env: SpikeEnv): Promise<Sample[]> {
  const samples: Sample[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.SPIKE.list({ prefix: 'sample:', ...(cursor ? { cursor } : {}) });
    for (const { name } of page.keys) {
      const raw = await env.SPIKE.get(name, 'text');
      if (raw) samples.push(JSON.parse(raw) as Sample);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return samples;
}

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body, null, 2), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });

let lastManualSample = 0;

const spike = {
  async fetch(request: Request, env: SpikeEnv): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === '/report') return json(evaluateGate(await allSamples(env)));
    if (pathname === '/sample') {
      // One manual sample a minute per isolate, so a reload loop cannot hammer the upstreams.
      if (Date.now() - lastManualSample < 60_000) return new Response('wait a minute between samples\n', { status: 429 });
      lastManualSample = Date.now();
      const colo = (request as Request & { cf?: { colo?: string } }).cf?.colo ?? 'unknown';
      return json(await takeSample(env, colo, 'manual'));
    }
    return new Response(
      'vesen-stock spike\n  /sample  probe Yahoo and Cboe now from this Cloudflare location\n  /report  the 95% gate over every sample so far\n',
      { headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
    );
  },

  scheduled(_event: ScheduledEvent, env: SpikeEnv, ctx: ExecutionContext): void {
    ctx.waitUntil(cronColo().then((colo) => takeSample(env, colo, 'cron')));
  },
};

export default spike;
