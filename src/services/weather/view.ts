// Turns a forecast into the view model a weather card is drawn from: converted values, day rows,
// notes, credits, and the card's text as lines of [role, text] segments in two layouts.
// Compact lines fit 36 columns (a 320 px phone); wide lines fit 72. The card component picks a
// layout by container width at display time, and pipes get plain text from the same lines.

import { charWidth, textWidth, type Colour } from '../../output/model';
import { countryLabel, placeLabel } from './places';
import type {
  ArtRow, BarSegment, CurrentView, Daily, DayView, Forecast, GeoFailure, Line, Note, Place, RangeBar, Segment,
  TextSegment, Units, WeatherRole, WeatherView,
} from './types';
import { formatPrecip, precipitation, round, temperature, windSpeed } from './units';
import { ART_WIDTH, artFor, compass16, wmo } from './wmo';

export const COMPACT_COLS = 36;
export const WIDE_COLS = 72;
export const DEFAULT_DAYS = 3;
export const MAX_DAYS = 7;

/** Bar widths in columns. */
const COMPACT_BAR = 5;
const WIDE_BAR = 10;

/** The colour token each role is drawn in. The bar is shaded from `cold` to `hot` by the card. */
export const ROLE_COLOUR: Readonly<Record<WeatherRole | 'bar', Colour>> = {
  text: 'fg',
  head: 'fg-strong',
  place: 'accent',
  cond: 'fg-strong',
  temp: 'hot',
  cold: 'cold',
  hot: 'hot',
  wind: 'fg',
  pct: 'rain',
  mm: 'rain',
  dim: 'muted',
  warn: 'warn',
  sun: 'sun',
  moon: 'fg-strong',
  cloud: 'fg',
  rain: 'rain',
  snow: 'fg-strong',
  bolt: 'sun',
  fog: 'muted',
  bar: 'cold',
};

export const OPEN_METEO_CREDIT = 'Weather data by Open-Meteo.com (CC BY 4.0)';
export const OSM_CREDIT = 'Place search © OpenStreetMap contributors';

// ── Text measurement ───────────────────────────────────────────────────────────────────────

/** The start of `text` in fewer than `width` columns, then '…'. */
function cut(text: string, width: number): string {
  let out = '';
  let used = 0;
  for (const ch of text) {
    const w = charWidth(ch);
    if (used + w > width - 1) break;
    out += ch;
    used += w;
  }
  return `${out.trimEnd()}…`;
}

/** Cuts `text` to `width` columns, ending in '…' when anything was cut. */
export function fit(text: string, width: number): string {
  if (textWidth(text) <= width) return text;
  return width <= 0 ? '' : cut(text, width);
}

/** Breaks `text` at spaces into lines of at most `width` columns; overlong words are cut. */
export function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let current = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = current ? `${current} ${word}` : word;
    if (textWidth(candidate) <= width) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = fit(word, width);
    }
  }
  if (current) lines.push(current);
  return lines;
}

export function lineWidth(line: Line): number {
  return line.reduce((sum, segment) => sum + textWidth(segment[1]), 0);
}

/** Cuts a line to `width` columns, ending in '…' when anything was cut. */
export function fitLine(line: Line, width: number): Line {
  if (lineWidth(line) <= width) return line;
  const out: Segment[] = [];
  let used = 0;
  for (const segment of line) {
    const w = textWidth(segment[1]);
    if (used + w <= width - 1) {
      out.push(segment);
      used += w;
      continue;
    }
    const role: WeatherRole = segment[0] === 'bar' ? 'dim' : segment[0];
    out.push([role, cut(segment[1], width - used)]);
    break;
  }
  return out;
}

// ── Plain text ─────────────────────────────────────────────────────────────────────────────

/** Lines as plain text, for pipes, files and --oneline's neighbours. */
export function toPlain(lines: readonly Line[]): string {
  return lines.map((line) => line.map((segment) => segment[1]).join('').trimEnd()).join('\n');
}

/** The whole card as plain text; the wide layout unless asked otherwise. */
export function renderPlain(view: WeatherView, layout: 'compact' | 'wide' = 'wide'): string {
  return toPlain(view[layout]);
}

