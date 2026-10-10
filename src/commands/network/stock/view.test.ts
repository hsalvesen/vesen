// What the quote card and table say, for every recorded chart and every state: the view models
// the components draw, and the plain text a pipe receives. Snapshots keep the words honest; the
// assertions keep the chips safe.
import { describe, expect, it } from 'vitest';
import { isTrustedAction, type Action } from '../../../output/model';
import { RANGES, SYMBOL_RE, type QuoteEnvelope } from '../../../services/market/contract';
import type { QuoteOutcome } from '../../../services/market/port';
import { RECORDED_AT_MS, cardStates, quoteOf, recordedQuotes } from '../../../testing/quotes';
import { cardText, glyphLine, tableText } from './text';
import {
  cardAlt,
  cardChips,
  cardView,
  footerText,
  phaseLine,
  resolvedNote,
  sparkView,
  stockLine,
  symbolChips,
  tableAlt,
  tableView,
  type QuoteCardView,
  type QuoteTableView,
} from './view';

/** A chip's line, a tap could run: `stock`, then -f and -r RANGE at most, then one ticker. */
const CHIP_LINE = new RegExp(`^stock(?: -f)?(?: -r (?:${RANGES.join('|')}))? (\\S+)$`);

function expectSafeLine(action: Action): void {
  expect(isTrustedAction(action)).toBe(true);
  expect(action.kind).toBe('run');
  if (action.kind !== 'run') return;
  const match = CHIP_LINE.exec(action.line);
  expect(match, action.line).not.toBeNull();
  expect(SYMBOL_RE.test(match?.[1] ?? ''), action.line).toBe(true);
}

/** A view model as a snapshot reads it: actions as the line they run, ids left out. */
function readable(view: QuoteCardView | QuoteTableView): unknown {
  return JSON.parse(
    JSON.stringify(view, (key, value: unknown) => {
      if (key === 'id') return undefined;
      if (key === 'action' && isTrustedAction(value)) return value.kind === 'run' ? `run: ${value.line}` : value.kind;
      return value;
    }),
  );
}

const live = (quote: QuoteEnvelope): Extract<QuoteOutcome, { ok: true }> => ({ ok: true, quote, freshness: 'live', via: 'worker' });

describe('the card for every recorded chart', () => {
  it.each(recordedQuotes())('%s', (_name, quote) => {
    const view = cardView(live(quote), quote.series?.range ?? '1d', RECORDED_AT_MS);
    expect(readable(view)).toMatchSnapshot('view');
    expect(cardText(view, quote.series)).toMatchSnapshot('plain');
    expect(cardAlt(view)).toMatchSnapshot('alt');
    for (const chip of view.chips) expectSafeLine(chip.action);
  });
});

describe('the card in every state', () => {
  it.each(cardStates())('%s', (_name, outcome) => {
    if (outcome.ok === false) throw new Error('a card state is a quote');
    const view = cardView(outcome, '1d', RECORDED_AT_MS);
    expect(readable(view)).toMatchSnapshot('view');
    expect(cardText(view, outcome.quote.series)).toMatchSnapshot('plain');
    for (const chip of view.chips) expectSafeLine(chip.action);
    const stale = outcome.freshness === 'saved' || outcome.quote.stale;
    expect(view.stale !== null).toBe(stale);
    expect(cardText(view, outcome.quote.series).includes('[STALE]')).toBe(stale);
  });

  it('keeps a hostile name as text, for the component to escape', () => {
    const [, outcome] = cardStates().find(([name]) => name === 'a hostile name') ?? [];
    if (outcome === undefined || outcome.ok === false) throw new Error('missing state');
    const view = cardView(outcome, '1d', RECORDED_AT_MS);
    expect(view.name).toBe('<img src=x onerror=alert(1)><script>alert(2)</script>');
    expect(cardText(view, outcome.quote.series)).toContain('<img src=x onerror=alert(1)>');
  });

  it('labels the first bar as the first trade, and leaves stats out for an index and a currency', () => {
    expect(cardView(live(quoteOf('AAPL')), '1d', RECORDED_AT_MS).stats.map((stat) => stat.label)).toEqual(['First trade', 'Vol', 'Exch']);
    expect(cardView(live(quoteOf('^AXJO')), '1d', RECORDED_AT_MS).stats).toEqual([]);
    expect(cardView(live(quoteOf('AUDUSD=X')), '1d', RECORDED_AT_MS).stats).toEqual([]);
    expect(cardView(live({ ...quoteOf('AAPL'), openApprox: false, volume: null }), '1d', RECORDED_AT_MS).stats).toEqual([
      { label: 'Open', value: '332.80' },
      { label: 'Vol', value: '—' },
      { label: 'Exch', value: 'NasdaqGS' },
    ]);
  });

  it('labels a 24-hour change, and gives each card its own id', () => {
    const first = cardView(live(quoteOf('BTC-USD')), '1d', RECORDED_AT_MS);
    const second = cardView(live(quoteOf('BTC-USD')), '1d', RECORDED_AT_MS);
    expect(first.change?.basis).toBe('24h');
    expect(first.id).not.toBe(second.id);
  });

  it('outlines the range shown, and refreshes that range', () => {
    const chips = cardChips('CBA.AX', '5d');
    expect(chips.map((chip) => [chip.label, chip.active, chip.action.kind === 'run' ? chip.action.line : ''])).toEqual([
      ['refresh', false, 'stock -f -r 5d CBA.AX'],
      ['1d', false, 'stock CBA.AX'],
      ['5d', true, 'stock -r 5d CBA.AX'],
      ['1mo', false, 'stock -r 1mo CBA.AX'],
      ['1y', false, 'stock -r 1y CBA.AX'],
    ]);
  });
});

