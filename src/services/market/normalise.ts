// Yahoo Finance's v8 chart response, turned into the QuoteEnvelope of the wire contract. One copy
// serves both sides: the stock Worker (worker/stock) normalises what it fetches with it, and the
// app's interim provider (interim.ts) does the same while the Worker is not deployed. It imports
// only the contract and the shared upstream-text cleaner (lib/upstream-text.ts), and touches no
// browser API, so the Worker bundles it as it is, and check-boundaries holds it to the DOM-free
// rules.
//
// Nothing upstream is trusted: every number is checked with Number.isFinite, a missing value is
// null (never 0), and text has its control and bidirectional-override characters removed.

import { upstreamText } from '../../lib/upstream-text';
import {
  INSTRUMENT_TYPES,
  MAX_SERIES_POINTS,
  RANGE_INTERVAL,
  marketPhaseAt,
  type InstrumentType,
  type MarketPeriods,
  type QuoteEnvelope,
  type QuoteSeries,
  type Range,
  type TradingPeriod,
} from './contract';

// ── Checked values ─────────────────────────────────────────────────────────────────────────

export type Rec = Readonly<Record<string, unknown>>;

export function isRecord(value: unknown): value is Rec {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A finite number, or null. Missing, NaN and non-numbers all become null, never 0. */
export function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** A finite positive number, or null: volume 0 means "not reported" for indices and FX. */
export function positive(value: unknown): number | null {
  const n = num(value);
  return n !== null && n > 0 ? n : null;
}

/**
 * Display text from an upstream: control and bidirectional-override characters removed (so a
 * name cannot reorder the text around it), spaces collapsed, length capped. The one copy is in
 * lib/upstream-text.ts, which weather's sources use too.
 */
export const text: (value: unknown, max?: number) => string | null = upstreamText;

export function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

// ── Downsampling ───────────────────────────────────────────────────────────────────────────
// Largest-Triangle-Three-Buckets: keeps the first and last points and, from each bucket in
// between, the point that best preserves the line's shape. A day of 5-minute bars stays as it
// is; five years of weekly bars come down to MAX_SERIES_POINTS without flattening the peaks.

export type Point = readonly [number, number];

/** At most `threshold` points (at least 3) from `points`, which must be in time order. */
export function downsample(points: readonly Point[], requested: number): Point[] {
  const length = points.length;
  const threshold = Math.max(3, Math.floor(requested));
  if (length <= threshold) return [...points];

  const sampled: Point[] = [];
  const bucketSize = (length - 2) / (threshold - 2);
  let anchor = points[0] as Point;
  sampled.push(anchor);

  for (let bucket = 0; bucket < threshold - 2; bucket += 1) {
    // The average of the next bucket is the third corner of each candidate triangle.
    const nextStart = Math.floor((bucket + 1) * bucketSize) + 1;
    const nextEnd = Math.min(Math.floor((bucket + 2) * bucketSize) + 1, length);
    let avgX = 0;
    let avgY = 0;
    for (let i = nextStart; i < nextEnd; i += 1) {
      const point = points[i] as Point;
      avgX += point[0];
      avgY += point[1];
    }
    const count = Math.max(nextEnd - nextStart, 1);
    avgX /= count;
    avgY /= count;

    const start = Math.floor(bucket * bucketSize) + 1;
    const end = Math.floor((bucket + 1) * bucketSize) + 1;
    let best = points[start] as Point;
    let bestArea = -1;
    for (let i = start; i < end; i += 1) {
      const point = points[i] as Point;
      const area = Math.abs(
        (anchor[0] - avgX) * (point[1] - anchor[1]) - (anchor[0] - point[0]) * (avgY - anchor[1]),
      );
      if (area > bestArea) {
        bestArea = area;
        best = point;
      }
    }
    sampled.push(best);
    anchor = best;
  }

  sampled.push(points[length - 1] as Point);
  return sampled;
}

// ── The chart endpoint ─────────────────────────────────────────────────────────────────────

/** The chart for `range`, at its interval, regular session only. */
export function chartUrl(host: string, symbol: string, range: Range): string {
  const query = `range=${range}&interval=${RANGE_INTERVAL[range]}&includePrePost=false`;
  return `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?${query}`;
}

/** What a chart response comes to. `not_found` is Yahoo's own 404; anything unreadable is `unavailable`. */
export type ChartResult =
  | { readonly ok: true; readonly quote: QuoteEnvelope }
  | { readonly ok: false; readonly kind: 'not_found' | 'unavailable'; readonly detail: string };

interface Bar {
  readonly t: number;
  readonly open: number | null;
  readonly close: number | null;
}

/**
 * Turns a chart response into a QuoteEnvelope. Yahoo's 404 body (`chart.error.code` "Not Found")
 * is the only not_found; anything else unreadable is `unavailable`, so a format change never
 * tells a visitor that a real ticker does not exist. `fetchedAt` is in Unix seconds.
 */
export function normaliseYahooChart(raw: unknown, symbol: string, range: Range, fetchedAt: number): ChartResult {
  const chart = isRecord(raw) && isRecord(raw.chart) ? raw.chart : null;
  if (!chart) return { ok: false, kind: 'unavailable', detail: 'not a chart response' };
  if (isRecord(chart.error) && chart.error.code === 'Not Found') {
    return { ok: false, kind: 'not_found', detail: text(chart.error.description) ?? 'Not Found' };
  }
  const result = Array.isArray(chart.result) ? (chart.result[0] as unknown) : null;
  if (!isRecord(result) || !isRecord(result.meta)) return { ok: false, kind: 'unavailable', detail: 'chart has no result' };
  const meta = result.meta;

  const bars = readBars(result);
  const priceHint = Math.min(8, Math.max(0, Math.round(num(meta.priceHint) ?? 2)));
  const lastClose = [...bars].reverse().find((bar) => bar.close !== null)?.close ?? null;
  const price = num(meta.regularMarketPrice) ?? (lastClose === null ? null : round(lastClose, priceHint + 2));
  if (price === null) return { ok: false, kind: 'unavailable', detail: 'chart has no price' };

  const type = instrumentType(meta.instrumentType);
  // chartPreviousClose is the close before the range starts, so it stands in only for 1d.
  const previousClose = num(meta.previousClose) ?? (range === '1d' ? num(meta.chartPreviousClose) : null);
  const session = lastSession(meta.tradingPeriods);
  const periods = currentPeriods(meta.currentTradingPeriod);

  let change: number | null = null;
  let changePercent: number | null = null;
  if (type === 'CRYPTOCURRENCY') {
    // Crypto has no close; Yahoo's change for it is over the last 24 hours.
    changePercent = num(meta.regularMarketChangePercent);
    change = num(meta.fulldayChange) ?? (changePercent !== null ? price - price / (1 + changePercent / 100) : null);
  } else if (previousClose !== null && previousClose !== 0) {
    change = price - previousClose;
    changePercent = (change / previousClose) * 100;
  }

  const timezone = ianaZone(meta.exchangeTimezoneName);
  const asOf = num(meta.regularMarketTime) ?? bars[bars.length - 1]?.t ?? fetchedAt;
  const open = sessionOpen(bars, range, session);

  const quote: QuoteEnvelope = {
    v: 1,
    kind: 'quote',
    symbol,
    name: text(meta.longName) ?? text(meta.shortName),
    type,
    exchange: text(meta.fullExchangeName, 40) ?? text(meta.exchangeName, 40),
    currency: typeof meta.currency === 'string' && /^[A-Za-z]{3}$/.test(meta.currency) ? meta.currency : null,
    priceHint,
    price,
    change: change === null ? null : round(change, priceHint + 2),
    changePercent: changePercent === null ? null : round(changePercent, 4),
    changeBasis: type === 'CRYPTOCURRENCY' ? '24h' : 'previous_close',
    previousClose,
    open: open === null ? null : round(open, priceHint + 2),
    openApprox: true,
    dayHigh: num(meta.regularMarketDayHigh),
    dayLow: num(meta.regularMarketDayLow),
    fiftyTwoWeekHigh: num(meta.fiftyTwoWeekHigh),
    fiftyTwoWeekLow: num(meta.fiftyTwoWeekLow),
    volume: positive(meta.regularMarketVolume),
    market: {
      ...marketPhaseAt(type, periods, fetchedAt),
      timezone,
      tzAbbr: text(meta.timezone, 8),
      periods,
    },
    series: buildSeries(bars, range, session, priceHint, previousClose),
    source: 'yahoo',
    provider: 'yahoo',
    delayed: false,
    asOf,
    fetchedAt,
    stale: false,
    staleReason: null,
    resolvedFrom: null,
  };
  return { ok: true, quote };
}

function readBars(result: Rec): Bar[] {
  const timestamps = Array.isArray(result.timestamp) ? (result.timestamp as unknown[]) : [];
  const indicators = isRecord(result.indicators) ? result.indicators : null;
  const first = indicators && Array.isArray(indicators.quote) ? (indicators.quote[0] as unknown) : null;
  const columns = isRecord(first) ? first : {};
  const opens = Array.isArray(columns.open) ? (columns.open as unknown[]) : [];
  const closes = Array.isArray(columns.close) ? (columns.close as unknown[]) : [];
  const bars: Bar[] = [];
  timestamps.forEach((t, i) => {
    const time = num(t);
    if (time !== null) bars.push({ t: time, open: num(opens[i]), close: num(closes[i]) });
  });
  return bars;
}

function instrumentType(value: unknown): InstrumentType {
  return typeof value === 'string' && (INSTRUMENT_TYPES as readonly string[]).includes(value)
    ? (value as InstrumentType)
    : 'OTHER';
}

function ianaZone(value: unknown): string | null {
  const zone = text(value, 64);
  return zone !== null && /^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)*$/.test(zone) ? zone : null;
}

