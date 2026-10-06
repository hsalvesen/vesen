// The wire format of the vesen-stock Worker (worker/stock), shared by the Worker and the app.
// It imports nothing and touches no browser API: the Worker bundles this file as it is, and
// commands may import it alongside the other service contracts.
//
// All times are Unix seconds. A value the source did not give is null, never 0.

export const STOCK_API_VERSION = 1;

export const STOCK_API_PATHS = {
  quote: '/v1/quote',
  search: '/v1/search',
  snapshot: '/v1/snapshot',
  health: '/v1/health',
} as const;

// ── Ranges ─────────────────────────────────────────────────────────────────────────────────

export const RANGES = ['1d', '5d', '1mo', '6mo', '1y', '5y'] as const;
export type Range = (typeof RANGES)[number];
export const DEFAULT_RANGE: Range = '1d';

export type Interval = '5m' | '15m' | '60m' | '1d' | '1wk';

/** The bar size asked of the upstream chart for each range. */
export const RANGE_INTERVAL: Readonly<Record<Range, Interval>> = {
  '1d': '5m',
  '5d': '15m',
  '1mo': '60m',
  '6mo': '1d',
  '1y': '1d',
  '5y': '1wk',
};

export function isRange(value: unknown): value is Range {
  return typeof value === 'string' && (RANGES as readonly string[]).includes(value);
}

/** A series never carries more points than this; longer ones are downsampled. */
export const MAX_SERIES_POINTS = 120;

// ── Symbols ────────────────────────────────────────────────────────────────────────────────

/**
 * A canonical ticker: AAPL, CBA.AX, ^AXJO, BTC-USD, AUDUSD=X, BRK-B. Upper case, at most 15
 * characters after an optional caret, and never two dots in a row.
 */
export const SYMBOL_RE = /^(?!.*\.\.)\^?[A-Z0-9][A-Z0-9.=-]{0,14}$/;

export type SymbolCheck =
  | { readonly ok: true; readonly symbol: string }
  | { readonly ok: false; readonly reason: 'empty' | 'too_long' | 'characters' };

/** Exchange prefixes people type (`ASX:CBA`) and the Yahoo suffix each one maps to. */
export const EXCHANGE_SUFFIXES: ReadonlyMap<string, string> = new Map([
  ['ASX', '.AX'],
  ['NZX', '.NZ'],
  ['LSE', '.L'],
  ['LON', '.L'],
  ['TYO', '.T'],
  ['TSX', '.TO'],
  ['HKEX', '.HK'],
  ['NASDAQ', ''],
  ['NYSE', ''],
  ['NYSEARCA', ''],
  ['AMEX', ''],
]);

/**
 * Turns what a visitor typed into a canonical ticker: trims, drops one leading `$`, upper-cases
 * and maps an exchange prefix (`ASX:CBA` → `CBA.AX`). It does not rewrite share classes
 * (`BRK.B` stays as typed; search finds `BRK-B`) or apply SYMBOL_ALIASES.
 */
export function normaliseSymbol(raw: string): SymbolCheck {
  let text = raw.trim();
  if (text.startsWith('$')) text = text.slice(1).trimStart();
  text = text.toUpperCase();
  if (text === '') return { ok: false, reason: 'empty' };

  const colon = text.indexOf(':');
  if (colon > 0) {
    const suffix = EXCHANGE_SUFFIXES.get(text.slice(0, colon));
    if (suffix !== undefined) {
      const base = text.slice(colon + 1).trim();
      if (base === '') return { ok: false, reason: 'empty' };
      text = suffix !== '' && !base.endsWith(suffix) ? base + suffix : base;
    }
  }
  if (text.length > (text.startsWith('^') ? 16 : 15)) return { ok: false, reason: 'too_long' };
  if (!SYMBOL_RE.test(text)) return { ok: false, reason: 'characters' };
  return { ok: true, symbol: text };
}

export interface SymbolAlias {
  readonly symbol: string;
  readonly label: string;
}

/**
 * Names that are not tickers. The Worker tries them only after the upstream says the typed
 * symbol does not exist, so a real ticker always wins.
 */
export const SYMBOL_ALIASES: ReadonlyMap<string, SymbolAlias> = new Map([
  ['SP500', { symbol: '^GSPC', label: 'S&P 500' }],
  ['ASX200', { symbol: '^AXJO', label: 'S&P/ASX 200' }],
  ['NASDAQ', { symbol: '^IXIC', label: 'Nasdaq Composite' }],
  ['DJIA', { symbol: '^DJI', label: 'Dow Jones Industrial Average' }],
  ['FTSE', { symbol: '^FTSE', label: 'FTSE 100' }],
  ['NIKKEI', { symbol: '^N225', label: 'Nikkei 225' }],
  ['BITCOIN', { symbol: 'BTC-USD', label: 'Bitcoin' }],
  ['ETHEREUM', { symbol: 'ETH-USD', label: 'Ether' }],
]);