describe('the market phase, now', () => {
  const aapl = quoteOf('AAPL');
  const cba = quoteOf('CBA.AX');
  const at = (iso: string): number => Date.parse(iso) / 1000;

  it('is open, with when it closes', () => {
    expect(phaseLine(cba, RECORDED_AT_MS / 1000)).toEqual({ text: '● Open · closes 4:12 PM AEDT', live: true });
  });

  it('is pre-market, with how long until it opens', () => {
    const periods = aapl.market.periods;
    if (periods === null) throw new Error('AAPL has periods');
    // 99 minutes before the open.
    const text = phaseLine(aapl, periods.regular.start - 99 * 60).text;
    expect(text).toBe('○ Pre-market · opens in 1h 39m');
  });

  it('is after hours, then closed with the last trade, as a copy ages', () => {
    const periods = aapl.market.periods;
    if (periods === null) throw new Error('AAPL has periods');
    expect(phaseLine(aapl, periods.regular.end + 60).text).toBe('○ After hours · closed 4:00 PM EDT');
    expect(phaseLine(aapl, at('2026-10-08T12:00:00Z')).text).toBe('○ Closed · last trade 4:00 PM EDT');
  });

  it('trades all day for crypto, and says only the last trade without periods', () => {
    expect(phaseLine(quoteOf('BTC-USD'), RECORDED_AT_MS / 1000)).toEqual({ text: '● Trading 24/7', live: true });
    expect(phaseLine({ ...aapl, market: { ...aapl.market, periods: null } }, RECORDED_AT_MS / 1000).text).toBe('Last trade 4:00 PM EDT');
  });

  it('never calls a saved copy open once its session has passed', () => {
    const tomorrow = RECORDED_AT_MS / 1000 + 24 * 3600;
    expect(phaseLine(cba, tomorrow).live).toBe(false);
  });
});

describe('the footer', () => {
  it('names the source, the delay and the age', () => {
    const aapl = quoteOf('AAPL');
    const now = aapl.asOf * 1000 + 2 * 60_000;
    expect(footerText(live(aapl), now)).toBe('Yahoo Finance · may be delayed · updated 2 min ago');
    expect(footerText({ ...live(aapl), via: 'interim' }, now)).toBe('Yahoo Finance via public proxy, may be slow · may be delayed · updated 2 min ago');
    expect(footerText(live({ ...aapl, provider: 'cboe', source: 'cboe', delayed: true }), now)).toBe('Cboe · 15-min delayed · 4:00 PM EDT');
    expect(footerText({ ok: true, quote: aapl, freshness: 'saved', savedAt: now - 2 * 3_600_000, reason: 'timeout', via: 'worker' }, now)).toBe(
      'Saved copy from 2 h ago · live data unavailable (timed out)',
    );
    expect(footerText({ ok: true, quote: aapl, freshness: 'saved', savedAt: now - 60_000, reason: 'offline', via: 'worker' }, now)).toBe(
      "Saved copy from 1 min ago · live data unavailable (you're offline)",
    );
  });
});