/** One line for --oneline: 'Oslo, NO: clear sky, 12°C (feels 9°C), SSW 13 km/h · today 10–17°C, 0% rain'. */
export function renderOneLine(view: WeatherView): string {
  const { current: c, units } = view;
  const parts = [`${view.title.compact}: ${c.label.toLowerCase()}, ${num(c.temp)}${units.temp} (feels ${num(c.feels)}${units.temp})`];
  const wind = windText(c, units);
  if (wind !== '-') parts[0] += `, ${wind}`;
  const today = view.days[0];
  if (today) {
    const rain = today.precipProb == null ? '' : `, ${today.precipProb}% rain`;
    parts.push(`${today.label.toLowerCase()} ${num(today.min)}–${num(today.max)}${units.temp}${rain}`);
  }
  return parts.join(' · ');
}

// ── Building the view ──────────────────────────────────────────────────────────────────────

export interface ViewOptions {
  /** Forecast rows to show, today first: 1 to 7, default 3. */
  readonly days?: number;
  /** Notes from resolution and fetching, such as a stale forecast or a country-level point. */
  readonly notes?: readonly Note[];
}

const num = (value: number | null): string => (value == null ? '-' : String(value));

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** The local date at the place, from its UTC offset: 'YYYY-MM-DD'. */
function localDate(now: number, utcOffsetSeconds: number): string {
  return new Date(now + utcOffsetSeconds * 1000).toISOString().slice(0, 10);
}

/** The weekday of a 'YYYY-MM-DD' date, computed in UTC so the viewer's own zone never shifts it. */
function weekday(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  if (y === undefined || m === undefined || d === undefined || [y, m, d].some(Number.isNaN)) return date;
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] ?? date;
}

function windText(c: CurrentView, units: Units): string {
  if (c.wind == null) return '-';
  return [c.windFrom, `${c.wind} ${units.wind}`].filter(Boolean).join(' ');
}

function uvText(uv: number | null): string {
  return uv == null ? '-' : uv.toFixed(1);
}