/** The tickers the scheduled snapshot keeps, so the example chips always have something to show. */
export const CURATED_SYMBOLS = [
  'AAPL',
  'TEAM',
  'CBA.AX',
  'BHP.AX',
  '^AXJO',
  '^GSPC',
  'BTC-USD',
  'AUDUSD=X',
  'MSFT',
  'NVDA',
] as const;

// ── Instruments and markets ────────────────────────────────────────────────────────────────

export const INSTRUMENT_TYPES = [
  'EQUITY',
  'ETF',
  'INDEX',
  'CRYPTOCURRENCY',
  'CURRENCY',
  'MUTUALFUND',
  'FUTURE',
  'OTHER',
] as const;
export type InstrumentType = (typeof INSTRUMENT_TYPES)[number];

/** The only kinds of instrument search returns and names resolve to. */
export const SEARCH_TYPES: readonly InstrumentType[] = ['EQUITY', 'ETF', 'INDEX', 'CRYPTOCURRENCY', 'CURRENCY'];

export type MarketPhase = 'pre' | 'open' | 'post' | 'closed' | 'always_open' | 'unknown';

export interface TradingPeriod {
  readonly start: number;
  readonly end: number;
}

/** The current or next session, as the exchange publishes it. */
export interface MarketPeriods {
  readonly pre: TradingPeriod | null;
  readonly regular: TradingPeriod;
  readonly post: TradingPeriod | null;
}

export interface PhaseInfo {
  readonly phase: MarketPhase;
  /** When the regular session next opens, if the periods say. */
  readonly opensAt: number | null;
  /** When the regular session closes, while it is open. */
  readonly closesAt: number | null;
}

export interface MarketInfo extends PhaseInfo {
  /** IANA zone of the exchange, such as `Australia/Sydney`. */
  readonly timezone: string | null;
  /** The zone's abbreviation at `asOf`, such as `AEDT`. */
  readonly tzAbbr: string | null;
  readonly periods: MarketPeriods | null;
}

/**
 * The market phase at `nowSec`. The Worker stores the phase at fetch time; the app calls this
 * again when it renders, so an older copy never claims a market is open.
 */
export function marketPhaseAt(type: InstrumentType, periods: MarketPeriods | null, nowSec: number): PhaseInfo {
  if (type === 'CRYPTOCURRENCY') return { phase: 'always_open', opensAt: null, closesAt: null };
  if (periods === null) return { phase: 'unknown', opensAt: null, closesAt: null };
  const { pre, regular, post } = periods;
  const within = (p: TradingPeriod | null): boolean => p !== null && p.end > p.start && nowSec >= p.start && nowSec < p.end;
  const opensAt = nowSec < regular.start ? regular.start : null;
  if (within(regular)) return { phase: 'open', opensAt: null, closesAt: regular.end };
  if (within(pre)) return { phase: 'pre', opensAt, closesAt: null };
  if (within(post)) return { phase: 'post', opensAt, closesAt: null };
  return { phase: 'closed', opensAt, closesAt: null };
}

// ── Envelopes ──────────────────────────────────────────────────────────────────────────────

export type ProviderId = 'yahoo' | 'cboe' | 'finnhub';

/** Where an answer came from: a provider, or the curated copy the Worker writes every 15 minutes. */
export type QuoteSource = ProviderId | 'snapshot';

/** What the change is measured against. Crypto trades around the clock, so it uses 24 hours. */
export type ChangeBasis = 'previous_close' | '24h';

/** Why an answer is an older copy rather than live data. */
export type StaleReason = 'upstream_unavailable' | 'rate_limited' | 'snapshot_outdated' | 'snapshot_builtin';

export interface QuoteSeries {
  readonly range: Range;
  readonly interval: Interval;
  /** The window the chart spans: the trading session for 1d, the first to last bar otherwise. */
  readonly start: number;
  readonly end: number;
  /** [seconds since `start`, close], oldest first, at most MAX_SERIES_POINTS. */
  readonly points: ReadonlyArray<readonly [number, number]>;
  /** The line to compare against: the previous close for 1d, the first close otherwise. */
  readonly baseline: number | null;
}

