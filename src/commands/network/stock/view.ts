// The view models the quote card and table draw (src/ui/components/QuoteCard.svelte and
// QuoteTable.svelte), built here so every word, number and coordinate is decided by pure code
// the tests can read. The components only lay them out: text by interpolation, colours by role.
//
// Chips are trusted actions made with out.action.run, and every line they run is built by
// stockLine, which accepts only a ticker matching SYMBOL_RE and a range from RANGES (02, section 6).

import { out, type Action } from '../../../output/model';
import { SYMBOL_RE, isRange, marketPhaseAt, type QuoteEnvelope, type QuoteSeries, type Range, type SearchHit } from '../../../services/market/contract';
import type { FailureCode, MarketBackend, QuoteOutcome } from '../../../services/market/port';
import { formatAge, formatChange, formatClock, formatCompact, formatDay, formatDuration, formatNumber, formatPercent, formatPrice, toneOf } from './format';

export type Tone = 'up' | 'down' | 'flat';

/** The ranges offered as chips under a card; 6mo and 5y are there for typing. */
export const RANGE_CHIPS: readonly Range[] = ['1d', '5d', '1mo', '1y'];

/** The tickers bare `stock` offers: Sydney and the US. */
export const EXAMPLE_SYMBOLS = ['AAPL', 'TEAM', 'CBA.AX', '^AXJO', 'BTC-USD'] as const;

// ── Lines a tap may run ────────────────────────────────────────────────────────────────────

/**
 * `stock [-f] [-r RANGE] SYMBOL`, or null when the symbol is not canonical: the one way a chip's
 * line is made, so no upstream text can reach a line a visitor might tap.
 */
export function stockLine(symbol: string, options: { range?: Range; force?: boolean } = {}): string | null {
  if (!SYMBOL_RE.test(symbol)) return null;
  const range = options.range ?? '1d';
  if (!isRange(range)) return null;
  const words = ['stock'];
  if (options.force === true) words.push('-f');
  if (range !== '1d') words.push('-r', range);
  words.push(symbol);
  return words.join(' ');
}

export interface ChipView {
  readonly label: string;
  /** The words a screen reader says, when the label alone is not enough ('Show AAPL over 5 days'). */
  readonly title: string;
  readonly action: Action;
  /** The chart's current range: drawn outlined. */
  readonly active: boolean;
}

function chip(label: string, title: string, line: string | null, active = false): ChipView | null {
  return line === null ? null : { label, title, action: out.action.run(line), active };
}

const isChip = (value: ChipView | null): value is ChipView => value !== null;

const RANGE_WORDS: Readonly<Record<Range, string>> = {
  '1d': 'today',
  '5d': 'over 5 days',
  '1mo': 'over a month',
  '6mo': 'over 6 months',
  '1y': 'over a year',
  '5y': 'over 5 years',
};

/** [↻ refresh] [1d] [5d] [1mo] [1y] for a card. */
export function cardChips(symbol: string, range: Range): ChipView[] {
  return [
    chip('↻ refresh', `Refresh ${symbol}`, stockLine(symbol, { range, force: true })),
    ...RANGE_CHIPS.map((r) => chip(r, `Show ${symbol} ${RANGE_WORDS[r]}`, stockLine(symbol, { range: r }), r === range)),
  ].filter(isChip);
}

/** One chip per ticker: examples, recents, did-you-mean, search results. */
export function symbolChips(symbols: readonly string[]): ChipView[] {
  return symbols.map((symbol) => chip(symbol, `Show ${symbol}`, stockLine(symbol))).filter(isChip);
}

/** Search hits whose ticker may go in a line. */
export function hitChips(hits: readonly SearchHit[]): ChipView[] {
  return symbolChips(hits.map((hit) => hit.symbol));
}

// ── Words about the market ─────────────────────────────────────────────────────────────────

const PROVIDERS: Readonly<Record<QuoteEnvelope['provider'], string>> = {
  yahoo: 'Yahoo Finance',
  cboe: 'Cboe',
  finnhub: 'Finnhub',
};

/** Why live data is missing, as the footer says it. */
export function reasonText(code: FailureCode | QuoteEnvelope['staleReason']): string {
  switch (code) {
    case 'timeout':
      return 'timed out';
    case 'offline':
      return "you're offline";
    case 'rate_limited':
      return 'too many requests';
    case 'snapshot_builtin':
    case 'snapshot_outdated':
      return 'showing a snapshot';
    default:
      return 'service unavailable';
  }
}

