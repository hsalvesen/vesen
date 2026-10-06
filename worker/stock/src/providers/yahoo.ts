// Yahoo Finance v8 chart: the primary source for every market. Unofficial and unauthenticated;
// it answers a short, honest User-Agent and rate-limits browser-like ones, so the Worker rotates
// between query1 and query2 and backs off a host for a minute after a 429.

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
} from '../contract';
import { downsample, type Point } from '../downsample';
import { getText, parseJson } from '../upstream';
import {
  coolDown,
  coolingDown,
  isRecord,
  num,
  positive,
  round,
  text,
  type ProviderContext,
  type ProviderResult,
  type QuoteProvider,
  type Rec,
} from './types';

export const YAHOO_HOSTS = [
  { host: 'query1.finance.yahoo.com', timeoutMs: 3000 },
  { host: 'query2.finance.yahoo.com', timeoutMs: 2500 },
] as const;

export function chartUrl(host: string, symbol: string, range: Range): string {
  const query = `range=${range}&interval=${RANGE_INTERVAL[range]}&includePrePost=false`;
  return `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?${query}`;
}

export const yahooProvider: QuoteProvider = {
  id: 'yahoo',
  supports: () => true,
  async quote(symbol, range, ctx) {
    let rateLimited = false;
    let detail = 'no host available';
    for (const { host, timeoutMs } of YAHOO_HOSTS) {
      if (coolingDown(ctx, host)) {
        rateLimited = true;
        detail = `${host} is cooling down after a 429`;
        continue;
      }
      const response = await getText(chartUrl(host, symbol, range), ctx, { timeoutMs });
      if (!response.ok) {
        detail = `${host}: ${response.reason}`;
        if (response.reason === 'no_time') break;
        continue;
      }
      if (response.status === 429) {
        coolDown(ctx, host);
        rateLimited = true;
        detail = `${host}: HTTP 429`;
        continue;
      }
      if (response.status === 200 || response.status === 404) {
        const result = normaliseYahooChart(parseJson(response.body), symbol, range, nowSec(ctx));
        if (result.ok || result.kind === 'not_found') return result;
        detail = `${host}: ${result.detail}`;
        continue;
      }
      detail = `${host}: HTTP ${response.status}`;
    }
    return { ok: false, kind: rateLimited ? 'rate_limited' : 'unavailable', detail };
  },
};

function nowSec(ctx: ProviderContext): number {
  return Math.floor(ctx.now() / 1000);
}

interface Bar {
  readonly t: number;
  readonly open: number | null;
  readonly close: number | null;
}

/**
 * Turns a chart response into a QuoteEnvelope. Yahoo's 404 body (`chart.error.code` "Not Found")
 * is the only not_found; anything else unreadable is `unavailable`, so a format change never
 * tells a visitor that a real ticker does not exist.
 */
export function normaliseYahooChart(raw: unknown, symbol: string, range: Range, fetchedAt: number): ProviderResult {
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
