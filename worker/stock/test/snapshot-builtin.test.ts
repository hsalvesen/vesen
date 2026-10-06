// Builds the snapshot that ships inside the Worker from the recorded charts, and checks the
// committed file matches. After refreshing the fixtures, regenerate it with
//   npx vitest run --project worker -u
import { describe, expect, it } from 'vitest';
import { CURATED_SYMBOLS, isSnapshotEnvelope, type QuoteEnvelope, type SnapshotEnvelope } from '../src/contract';
import { normaliseYahooChart } from '../src/providers/yahoo';
import { chartFixture, fixtureJson } from './support/fixtures';

/** When the fixtures were recorded: 2026-10-06 03:30 UTC (14:30 in Sydney). */
const RECORDED_AT = 1_791_257_400;

function builtin(): SnapshotEnvelope {
  const quotes = CURATED_SYMBOLS.map((symbol): QuoteEnvelope => {
    const result = normaliseYahooChart(fixtureJson(chartFixture(symbol)), symbol, '1d', RECORDED_AT);
    if (!result.ok) throw new Error(`${symbol}: ${result.detail}`);
    return { ...result.quote, source: 'snapshot', series: null };
  });
  return { v: 1, kind: 'snapshot', generatedAt: RECORDED_AT, quotes, missing: [] };
}

describe('the built-in snapshot', () => {
  it('is every curated symbol, normalised from the recorded charts', async () => {
    const snapshot = builtin();
    expect(isSnapshotEnvelope(snapshot)).toBe(true);
    expect(snapshot.quotes.map((q) => q.symbol)).toEqual([...CURATED_SYMBOLS]);
    await expect(`${JSON.stringify(snapshot, null, 2)}\n`).toMatchFileSnapshot('../src/snapshot-builtin.json');
  });
});