describe('the resolved note', () => {
  it('says what a name was taken to mean', () => {
    expect(resolvedNote('cba', { ...quoteOf('CBA.AX'), resolvedFrom: 'CBA' })).toBe("'cba' isn't a ticker on its own — showing CBA.AX (ASX)");
    expect(resolvedNote('sp500', { ...quoteOf('^GSPC'), resolvedFrom: 'SP500' })).toBe("'sp500' isn't a ticker on its own — showing ^GSPC (S&P 500)");
    expect(resolvedNote('AAPL', quoteOf('AAPL'))).toBeNull();
  });
});

describe('the sparkline', () => {
  it('spans the session, so a day still trading stops part-way across', () => {
    const cba = quoteOf('CBA.AX');
    const spark = cba.series && sparkView(cba, cba.series);
    expect(spark?.last.x).toBeGreaterThan(10);
    expect(spark?.last.x).toBeLessThan(90);
    expect(spark?.labels).toEqual({ start: '10:00 AM', middle: 'prev close 151.22', end: '4:12 PM' });
    expect(spark?.label).toMatch(/^CBA\.AX today: up, from [\d.]+ to [\d.]+, above the previous close of 151\.22$/);
  });

  it('crosses the full width when the session is over, and labels other ranges by day', () => {
    const aapl = quoteOf('AAPL');
    expect(aapl.series && sparkView(aapl, aapl.series)?.last.x).toBeGreaterThan(98);
    const week = quoteOf('AAPL', '5d');
    expect(week.series && sparkView(week, week.series)?.labels.middle).toMatch(/^from /);
  });

  it('needs two points, and draws a flat line mid-height', () => {
    const aapl = quoteOf('AAPL');
    const series = aapl.series;
    if (series === null) throw new Error('AAPL has a series');
    expect(sparkView(aapl, { ...series, points: [[0, 1]] })).toBeNull();
    const flat = sparkView(aapl, { ...series, baseline: null, points: [[0, 5], [60, 5]] });
    expect(flat?.tone).toBe('flat');
    expect(flat?.path).toMatch(/^M0 30L/);
  });

  it('becomes block glyphs in plain text', () => {
    const aapl = quoteOf('AAPL');
    if (aapl.series === null) throw new Error('AAPL has a series');
    const glyphs = glyphLine(aapl.series);
    expect(glyphs).toMatch(/^[▁▂▃▄▅▆▇█]{32}$/);
  });
});

describe('lines a tap may run', () => {
  it('carry only a canonical ticker and a known range', () => {
    expect(stockLine('AAPL')).toBe('stock AAPL');
    expect(stockLine('^AXJO', { range: '1y' })).toBe('stock -r 1y ^AXJO');
    expect(stockLine('BTC-USD', { force: true })).toBe('stock -f BTC-USD');
    for (const hostile of ['aapl', 'AAPL; rm -rf ~', "A'B", 'A B', '$(reboot)', '', 'A'.repeat(20), 'CBA..AX']) {
      expect(stockLine(hostile), hostile).toBeNull();
    }
    expect(stockLine('AAPL', { range: '7d' as never })).toBeNull();
    expect(symbolChips(['AAPL', '<b>', 'CBA.AX']).map((chip) => chip.label)).toEqual(['AAPL', 'CBA.AX']);
  });
});

describe('the table', () => {
  const rows = (): { symbol: string; outcome: QuoteOutcome }[] => [
    { symbol: 'AAPL', outcome: live(quoteOf('AAPL')) },
    { symbol: 'CBA.AX', outcome: { ok: true, quote: quoteOf('CBA.AX'), freshness: 'saved', savedAt: RECORDED_AT_MS - 3_600_000, reason: 'timeout', via: 'worker' } },
    { symbol: 'BTC-USD', outcome: live(quoteOf('BTC-USD')) },
    { symbol: 'ZZZZQQ', outcome: { ok: false, error: { code: 'not_found' } } },
    { symbol: 'TEAM', outcome: { ok: false, error: { code: 'upstream_unavailable' } } },
  ];

  it('has a row per ticker, failures inline', () => {
    const view = tableView(rows(), RECORDED_AT_MS);
    expect(readable(view)).toMatchSnapshot('view');
    expect(tableText(view)).toMatchSnapshot('plain');
    expect(tableAlt(view)).toMatchSnapshot('alt');
    expect(view.rows.map((row) => row.failure)).toEqual([null, null, null, '— not found', '— unavailable']);
    expect(view.rows.map((row) => row.stale)).toEqual([false, true, false, false, false]);
    for (const row of view.rows) if (row.action !== null) expectSafeLine(row.action);
  });

  it('gives each table its own id', () => {
    expect(tableView(rows(), RECORDED_AT_MS).id).not.toBe(tableView(rows(), RECORDED_AT_MS).id);
  });
});
