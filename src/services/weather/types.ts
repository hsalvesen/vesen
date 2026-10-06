// The weather data model: places, forecasts, units and the view a card is drawn from.
// docs/plan/05-weather.md; designs/weather.md "Key interfaces", adapted to the contracts in
// docs/plan/02-architecture-and-contracts.md (a `weather-card` component block, not HTML).

// ── Units ──────────────────────────────────────────────────────────────────────────────────

export type UnitSystem = 'metric' | 'imperial' | 'uk';

/** What each quantity is shown in. Forecasts are always fetched metric and converted locally. */
export interface Units {
  readonly system: UnitSystem;
  readonly temp: '°C' | '°F';
  readonly wind: 'km/h' | 'mph';
  readonly precip: 'mm' | 'in';
}

// ── Places ─────────────────────────────────────────────────────────────────────────────────

export type PlaceSource = 'curated' | 'coords' | 'open-meteo' | 'nominatim' | 'ip' | 'device';
export type PlaceKind = 'city' | 'region' | 'country' | 'point';

export interface Place {
  /** Stable identity: 'cur:gadigal', 'om:2147714', 'osm:R556706', 'pt:-33.87,151.21', 'ip'. */
  readonly id: string;
  /** Shown first: 'Gadigal Country', 'Gaza', 'Oslo'. */
  readonly name: string;
  /** The better-known name of the same point: 'Sydney' for Gadigal Country. */
  readonly knownAs?: string;
  /** State, province or territory: 'New South Wales', 'Gaza Strip'. */
  readonly region?: string;
  /** County or district, used only to match a qualifier such as 'Springfield, Sangamon'. */
  readonly district?: string;
  /** ISO 3166-1 alpha-2, upper case. */
  readonly countryCode?: string;
  /** Display name for the country; PS is always 'Palestine'. */
  readonly country?: string;
  readonly lat: number;
  readonly lon: number;
  readonly kind: PlaceKind;
  readonly source: PlaceSource;
  /** Used to decide which same-named places are worth an "Also:" line. */
  readonly population?: number;
  /** From the visitor's network, not a typed or precise place. */
  readonly approximate?: boolean;
  /** Found through OpenStreetMap, which must then be credited on the card. */
  readonly credit?: 'osm';
}

/** One row of the curated table: names that resolve with no network at all. */
export interface CuratedPlace {
  /** Every spelling that resolves here. The first is the canonical one suggested to visitors. */
  readonly keys: readonly string[];
  readonly name: string;
  readonly knownAs?: string;
  readonly region?: string;
  readonly countryCode: string;
  readonly lat: number;
  readonly lon: number;
  readonly kind?: PlaceKind;
}

// ── Forecasts ──────────────────────────────────────────────────────────────────────────────

type N = number | null;

/** Current conditions in metric units. Times are local to the place: 'YYYY-MM-DDTHH:mm'. */
export interface Current {
  readonly time: string;
  readonly isDay: boolean;
  readonly code: N;
  readonly tempC: N;
  readonly feelsC: N;
  readonly humidity: N;
  readonly precipMm: N;
  readonly windKmh: N;
  readonly gustKmh: N;
  readonly windDeg: N;
}

/** One forecast day in metric units. `date` is local 'YYYY-MM-DD'; sunrise and sunset are 'HH:mm'. */
export interface Daily {
  readonly date: string;
  readonly code: N;
  readonly minC: N;
  readonly maxC: N;
  readonly precipMm: N;
  readonly precipProb: N;
  readonly windMaxKmh: N;
  readonly sunrise: string | null;
  readonly sunset: string | null;
  readonly uvMax: N;
}

export interface Forecast {
  readonly lat: number;
  readonly lon: number;
  /** IANA zone of the place, such as 'Australia/Sydney'. */
  readonly timezone: string;
  /** Open-Meteo's abbreviation, such as 'AEDT' or 'GMT+11'. */
  readonly tzAbbrev: string;
  readonly utcOffsetSeconds: number;
  readonly current: Current;
  /** Seven days, today first. */
  readonly daily: readonly Daily[];
  /** When the response arrived, in epoch milliseconds. */
  readonly fetchedAt: number;
}

// ── Notes and errors ───────────────────────────────────────────────────────────────────────

export type StaleCause = 'offline' | 'timeout' | 'upstream';

/** Something the card says under the forecast. */
export type Note =
  | { readonly kind: 'approximate' }
  | { readonly kind: 'last-place' }
  | { readonly kind: 'country-point' }
  | { readonly kind: 'stale'; readonly ageMs: number; readonly cause: StaleCause }
  | { readonly kind: 'alternatives'; readonly places: readonly Place[] };

export type WeatherErrorKind = 'usage' | 'not-found';