export interface QuoteEnvelope {
  readonly v: 1;
  readonly kind: 'quote';
  readonly symbol: string;
  readonly name: string | null;
  readonly type: InstrumentType;
  /** The exchange's display name, such as `NasdaqGS` or `ASX`. */
  readonly exchange: string | null;
  /** Verbatim from the source, minor units included: `USD`, `AUD`, `GBp`, `ZAc`. */
  readonly currency: string | null;
  /** Decimal places the price is quoted to. */
  readonly priceHint: number;
  readonly price: number;
  readonly change: number | null;
  readonly changePercent: number | null;
  readonly changeBasis: ChangeBasis;
  readonly previousClose: number | null;
  readonly open: number | null;
  /** True when `open` is the first bar's open rather than the exchange's official open. */
  readonly openApprox: boolean;
  readonly dayHigh: number | null;
  readonly dayLow: number | null;
  readonly fiftyTwoWeekHigh: number | null;
  readonly fiftyTwoWeekLow: number | null;
  readonly volume: number | null;
  readonly market: MarketInfo;
  readonly series: QuoteSeries | null;
  readonly source: QuoteSource;
  /** Whose data it is, for attribution, even when `source` is the snapshot. */
  readonly provider: ProviderId;
  /** True when the provider documents a delay (Cboe: 15 minutes). */
  readonly delayed: boolean;
  /** Time of the last trade the price reflects. */
  readonly asOf: number;
  /** When the Worker received it from the provider. */
  readonly fetchedAt: number;
  readonly stale: boolean;
  readonly staleReason: StaleReason | null;
  /** What was asked for when it differs from `symbol`: `CBA` → CBA.AX, `APPLE` → AAPL. */
  readonly resolvedFrom: string | null;
}

export interface SearchHit {
  readonly symbol: string;
  readonly name: string | null;
  readonly exchange: string | null;
  readonly type: InstrumentType;
}

export interface SearchEnvelope {
  readonly v: 1;
  readonly kind: 'search';
  readonly query: string;
  readonly hits: readonly SearchHit[];
}

export interface SnapshotEnvelope {
  readonly v: 1;
  readonly kind: 'snapshot';
  readonly generatedAt: number;
  /** One quote per curated symbol that has ever been fetched; /v1/snapshot leaves out the series. */
  readonly quotes: readonly QuoteEnvelope[];
  /** Curated symbols with no copy at all. */
  readonly missing: readonly string[];
}

export interface HealthEnvelope {
  readonly v: 1;
  readonly kind: 'health';
  readonly ok: true;
  readonly version: string;
  readonly providers: readonly ProviderId[];
  /** True when the snapshot store is bound. */
  readonly snapshot: boolean;
  readonly time: number;
}

export type ErrorCode =
  | 'invalid_symbol'
  | 'bad_request'
  | 'not_found'
  | 'rate_limited'
  | 'origin_not_allowed'
  | 'upstream_unavailable'
  | 'internal';

/** The HTTP status that goes with each error code. An unknown path is a 404 bad_request. */
export const ERROR_STATUS: Readonly<Record<ErrorCode, number>> = {
  invalid_symbol: 400,
  bad_request: 400,
  not_found: 404,
  rate_limited: 429,
  origin_not_allowed: 403,
  upstream_unavailable: 503,
  internal: 500,
};

export interface ApiError {
  readonly code: ErrorCode;
  /** One plain sentence; the app shows its own copy for each code. */
  readonly message: string;
  /** Seconds, for rate_limited and upstream_unavailable; mirrors the Retry-After header. */
  readonly retryAfter?: number;
  /** For not_found: up to five instruments the visitor may have meant. */
  readonly suggestions?: readonly SearchHit[];
}

export interface ErrorEnvelope {
  readonly v: 1;
  readonly kind: 'error';
  readonly error: ApiError;
}

export type StockEnvelope = QuoteEnvelope | SearchEnvelope | SnapshotEnvelope | HealthEnvelope | ErrorEnvelope;

// ── Guards ─────────────────────────────────────────────────────────────────────────────────
// Hand-written so neither side needs a schema library. They check shape and types, not values.

type Rec = Readonly<Record<string, unknown>>;

const isRec = (x: unknown): x is Rec => typeof x === 'object' && x !== null && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isNumOrNull = (x: unknown): boolean => x === null || isNum(x);
const isStrOrNull = (x: unknown): boolean => x === null || typeof x === 'string';
const isOneOf = <T extends string>(values: readonly T[], x: unknown): x is T =>
  typeof x === 'string' && (values as readonly string[]).includes(x);

const PHASES: readonly MarketPhase[] = ['pre', 'open', 'post', 'closed', 'always_open', 'unknown'];
const SOURCES: readonly QuoteSource[] = ['yahoo', 'cboe', 'finnhub', 'snapshot'];
const PROVIDERS: readonly ProviderId[] = ['yahoo', 'cboe', 'finnhub'];
const STALE_REASONS: readonly StaleReason[] = ['upstream_unavailable', 'rate_limited', 'snapshot_outdated', 'snapshot_builtin'];
const ERROR_CODES = Object.keys(ERROR_STATUS) as ErrorCode[];
const INTERVALS: readonly Interval[] = ['5m', '15m', '60m', '1d', '1wk'];