/** The market phase now, from the periods the quote carries: an older copy never claims 'Open'. */
export function phaseLine(quote: QuoteEnvelope, nowSec: number): { readonly text: string; readonly live: boolean } {
  const { timezone, tzAbbr, periods } = quote.market;
  const clock = (sec: number): string => formatClock(sec, timezone, tzAbbr);
  const info = marketPhaseAt(quote.type, periods, nowSec);
  switch (info.phase) {
    case 'always_open':
      return { text: '● Trading 24/7', live: true };
    case 'open':
      return { text: `● Open · closes ${clock(info.closesAt ?? periods?.regular.end ?? nowSec)}`, live: true };
    case 'pre':
      return { text: info.opensAt === null ? '○ Pre-market' : `○ Pre-market · opens in ${formatDuration((info.opensAt - nowSec) * 1000)}`, live: false };
    case 'post':
      return { text: `○ After hours · closed ${clock(periods?.regular.end ?? quote.asOf)}`, live: false };
    case 'closed':
      return {
        text: info.opensAt === null ? `○ Closed · last trade ${clock(quote.asOf)}` : `○ Closed · opens in ${formatDuration((info.opensAt - nowSec) * 1000)}`,
        live: false,
      };
    case 'unknown':
      return { text: `Last trade ${clock(quote.asOf)}`, live: false };
  }
}

/** The dim line under a card: whose data, how delayed, and how old. */
export function footerText(outcome: Extract<QuoteOutcome, { ok: true }>, nowMs: number): string {
  const quote = outcome.quote;
  const provider = PROVIDERS[quote.provider];
  const clock = (sec: number): string => formatClock(sec, quote.market.timezone, quote.market.tzAbbr);
  if (outcome.freshness === 'saved') {
    const what = quote.source === 'snapshot' ? 'Snapshot' : 'Saved copy';
    return `${what} from ${formatAge(nowMs - outcome.savedAt)} · live data unavailable (${reasonText(outcome.reason)})`;
  }
  if (quote.stale) {
    const what = quote.source === 'snapshot' ? 'Snapshot' : 'Saved copy';
    return `${what} from ${formatAge(nowMs - quote.fetchedAt * 1000)} · live data unavailable (${reasonText(quote.staleReason)})`;
  }
  const via = outcome.via === 'interim' ? ' via public proxy, may be slow' : '';
  if (quote.source === 'snapshot') return `${provider}${via} · snapshot as of ${clock(quote.fetchedAt)}`;
  if (quote.delayed) return `${provider}${via} · 15-min delayed · ${clock(quote.asOf)}`;
  return `${provider}${via} · may be delayed · updated ${formatAge(nowMs - quote.asOf * 1000)}`;
}

/** 'showing CBA.AX (ASX)': what a name or alias was taken to mean. */
export function resolvedNote(typed: string, quote: QuoteEnvelope): string | null {
  if (quote.resolvedFrom === null) return null;
  const about = quote.type === 'INDEX' || quote.type === 'CRYPTOCURRENCY' ? quote.name : quote.exchange;
  return `'${typed}' isn't a ticker on its own — showing ${quote.symbol}${about === null ? '' : ` (${about})`}`;
}

// ── The sparkline ──────────────────────────────────────────────────────────────────────────

export interface SparkView {
  /** The viewBox the path is drawn in; the SVG stretches it to the card's width. */
  readonly width: number;
  readonly height: number;
  /** The closes as one path, x across the session, y down from the highest. */
  readonly path: string;
  /** Where the comparison line crosses, in viewBox units; null when there is none. */
  readonly baseline: number | null;
  /** The last point, in percent of the box: the dot. */
  readonly last: { readonly x: number; readonly y: number };
  /** The line's colour when it does not cross the baseline: up, down or flat overall. */
  readonly tone: Tone;
  /** Under the chart: the start, what the dashed line is, the end. */
  readonly labels: { readonly start: string; readonly middle: string; readonly end: string };
  /** What a screen reader hears instead. */
  readonly label: string;
}

const SPARK = { width: 300, height: 60, pad: 4 } as const;

const r1 = (value: number): number => Math.round(value * 10) / 10;

