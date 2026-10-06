import { describe, expect, it } from 'vitest';
import { evaluateGate, isGood, type ProbeResult, type Sample } from '../spike/gate';
import { SPIKE_SYMBOLS, probes } from '../spike/spike';

/** 145 samples, every 10 minutes for 24 hours, alternating between two locations. */
function day(status: (i: number, probe: { group: ProbeResult['group']; target: string }) => number): Sample[] {
  return Array.from({ length: 145 }, (_, i) => ({
    at: 1_791_257_400 + i * 600,
    colo: i % 2 === 0 ? 'SYD' : 'MEL',
    trigger: 'cron' as const,
    results: probes().map((p) => ({ target: p.target, group: p.group, status: status(i, p), ms: 300 + i })),
  }));
}

describe('the spike probes', () => {
  it('cover both Yahoo hosts for every symbol, search and Cboe', () => {
    const list = probes();
    expect(list.filter((p) => p.group === 'yahoo-chart')).toHaveLength(SPIKE_SYMBOLS.length * 2);
    expect(list.map((p) => new URL(p.url).hostname)).toEqual(expect.arrayContaining(['query1.finance.yahoo.com', 'query2.finance.yahoo.com', 'cdn-api.cboe.com']));
    // Under Cloudflare's 50 subrequests per invocation, with one left for the location lookup.
    expect(list.length).toBeLessThan(50);
  });
});

describe('evaluateGate', () => {
  it("counts Yahoo's 404 for an unknown ticker as a real answer", () => {
    expect(isGood({ target: 'query1 ZZZZQQ', group: 'yahoo-chart', status: 404, ms: 1 })).toBe(true);
    expect(isGood({ target: 'query1 AAPL', group: 'yahoo-chart', status: 429, ms: 1 })).toBe(false);
    expect(isGood({ target: 'cboe AAPL', group: 'cboe', status: 404, ms: 1 })).toBe(false);
  });

  it('keeps Yahoo primary at 95% or better over a full day from two locations', () => {
    // Every 25th sample is rate-limited: 96% success.
    const report = evaluateGate(day((i, p) => (p.group === 'yahoo-chart' && i % 25 === 0 ? 429 : 200)));
    expect(report).toMatchObject({ samples: 145, colos: ['MEL', 'SYD'], hours: 24, complete: true, verdict: 'yahoo-primary', providerOrder: 'yahoo,cboe' });
    expect(report.groups['yahoo-chart'].rate).toBeGreaterThanOrEqual(0.95);
    expect(report.groups['yahoo-chart'].statuses).toMatchObject({ '429': 144 });
  });

  it('falls back to Cboe when Yahoo misses the gate', () => {
    const report = evaluateGate(day((i, p) => (p.group === 'yahoo-chart' && i % 10 === 0 ? 0 : 200)));
    expect(report.verdict).toBe('cboe-only');
    expect(report.providerOrder).toBe('cboe,yahoo');
    expect(report.advice).toContain('FINNHUB_KEY');
  });

  it('fails when neither source is reliable', () => {
    expect(evaluateGate(day(() => 429))).toMatchObject({ verdict: 'fail', providerOrder: null });
  });

  it('says when the run is not long enough yet', () => {
    const report = evaluateGate(day(() => 200).slice(0, 12));
    expect(report.complete).toBe(false);
    expect(report.advice).toMatch(/^Not finished/);
    expect(evaluateGate([])).toMatchObject({ samples: 0, complete: false, verdict: 'fail' });
  });
});