function isPeriod(x: unknown): boolean {
  return isRec(x) && isNum(x.start) && isNum(x.end);
}

function isMarket(x: unknown): boolean {
  if (!isRec(x)) return false;
  const periods = x.periods;
  const periodsOk =
    periods === null ||
    (isRec(periods) &&
      isPeriod(periods.regular) &&
      (periods.pre === null || isPeriod(periods.pre)) &&
      (periods.post === null || isPeriod(periods.post)));
  return (
    isOneOf(PHASES, x.phase) &&
    isNumOrNull(x.opensAt) &&
    isNumOrNull(x.closesAt) &&
    isStrOrNull(x.timezone) &&
    isStrOrNull(x.tzAbbr) &&
    periodsOk
  );
}

function isSeries(x: unknown): boolean {
  if (x === null) return true;
  if (!isRec(x) || !Array.isArray(x.points) || x.points.length > MAX_SERIES_POINTS) return false;
  return (
    isRange(x.range) &&
    isOneOf(INTERVALS, x.interval) &&
    isNum(x.start) &&
    isNum(x.end) &&
    isNumOrNull(x.baseline) &&
    x.points.every((p: unknown) => Array.isArray(p) && p.length === 2 && isNum(p[0]) && isNum(p[1]))
  );
}

function isHit(x: unknown): x is SearchHit {
  return (
    isRec(x) &&
    typeof x.symbol === 'string' &&
    isStrOrNull(x.name) &&
    isStrOrNull(x.exchange) &&
    isOneOf(INSTRUMENT_TYPES, x.type)
  );
}

export function isQuoteEnvelope(x: unknown): x is QuoteEnvelope {
  if (!isRec(x) || x.v !== STOCK_API_VERSION || x.kind !== 'quote') return false;
  const numbersOrNull = [
    'change',
    'changePercent',
    'previousClose',
    'open',
    'dayHigh',
    'dayLow',
    'fiftyTwoWeekHigh',
    'fiftyTwoWeekLow',
    'volume',
  ];
  return (
    typeof x.symbol === 'string' &&
    isStrOrNull(x.name) &&
    isOneOf(INSTRUMENT_TYPES, x.type) &&
    isStrOrNull(x.exchange) &&
    isStrOrNull(x.currency) &&
    isNum(x.priceHint) &&
    isNum(x.price) &&
    numbersOrNull.every((key) => isNumOrNull(x[key])) &&
    isOneOf<ChangeBasis>(['previous_close', '24h'], x.changeBasis) &&
    typeof x.openApprox === 'boolean' &&
    isMarket(x.market) &&
    isSeries(x.series) &&
    isOneOf(SOURCES, x.source) &&
    isOneOf(PROVIDERS, x.provider) &&
    typeof x.delayed === 'boolean' &&
    isNum(x.asOf) &&
    isNum(x.fetchedAt) &&
    typeof x.stale === 'boolean' &&
    (x.staleReason === null || isOneOf(STALE_REASONS, x.staleReason)) &&
    isStrOrNull(x.resolvedFrom)
  );
}

export function isSearchEnvelope(x: unknown): x is SearchEnvelope {
  return (
    isRec(x) &&
    x.v === STOCK_API_VERSION &&
    x.kind === 'search' &&
    typeof x.query === 'string' &&
    Array.isArray(x.hits) &&
    x.hits.every(isHit)
  );
}

export function isSnapshotEnvelope(x: unknown): x is SnapshotEnvelope {
  return (
    isRec(x) &&
    x.v === STOCK_API_VERSION &&
    x.kind === 'snapshot' &&
    isNum(x.generatedAt) &&
    Array.isArray(x.quotes) &&
    x.quotes.every(isQuoteEnvelope) &&
    Array.isArray(x.missing) &&
    x.missing.every((s: unknown) => typeof s === 'string')
  );
}

export function isErrorEnvelope(x: unknown): x is ErrorEnvelope {
  if (!isRec(x) || x.v !== STOCK_API_VERSION || x.kind !== 'error' || !isRec(x.error)) return false;
  const { code, message, retryAfter, suggestions } = x.error;
  return (
    isOneOf(ERROR_CODES, code) &&
    typeof message === 'string' &&
    (retryAfter === undefined || isNum(retryAfter)) &&
    (suggestions === undefined || (Array.isArray(suggestions) && suggestions.every(isHit)))
  );
}