function period(value: unknown): TradingPeriod | null {
  if (!isRecord(value)) return null;
  const start = num(value.start);
  const end = num(value.end);
  return start !== null && end !== null && end > start ? { start, end } : null;
}

/** The current or next session. After the close Yahoo already describes the next one. */
function currentPeriods(value: unknown): MarketPeriods | null {
  if (!isRecord(value)) return null;
  const regular = period(value.regular);
  return regular ? { pre: period(value.pre), regular, post: period(value.post) } : null;
}

/**
 * The span of the latest session the bars belong to, from `tradingPeriods`. Unlike
 * currentTradingPeriod it does not roll forward after the close, so the chart window and the
 * session's bars always agree.
 */
function lastSession(value: unknown): TradingPeriod | null {
  const groups = Array.isArray(value) ? value : isRecord(value) && Array.isArray(value.regular) ? value.regular : null;
  const last = groups ? (groups[groups.length - 1] as unknown) : null;
  const spans = (Array.isArray(last) ? last : [last]).map(period).filter((p): p is TradingPeriod => p !== null);
  if (spans.length === 0) return null;
  return { start: Math.min(...spans.map((p) => p.start)), end: Math.max(...spans.map((p) => p.end)) };
}

/** The first bar's open in the latest session: close to, but not always equal to, the official open. */
function sessionOpen(bars: readonly Bar[], range: Range, session: TradingPeriod | null): number | null {
  const interval = RANGE_INTERVAL[range];
  if (interval === '1wk') return null;
  if (interval === '1d') return bars[bars.length - 1]?.open ?? null;
  const inSession = session ? bars.filter((bar) => bar.t >= session.start && bar.t < session.end) : [];
  const candidates = inSession.length > 0 ? inSession : range === '1d' ? bars : [];
  return candidates.find((bar) => bar.open !== null)?.open ?? null;
}

function buildSeries(
  bars: readonly Bar[],
  range: Range,
  session: TradingPeriod | null,
  priceHint: number,
  previousClose: number | null,
): QuoteSeries | null {
  const points: Point[] = bars.filter((bar) => bar.close !== null).map((bar) => [bar.t, bar.close as number]);
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return null;

  // For 1d the x-axis is the whole session, so mid-session the line stops part-way across.
  const useSession = range === '1d' && session !== null && first[0] >= session.start && last[0] <= session.end;
  const start = useSession ? session.start : first[0];
  const end = useSession ? session.end : last[0];
  const decimals = priceHint + 2;

  return {
    range,
    interval: RANGE_INTERVAL[range],
    start,
    end,
    points: downsample(points, MAX_SERIES_POINTS).map(([t, close]) => [t - start, round(close, decimals)] as const),
    baseline: range === '1d' ? previousClose : round(first[1], decimals),
  };
}