/** The chart's geometry and words, or null with fewer than two points. */
export function sparkView(quote: QuoteEnvelope, series: QuoteSeries, options: { mini?: boolean } = {}): SparkView | null {
  const points = series.points;
  const first = points[0];
  const lastPoint = points[points.length - 1];
  if (points.length < 2 || first === undefined || lastPoint === undefined) return null;
  const span = Math.max(series.end - series.start, lastPoint[0], 1);
  const closes = points.map(([, close]) => close);
  const values = series.baseline === null ? closes : [...closes, series.baseline];
  let low = Math.min(...values);
  let high = Math.max(...values);
  if (high - low < 1e-9) {
    low -= 1;
    high += 1;
  }
  const { width, height, pad } = SPARK;
  const x = (t: number): number => r1((t / span) * width);
  const y = (v: number): number => r1(pad + ((high - v) / (high - low)) * (height - 2 * pad));
  const path = points.map(([t, v], i) => `${i === 0 ? 'M' : 'L'}${x(t)} ${y(v)}`).join('');
  const baseline = series.baseline === null ? null : y(series.baseline);
  const tone = toneOf(series.baseline === null ? lastPoint[1] - first[1] : lastPoint[1] - series.baseline, quote.priceHint);

  const zone = quote.market.timezone;
  const when = (sec: number): string =>
    series.range === '1d' ? formatClock(sec, zone, null) : formatDay(sec, zone, series.range === '5y' || series.range === '1y' ? 'month' : 'day');
  const baselineWord = series.range === '1d' ? 'prev close' : 'from';
  const middle = series.baseline === null ? '' : `${baselineWord} ${formatNumber(series.baseline, quote.priceHint)}`;
  const labels = options.mini ? { start: '', middle: '', end: '' } : { start: when(series.start), middle, end: when(series.end) };
  const direction = tone === 'up' ? 'up' : tone === 'down' ? 'down' : 'unchanged';
  const comparison =
    series.baseline === null ? '' : `, ${lastPoint[1] >= series.baseline ? 'above' : 'below'} the ${series.range === '1d' ? 'previous close' : 'first close'} of ${formatNumber(series.baseline, quote.priceHint)}`;
  const label = `${quote.symbol} ${RANGE_WORDS[series.range]}: ${direction}, from ${formatNumber(first[1], quote.priceHint)} to ${formatNumber(lastPoint[1], quote.priceHint)}${comparison}`;

  return {
    width,
    height,
    path,
    baseline,
    last: { x: r1((x(lastPoint[0]) / width) * 100), y: r1((y(lastPoint[1]) / height) * 100) },
    tone,
    labels,
    label,
  };
}

// ── The card ───────────────────────────────────────────────────────────────────────────────

export interface RangeBarView {
  readonly label: string;
  readonly low: string;
  readonly high: string;
  /** Where the price sits, 0 to 100. */
  readonly at: number;
}

export interface QuoteCardView {
  readonly kind: 'quote-card';
  /** Unique on the page, for the chart's gradient. */
  readonly id: string;
  readonly symbol: string;
  readonly name: string | null;
  /** Shown as a STALE badge: why the copy is not live. */
  readonly stale: string | null;
  readonly price: string;
  readonly change: { readonly text: string; readonly tone: Tone; readonly basis: string | null } | null;
  readonly phase: { readonly text: string; readonly live: boolean };
  readonly chart: SparkView | null;
  readonly bars: readonly RangeBarView[];
  readonly stats: readonly { readonly label: string; readonly value: string }[];
  readonly footer: string;
  readonly chips: readonly ChipView[];
}

let nextId = 0;

/** A new id for a card or table drawn now, so two on one page never share a gradient. */
export function viewId(prefix: string): string {
  nextId += 1;
  return `${prefix}-${nextId.toString(36)}`;
}

function rangeBar(label: string, low: number | null, high: number | null, price: number, quote: QuoteEnvelope): RangeBarView | null {
  if (low === null || high === null || high < low) return null;
  const at = high - low < 1e-9 ? 50 : Math.min(100, Math.max(0, ((price - low) / (high - low)) * 100));
  return { label, low: formatNumber(low, quote.priceHint), high: formatNumber(high, quote.priceHint), at: r1(at) };
}

/** The range the card's chart shows; the saved copy's own when it is not the one asked for. */
function shownRange(quote: QuoteEnvelope, asked: Range): Range {
  return quote.series?.range ?? asked;
}

export function cardView(outcome: Extract<QuoteOutcome, { ok: true }>, asked: Range, nowMs: number): QuoteCardView {
  const quote = outcome.quote;
  const range = shownRange(quote, asked);
  const nowSec = Math.floor(nowMs / 1000);
  const changeText = formatChange(quote.change, quote.changePercent, quote.priceHint);
  const stale = outcome.freshness === 'saved' ? reasonText(outcome.reason) : quote.stale ? reasonText(quote.staleReason) : null;

  const bars = [
    rangeBar('Day', quote.dayLow, quote.dayHigh, quote.price, quote),
    rangeBar('52w', quote.fiftyTwoWeekLow, quote.fiftyTwoWeekHigh, quote.price, quote),
  ].filter((bar): bar is RangeBarView => bar !== null);

  // Stats mean little for an index or a currency pair, so their cards leave them out.
  const stats: { label: string; value: string }[] = [];
  if (quote.type !== 'INDEX' && quote.type !== 'CURRENCY') {
    stats.push({ label: quote.openApprox ? 'First trade' : 'Open', value: quote.open === null ? '—' : formatNumber(quote.open, quote.priceHint) });
    stats.push({ label: 'Vol', value: quote.volume === null ? '—' : formatCompact(quote.volume) });
    stats.push({ label: 'Exch', value: quote.exchange ?? '—' });
  }

  return {
    kind: 'quote-card',
    id: viewId('stk'),
    symbol: quote.symbol,
    name: quote.name,
    stale,
    price: formatPrice(quote.price, quote.currency, quote.priceHint),
    change:
      changeText === null
        ? null
        : {
            text: changeText,
            tone: toneOf(quote.change ?? quote.changePercent, quote.change === null ? 2 : quote.priceHint),
            basis: quote.changeBasis === '24h' ? '24h' : null,
          },
    phase: phaseLine(quote, nowSec),
    chart: quote.series === null ? null : sparkView(quote, quote.series),
    bars,
    stats,
    footer: footerText(outcome, nowMs),
    chips: cardChips(quote.symbol, range),
  };
}