/** A failure that is the visitor's to fix. Network failures stay NetErrors. */
export class WeatherError extends Error {
  readonly kind: WeatherErrorKind;
  /** What the visitor typed, for the message. */
  readonly query: string;
  /** Curated names within a small edit distance, for "Did you mean". */
  readonly suggestions: readonly string[];

  constructor(kind: WeatherErrorKind, message: string, details: { query?: string; suggestions?: readonly string[] } = {}) {
    super(message);
    this.name = 'WeatherError';
    this.kind = kind;
    this.query = details.query ?? '';
    this.suggestions = details.suggestions ?? [];
  }
}

// ── Icons and art ──────────────────────────────────────────────────────────────────────────

export type IconKey =
  | 'clear' | 'partly' | 'cloudy' | 'fog' | 'drizzle' | 'rain' | 'heavyRain'
  | 'sleet' | 'snow' | 'heavySnow' | 'thunder' | 'unknown';

/** Art is drawn per variant: the clear and partly icons have night versions. */
export type ArtKey = IconKey | 'clearNight' | 'partlyNight';

export interface WmoInfo {
  /** The full description: 'Thunderstorm with heavy hail'. */
  readonly label: string;
  /** At most 16 characters, for the compact card's current conditions and the wide day rows. */
  readonly medium: string;
  /** At most 9 characters, for the compact day rows. */
  readonly short: string;
  readonly icon: IconKey;
}

// ── View ───────────────────────────────────────────────────────────────────────────────────

/** What a stretch of card text is for. ROLE_COLOUR in view.ts maps each to a colour token. */
export type WeatherRole =
  | 'text' | 'head' | 'place' | 'cond' | 'temp' | 'cold' | 'hot' | 'wind' | 'pct' | 'mm' | 'dim' | 'warn'
  | 'sun' | 'moon' | 'cloud' | 'rain' | 'snow' | 'bolt' | 'fog';

/** Where one day's low and high (and, today, the current temperature) sit on the shared scale, 0 to 100. */
export interface RangeBar {
  readonly lo: number;
  readonly hi: number;
  readonly now?: number;
}

/** A run of text with a role. */
export type TextSegment = readonly [WeatherRole, string];
/**
 * A range bar. The text is an ASCII drawing of it ('--====----') exactly as many columns wide
 * as the bar, used for plain text and for measuring; the card draws the bar from `RangeBar`.
 */
export type BarSegment = readonly ['bar', string, RangeBar];
export type Segment = TextSegment | BarSegment;
export type Line = readonly Segment[];

/** An art row: segments whose text totals exactly 13 printable ASCII columns. */
export type ArtRow = readonly TextSegment[];

export interface CurrentView {
  readonly time: string;
  readonly isDay: boolean;
  readonly code: number | null;
  readonly label: string;
  readonly medium: string;
  readonly icon: IconKey;
  readonly art: readonly ArtRow[];
  /** Converted and rounded; null when the forecast left it out. */
  readonly temp: number | null;
  readonly feels: number | null;
  readonly humidity: number | null;
  readonly precip: number | null;
  readonly wind: number | null;
  readonly gust: number | null;
  /** A 16-point compass direction the wind blows from, or '' when unknown. */
  readonly windFrom: string;
  readonly uv: number | null;
  readonly sunrise: string | null;
  readonly sunset: string | null;
}

export interface DayView {
  readonly date: string;
  /** 'Today', or a weekday such as 'Wed'. */
  readonly label: string;
  /** 'Today', or a weekday and day of month such as 'Wed 07'. */
  readonly labelLong: string;
  readonly code: number | null;
  readonly cond: WmoInfo;
  readonly min: number | null;
  readonly max: number | null;
  readonly precip: number | null;
  readonly precipProb: number | null;
  readonly windMax: number | null;
  readonly bar: RangeBar | null;
}

export interface WeatherView {
  readonly place: Place;
  /** The place as a compact title ('Gadigal Country · Sydney, AU') and a wide one. */
  readonly title: { readonly compact: string; readonly wide: string };
  readonly units: Units;
  readonly current: CurrentView;
  readonly days: readonly DayView[];
  /** Notes as sentences, in display order. */
  readonly notes: readonly string[];
  readonly attribution: {
    /** Always shown: Open-Meteo's CC BY 4.0 credit. */
    readonly openMeteo: string;
    /** Shown when the place came from OpenStreetMap. */
    readonly osm: string | null;
    /** Local time of the observation and its zone: '14:15 GMT+11'. */
    readonly updated: string;
  };
  /** One sentence for screen readers and the component block's `alt`. */
  readonly summary: string;
  /** Every line at most 36 columns: fits a 320 px phone. */
  readonly compact: readonly Line[];
  /** Every line at most 72 columns. */
  readonly wide: readonly Line[];
}