function ageText(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

/** 'Springfield, Illinois, US': a place as the list of same-named matches names it. */
export function alternativeLabel(place: Place): string {
  const country = place.countryCode === 'PS' ? countryLabel('PS') : place.countryCode ?? place.country;
  return [place.name, place.region, country].filter((part, i, all) => part && all.indexOf(part) === i).join(', ');
}

/** The label of the list of same-named places, on the card and in its text. */
export const MATCHES_LABEL = 'Matches:';

const FALLBACK_REASON: Readonly<Record<GeoFailure, string>> = {
  denied: 'Location permission was denied',
  timeout: 'No location arrived in time',
  unavailable: "The device couldn't find its location",
  unsupported: "This browser can't share a location",
  insecure: 'The location needs a secure (https) page',
};

/** A note as a sentence. */
export function noteText(note: Note): string {
  switch (note.kind) {
    case 'approximate':
      return note.label ? `${note.label} (approximate, from your network)` : 'Approximate location from your network.';
    case 'device-fallback':
      if (note.app && note.reason !== 'unsupported' && note.reason !== 'insecure') {
        return `${note.app} didn't share your location, so this uses an approximate network location. Open vesen.app in Safari or Chrome for a precise fix.`;
      }
      return `${FALLBACK_REASON[note.reason]}, so this uses an approximate network location.`;
    case 'last-place':
      return 'Showing the last place you looked up. weather --forget clears it.';
    case 'country-point':
      return 'Country-level point. Try a city for local weather.';
    case 'stale': {
      const why =
        note.cause === 'offline' ? 'you are offline' : note.cause === 'timeout' ? "Open-Meteo didn't answer" : 'Open-Meteo had a problem';
      return `Showing the forecast from ${ageText(note.ageMs)} ago (${why}).`;
    }
    case 'alternatives':
      // One sentence, for the notes a screen reader hears and --json lists; the card's lines
      // show the same places as a list under the one shown (matchLines).
      return `Other matches: ${note.places.map(alternativeLabel).join('; ')}.`;
  }
}

/** '≈ Sydney, New South Wales, AU': the place as the network located it. */
function approximateLabel(place: Place): string {
  const country = place.countryCode === 'PS' ? countryLabel('PS') : place.countryCode ?? place.country;
  const parts = [place.name, place.region, country].filter((part, i, all): part is string => Boolean(part) && all.indexOf(part) === i);
  return `≈ ${parts.join(', ')}`;
}

function collectNotes(place: Place, given: readonly Note[]): Note[] {
  const notes: Note[] = [];
  const kinds = new Set<Note['kind']>();
  const add = (note: Note): void => {
    if (kinds.has(note.kind)) return;
    if (note.kind === 'alternatives' && note.places.length === 0) return;
    kinds.add(note.kind);
    notes.push(note);
  };
  if (place.approximate) add({ kind: 'approximate', label: approximateLabel(place) });
  if (place.kind === 'country') add({ kind: 'country-point' });
  for (const note of given) add(note);
  return notes;
}

function currentView(forecast: Forecast, today: Daily | undefined, units: Units): CurrentView {
  const c = forecast.current;
  const cond = wmo(c.code);
  return {
    time: c.time,
    isDay: c.isDay,
    code: c.code,
    label: cond.label,
    medium: cond.medium,
    icon: cond.icon,
    art: artFor(cond.icon, c.isDay),
    temp: temperature(c.tempC, units),
    feels: temperature(c.feelsC, units),
    humidity: c.humidity == null ? null : round(c.humidity),
    precip: precipitation(c.precipMm, units),
    wind: windSpeed(c.windKmh, units),
    gust: windSpeed(c.gustKmh, units),
    windFrom: compass16(c.windDeg),
    uv: today?.uvMax == null ? null : round(today.uvMax, 1),
    sunrise: today?.sunrise ?? null,
    sunset: today?.sunset ?? null,
  };
}

/** Positions on a scale from `lo` to `hi`, as whole percentages. */
function scale(lo: number, hi: number): (value: number) => number {
  const span = hi - lo;
  return (value) => (span <= 0 ? 50 : Math.min(100, Math.max(0, Math.round(((value - lo) / span) * 100))));
}

function dayViews(forecast: Forecast, start: number, count: number, today: string, current: CurrentView, units: Units): DayView[] {
  const shown = forecast.daily.slice(start, start + count);
  const temps = shown.flatMap((d) => [temperature(d.minC, units), temperature(d.maxC, units)]);
  if (shown[0]?.date === today) temps.push(current.temp);
  const known = temps.filter((t): t is number => t != null);
  const at = scale(Math.min(...known), Math.max(...known));

  return shown.map((d) => {
    const min = temperature(d.minC, units);
    const max = temperature(d.maxC, units);
    const isToday = d.date === today;
    let bar: RangeBar | null = null;
    if (min != null && max != null) {
      const lo = at(Math.min(min, max));
      const hi = at(Math.max(min, max));
      bar = isToday && current.temp != null ? { lo, hi, now: at(current.temp) } : { lo, hi };
    }
    return {
      date: d.date,
      label: isToday ? 'Today' : weekday(d.date),
      labelLong: isToday ? 'Today' : `${weekday(d.date)} ${d.date.slice(8, 10)}`,
      code: d.code,
      cond: wmo(d.code),
      min,
      max,
      precip: precipitation(d.precipMm, units),
      precipProb: d.precipProb == null ? null : round(d.precipProb),
      windMax: windSpeed(d.windMaxKmh, units),
      bar,
    };
  });
}

/** What the bar is drawn with, one cell each: the scale, the day's range on it, and the current temperature. */
export const BAR_TRACK = '─';
export const BAR_RANGE = '━';
export const BAR_NOW = '┃';

/** The bar as text, `cols` wide: ─ outside the day's range, ━ inside, ┃ at the current temperature. */
export function barText(bar: RangeBar, cols: number): string {
  const cell = (pct: number): number => Math.min(cols - 1, Math.max(0, Math.floor((pct / 100) * cols)));
  const from = cell(bar.lo);
  const to = Math.max(from, Math.min(cols - 1, Math.ceil((bar.hi / 100) * cols) - 1));
  const chars: string[] = Array.from({ length: cols }, (_, i) => (i >= from && i <= to ? BAR_RANGE : BAR_TRACK));
  if (bar.now !== undefined) chars[cell(bar.now)] = BAR_NOW;
  return chars.join('');
}

function barSegment(bar: RangeBar | null, cols: number): Segment {
  if (!bar) return ['dim', ' '.repeat(cols)];
  const segment: BarSegment = ['bar', barText(bar, cols), bar];
  return segment;
}

const pad = (text: string, width: number, side: 'start' | 'end'): string => {
  const room = width - textWidth(text);
  if (room <= 0) return text;
  return side === 'start' ? ' '.repeat(room) + text : text + ' '.repeat(room);
};

const deg = (value: number | null): string => (value == null ? '-' : `${value}°`);

function artLines(art: readonly ArtRow[], gap: string, right: readonly Line[]): Line[] {
  return art.map((row, i) => [...row, ['text', gap] as TextSegment, ...(right[i] ?? [])]);
}

/**
 * The same-named places as a list, the one shown first and marked with ›, the others dim, so
 * which was chosen is plain; on the card the others are chips in the same order.
 */
function matchLines(place: Place, others: readonly Place[], width: number): Line[] {
  const lines: Line[] = [[['dim', MATCHES_LABEL]]];
  lines.push([['text', `› ${fit(alternativeLabel(place), width - 2)}`]]);
  for (const other of others) lines.push([['dim', `  ${fit(alternativeLabel(other), width - 2)}`]]);
  return lines;
}

function noteLines(place: Place, notes: readonly Note[], width: number): Line[] {
  return notes.flatMap((note) => {
    if (note.kind === 'alternatives') return matchLines(place, note.places, width);
    const role: WeatherRole = note.kind === 'stale' ? 'warn' : 'dim';
    return wrap(noteText(note), width).map((text): Line => [[role, text]]);
  });
}

/**
 * The temperature unit in force, after the place on the title line: ' (°C)' or ' (°F)', so the
 * [°F] or [°C] chip under the card reads as the switch it is. The wind and precipitation units
 * stand beside their values; naming them here too would cut a long place name.
 */
function unitsNote(units: Units): string {
  return ` (${units.temp})`;
}

function compactLines(view: Omit<WeatherView, 'compact' | 'wide' | 'summary'>, notes: readonly Note[]): Line[] {
  const { current: c, units } = view;
  const W = COMPACT_COLS;
  const inUnits = unitsNote(units);
  const right: Line[] = [
    [['cond', c.medium]],
    [['temp', `${num(c.temp)}${units.temp}`], ['dim', ` feels ${deg(c.feels)}`]],
    [['wind', windText(c, units)], ['dim', c.gust == null ? '' : ` g ${c.gust}`]],
    [['pct', `Hum ${c.humidity == null ? '-' : `${c.humidity}%`}`], ['dim', ' · '], ['mm', `${formatPrecip(c.precip, units)} ${units.precip}`]],
    [['dim', `UV ${uvText(c.uv)} · ${c.sunrise ?? '-'}-${c.sunset ?? '-'}`]],
  ];
  const rows = view.days.map((d): Line => [
    ['text', pad(d.label, 6, 'end')],
    ['cold', pad(deg(d.min), 4, 'start')],
    ['text', ' '],
    barSegment(d.bar, COMPACT_BAR),
    ['text', ' '],
    ['hot', pad(deg(d.max), 4, 'start')],
    ['pct', pad(d.precipProb == null ? '-' : `${d.precipProb}%`, 5, 'start')],
    ['text', ' '],
    ['cond', d.cond.short],
  ]);
  // The full credit, broken where it reads well: 'Weather data by Open-Meteo.com', then
  // '(CC BY 4.0) · Updated 14:15 GMT+11'.
  const credit = view.attribution.openMeteo;
  const cut = credit.lastIndexOf(' (');
  const footer: Line[] = [
    ...(cut > 0 ? [credit.slice(0, cut), `${credit.slice(cut + 1)} · Updated ${view.attribution.updated}`] : [credit]).flatMap((text) =>
      wrap(text, W).map((piece): Line => [['dim', piece]]),
    ),
  ];
  if (view.attribution.osm) footer.push([['dim', '© OpenStreetMap contributors']]);

  const lines: Line[] = [
    [['place', fit(view.title.compact, W - inUnits.length)], ['dim', inUnits]],
    ...artLines(c.art, ' ', right.map((line) => fitLine(line, W - ART_WIDTH - 1))),
    ...rows,
    ...noteLines(view.place, notes, W),
    ...footer,
  ];
  return lines.map((line) => fitLine(line, W));
}

function wideLines(view: Omit<WeatherView, 'compact' | 'wide' | 'summary'>, notes: readonly Note[]): Line[] {
  const { current: c, units } = view;
  const W = WIDE_COLS;
  const head = 'Weather for ';
  const inUnits = unitsNote(units);
  const right: Line[] = [
    [['cond', c.label]],
    [['temp', `${num(c.temp)} ${units.temp}`], ['dim', ` (feels like ${num(c.feels)} ${units.temp})`]],
    [['wind', windText(c, units)], ['dim', c.gust == null ? '' : `, gusts ${c.gust} ${units.wind}`]],
    [
      ['pct', `Humidity ${c.humidity == null ? '-' : `${c.humidity}%`}`],
      ['dim', ' · '],
      ['mm', `Precip ${formatPrecip(c.precip, units)} ${units.precip}`],
    ],
    [['dim', `UV ${uvText(c.uv)} · Sunrise ${c.sunrise ?? '-'} · Sunset ${c.sunset ?? '-'}`]],
  ];
  const header: Line = [
    ['dim', `${pad('Day', 7, 'end')}${pad('Low', 4, 'start')} ${pad('Range', WIDE_BAR, 'end')} High  ${pad('Rain', 12, 'end')} ${pad('Wind', 8, 'end')} Conditions`],
  ];
  const rows = view.days.map((d): Line => [
    ['text', pad(d.labelLong, 7, 'end')],
    ['cold', pad(deg(d.min), 4, 'start')],
    ['text', ' '],
    barSegment(d.bar, WIDE_BAR),
    ['text', ' '],
    ['hot', pad(deg(d.max), 4, 'start')],
    ['text', '  '],
    ['pct', pad(d.precipProb == null ? '-' : `${d.precipProb}%`, 4, 'start')],
    ['text', ' '],
    ['mm', pad(d.precip == null ? '-' : `${formatPrecip(d.precip, units)}${units.precip}`, 7, 'end')],
    ['text', ' '],
    ['wind', pad(d.windMax == null ? '-' : `${d.windMax} ${units.wind}`, 8, 'end')],
    ['text', ' '],
    ['cond', d.cond.medium],
  ]);
  const footer: Line[] = wrap(`Updated ${view.attribution.updated} · ${view.attribution.openMeteo}`, W).map(
    (text): Line => [['dim', text]],
  );
  if (view.attribution.osm) footer.push([['dim', view.attribution.osm]]);

  const lines: Line[] = [
    [['head', head], ['place', fit(view.title.wide, W - head.length - inUnits.length)], ['dim', inUnits]],
    [],
    ...artLines(c.art, '   ', right.map((line) => fitLine(line, W - ART_WIDTH - 3))),
    [],
    header,
    ...rows,
    [],
    ...noteLines(view.place, notes, W),
    ...footer,
  ];
  return lines.map((line) => fitLine(line, W));
}

function summaryText(view: Omit<WeatherView, 'compact' | 'wide' | 'summary'>): string {
  const { current: c, units } = view;
  const parts = [`${c.label}, ${num(c.temp)}${units.temp}, feels like ${num(c.feels)}${units.temp}`];
  if (c.wind != null) parts.push(`wind ${windText(c, units)}`);
  let text = `Weather for ${view.title.wide}: ${parts.join(', ')}.`;
  const first = view.days[0];
  if (first) {
    const rain = first.precipProb == null ? '' : `, ${first.precipProb}% chance of rain`;
    text += ` ${first.label} ${num(first.min)} to ${num(first.max)}${units.temp}${rain}.`;
  }
  return text;
}

/**
 * Builds the view of `forecast` for `place` in `units`. `now` decides which forecast day is
 * today at the place, so a forecast fetched yesterday evening never labels yesterday 'Today'.
 */
export function buildView(forecast: Forecast, place: Place, units: Units, now: number, options: ViewOptions = {}): WeatherView {
  const count = Math.min(MAX_DAYS, Math.max(1, Math.trunc(options.days ?? DEFAULT_DAYS)));
  const today = localDate(now, forecast.utcOffsetSeconds);
  const found = forecast.daily.findIndex((d) => d.date >= today);
  const start = found === -1 ? 0 : found;
  const current = currentView(forecast, forecast.daily[start], units);
  const notes = collectNotes(place, options.notes ?? []);

  const base: Omit<WeatherView, 'compact' | 'wide' | 'summary'> = {
    place,
    title: { compact: placeLabel(place, 'compact'), wide: placeLabel(place, 'wide') },
    units,
    current,
    days: dayViews(forecast, start, count, today, current, units),
    notes: notes.map(noteText),
    attribution: {
      openMeteo: OPEN_METEO_CREDIT,
      osm: place.credit === 'osm' ? OSM_CREDIT : null,
      updated: `${current.time.slice(11, 16)} ${forecast.tzAbbrev}`.trim(),
    },
  };
  return {
    ...base,
    summary: summaryText(base),
    compact: compactLines(base, notes),
    wide: wideLines(base, notes),
  };
}