/** One sentence for a screen reader. */
export function cardAlt(view: QuoteCardView): string {
  const parts = [`${view.symbol}${view.name === null ? '' : `, ${view.name}`}: ${view.price}`];
  if (view.change !== null) parts.push(view.change.text.replace(/^[▲▼◆] /, view.change.tone === 'up' ? 'up ' : view.change.tone === 'down' ? 'down ' : 'unchanged '));
  parts.push(view.phase.text.replace(/^[●○] /, ''));
  if (view.stale !== null) parts.push(`stale: ${view.stale}`);
  return `${parts.join('. ')}.`;
}

// ── The table ──────────────────────────────────────────────────────────────────────────────

export interface QuoteRowView {
  readonly symbol: string;
  /** Runs `stock SYMBOL`; null when the symbol is not one a line may carry. */
  readonly action: Action | null;
  readonly name: string | null;
  readonly last: string | null;
  readonly percent: string | null;
  readonly change: string | null;
  readonly tone: Tone;
  readonly stale: boolean;
  readonly spark: SparkView | null;
  /** '— not found', '— unavailable': the row's failure, shown in place of its figures. */
  readonly failure: string | null;
}

export interface QuoteTableView {
  readonly kind: 'quote-table';
  readonly id: string;
  readonly rows: readonly QuoteRowView[];
  readonly footer: string | null;
}

/** A row's failure in a few words. */
export function failureWords(code: FailureCode): string {
  switch (code) {
    case 'not_found':
      return '— not found';
    case 'invalid_symbol':
    case 'bad_request':
      return '— not a valid ticker';
    case 'offline':
      return "— you're offline";
    case 'timeout':
      return '— timed out';
    case 'origin_not_allowed':
    case 'not_configured':
      return '— not available on this host';
    default:
      return '— unavailable';
  }
}

export function tableView(rows: readonly { readonly symbol: string; readonly outcome: QuoteOutcome }[], nowMs: number): QuoteTableView {
  let via: MarketBackend | null = null;
  const views = rows.map(({ symbol, outcome }): QuoteRowView => {
    if (outcome.ok === false) {
      const line = stockLine(symbol);
      return {
        symbol,
        action: line === null ? null : out.action.run(line),
        name: null,
        last: null,
        percent: null,
        change: null,
        tone: 'flat',
        stale: false,
        spark: null,
        failure: failureWords(outcome.error.code),
      };
    }
    via ??= outcome.via;
    const quote = outcome.quote;
    const line = stockLine(quote.symbol);
    return {
      symbol: quote.symbol,
      action: line === null ? null : out.action.run(line),
      name: quote.name,
      last: formatPrice(quote.price, quote.currency, quote.priceHint),
      percent: formatPercent(quote.changePercent),
      change: quote.change === null ? null : formatChange(quote.change, null, quote.priceHint),
      tone: toneOf(quote.change ?? quote.changePercent, quote.change === null ? 2 : quote.priceHint),
      stale: outcome.freshness === 'saved' || quote.stale,
      spark: quote.series === null ? null : sparkView(quote, quote.series, { mini: true }),
      failure: null,
    };
  });
  const firstOk = rows.find((row) => row.outcome.ok === true)?.outcome;
  const footer =
    firstOk !== undefined && firstOk.ok === true
      ? `${PROVIDERS[firstOk.quote.provider]}${via === 'interim' ? ' via public proxy, may be slow' : ''} · may be delayed · updated ${formatAge(nowMs - firstOk.quote.asOf * 1000)}`
      : null;
  return { kind: 'quote-table', id: viewId('stt'), rows: views, footer };
}

export function tableAlt(view: QuoteTableView): string {
  return view.rows
    .map((row) => (row.failure === null ? `${row.symbol} ${row.last ?? ''} ${row.percent ?? ''}`.trim() : `${row.symbol} ${row.failure.replace(/^— /, '')}`))
    .join('; ');
}

