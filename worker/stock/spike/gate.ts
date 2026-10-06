// The Stage 0 gate: Yahoo stays the primary source only if it gives a real answer (200, or 404
// for the unknown ticker) to at least 95% of calls made from Cloudflare over 24 hours and at
// least two locations.

export type ProbeGroup = 'yahoo-chart' | 'yahoo-search' | 'cboe';

export interface ProbeResult {
  readonly target: string;
  readonly group: ProbeGroup;
  /** HTTP status, or 0 for a timeout or network error. */
  readonly status: number;
  readonly ms: number;
}

export interface Sample {
  /** Unix seconds. */
  readonly at: number;
  /** The Cloudflare location that made the calls, such as SYD. */
  readonly colo: string;
  readonly trigger: 'cron' | 'manual';
  readonly results: readonly ProbeResult[];
}

export interface GroupStats {
  readonly total: number;
  readonly good: number;
  readonly rate: number;
  readonly p50ms: number | null;
  readonly p95ms: number | null;
  readonly statuses: Readonly<Record<string, number>>;
}

export type Verdict = 'yahoo-primary' | 'cboe-only' | 'fail';

export interface GateReport {
  readonly samples: number;
  readonly colos: readonly string[];
  readonly hours: number;
  /** True once the run covers 24 hours from at least two locations. */
  readonly complete: boolean;
  readonly groups: Readonly<Record<ProbeGroup, GroupStats>>;
  readonly verdict: Verdict;
  /** The PROVIDER_ORDER to set in wrangler.toml, or null when no source passed. */
  readonly providerOrder: string | null;
  readonly advice: string;
}

export const GATE_THRESHOLD = 0.95;
export const GATE_HOURS = 24;
export const GATE_COLOS = 2;

/** A real answer from each group. A 404 from the chart is Yahoo saying a ticker does not exist. */
export function isGood(result: ProbeResult): boolean {
  if (result.group === 'yahoo-chart') return result.status === 200 || result.status === 404;
  return result.status === 200;
}

function percentile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? null;
}

function stats(results: readonly ProbeResult[]): GroupStats {
  const good = results.filter(isGood).length;
  const times = results.map((r) => r.ms).sort((a, b) => a - b);
  const statuses: Record<string, number> = {};
  for (const r of results) statuses[String(r.status)] = (statuses[String(r.status)] ?? 0) + 1;
  return {
    total: results.length,
    good,
    rate: results.length === 0 ? 0 : good / results.length,
    p50ms: percentile(times, 0.5),
    p95ms: percentile(times, 0.95),
    statuses,
  };
}

export function evaluateGate(samples: readonly Sample[]): GateReport {
  const results = samples.flatMap((s) => s.results);
  const groupOf = (group: ProbeGroup): GroupStats => stats(results.filter((r) => r.group === group));
  const groups = { 'yahoo-chart': groupOf('yahoo-chart'), 'yahoo-search': groupOf('yahoo-search'), cboe: groupOf('cboe') };
  const times = samples.map((s) => s.at);
  const hours = times.length < 2 ? 0 : (Math.max(...times) - Math.min(...times)) / 3600;
  const colos = [...new Set(samples.map((s) => s.colo))].sort();
  const complete = hours >= GATE_HOURS && colos.length >= GATE_COLOS;

  const yahoo = groups['yahoo-chart'].total > 0 && groups['yahoo-chart'].rate >= GATE_THRESHOLD;
  const cboe = groups.cboe.total > 0 && groups.cboe.rate >= GATE_THRESHOLD;
  const verdict: Verdict = yahoo ? 'yahoo-primary' : cboe ? 'cboe-only' : 'fail';
  const advice = {
    'yahoo-primary': 'Keep PROVIDER_ORDER = "yahoo,cboe" and deploy the Worker.',
    'cboe-only':
      'Yahoo is unreliable from Cloudflare. Set PROVIDER_ORDER = "cboe,yahoo", add FINNHUB_KEY, and try the same handler on a Google egress (Cloud Run or a Firebase Function) before choosing a host.',
    fail: 'Neither source is reliable from Cloudflare. Do not deploy; run the handler on another host and repeat the spike.',
  }[verdict];

  return {
    samples: samples.length,
    colos,
    hours: Math.round(hours * 10) / 10,
    complete,
    groups,
    verdict,
    providerOrder: verdict === 'yahoo-primary' ? 'yahoo,cboe' : verdict === 'cboe-only' ? 'cboe,yahoo' : null,
    advice: complete ? advice : `Not finished: ${GATE_HOURS} h from ${GATE_COLOS} locations are needed. So far: ${advice}`,
  };
}
