// The body of weather; its spec, in weather.ts, loads this the first time weather runs.
//
// A place is found in a fixed order (services/weather/resolve.ts): coordinates, the curated
// table, the place cache, Open-Meteo, then OpenStreetMap. With no place, an approximate one from
// the visitor's network is used (docs/plan/05-weather.md: the device is asked by --here only),
// else the last place they looked up, else a few to try. `--here` asks for the device's position,
// and explains when it gets none. One Open-Meteo call brings seven days in metric; units and days
// are the card's business.
//
// On the terminal the forecast is a `weather-card` component block (ui/components/WeatherCard)
// with chips made here, as trusted actions; its plain text, for pipes and files, is the compact
// or the wide layout. --oneline and --json write text only.

import { out, type ChipItem, type Line, type SpanStyle } from '../../output/model';
import type { NetError } from '../../services/types';
import { CURATED_NAMES } from '../../services/weather/places';
import {
  GeoError,
  WeatherError,
  type ArtKey,
  type GeoFailure,
  type Note,
  type Place,
  type UnitSystem,
  type WeatherCardProps,
  type WeatherService,
  type WeatherView,
} from '../../services/weather/types';
import { UNIT_PRESETS, defaultUnits, isUnitSystem } from '../../services/weather/units';
import { DEFAULT_DAYS, MAX_DAYS, ROLE_COLOUR, WIDE_COLS, buildView, renderOneLine, renderPlain } from '../../services/weather/view';
import { ART, wmo, WMO_CODES } from '../../services/weather/wmo';
import type { CommandContext, CommandDoc, ExitCode, InAppBrowser } from '../../shell/types';
import { weatherService } from '../lib/weather';

/** What --help, help and man say about weather, besides its spec (weather.ts). */
export const doc: CommandDoc = {
  description:
    'Shows the current weather and the next days for a place: a name, "City, Country" or "City, Region", or lat,lon. With no place, it uses an approximate location from your network, else the last place you looked up; --here uses this device\'s location instead. Units follow your browser\'s language until you choose them.',
  man: [
    {
      heading: 'PLACES',
      body: `Some names are known without a search: ${CURATED_NAMES.join(', ')}. Anything else is looked up with Open-Meteo, then OpenStreetMap. 'weather -' goes back to the place before, as 'cd -' does.`,
    },
    {
      heading: 'LOCATION',
      body: "--here asks the browser for this device's location, rounded to about a kilometre and never saved; OpenStreetMap names it, and the name is kept only until the page closes. When it gets none, the card says why and uses an approximate location from your network (GeoJS, then ipinfo.io), which is never saved either.",
    },
    {
      heading: 'DATA',
      body: 'Weather data by Open-Meteo.com (CC BY 4.0). Place search © OpenStreetMap contributors (ODbL). The last five places you looked up are kept in this browser, and the answers to up to 50 place searches for 30 days, so a name is not searched for again; weather --forget, or reset, clears them.',
    },
  ],
};

// ── Arguments ──────────────────────────────────────────────────────────────────────────────

export type WeatherTarget =
  | { readonly kind: 'none' }
  | { readonly kind: 'here' }
  | { readonly kind: 'previous' }
  | { readonly kind: 'query'; readonly text: string };

export interface WeatherArgs {
  readonly target: WeatherTarget;
  /** Chosen with a flag; null follows the browser's language. */
  readonly units: UnitSystem | null;
  readonly days: number;
  readonly format: 'card' | 'json' | 'oneline';
  readonly forget: boolean;
  readonly legend: boolean;
}

export type ParsedArgs = { readonly ok: true; readonly args: WeatherArgs } | { readonly ok: false; readonly message: string };

/** A word that is an operand although it starts with a hyphen: coordinates such as -33.87,151.21. */
const NEGATIVE = /^-[\d.]/;

/** Reads weather's words. Messages are for ctx.usage, without the 'weather: ' prefix. */
export function parseWeatherArgs(words: readonly string[]): ParsedArgs {
  const place: string[] = [];
  let units: UnitSystem | null = null;
  let days = DEFAULT_DAYS;
  let format: WeatherArgs['format'] = 'card';
  let here = false;
  let forget = false;
  let legend = false;
  let operands = false;

  const setDays = (value: string | undefined): string | null => {
    if (value === undefined || !/^\d+$/.test(value) || Number(value) < 1 || Number(value) > MAX_DAYS) return `--days must be 1-${MAX_DAYS}`;
    days = Number(value);
    return null;
  };
  const setUnits = (value: string | undefined): string | null => {
    const wanted = value?.toLowerCase() ?? '';
    if (!isUnitSystem(wanted)) return '--units must be metric, imperial or uk';
    units = wanted;
    return null;
  };

  for (let i = 0; i < words.length; i += 1) {
    const word = words[i] ?? '';
    if (operands || word === '-' || !word.startsWith('-') || NEGATIVE.test(word)) {
      place.push(word);
      continue;
    }
    if (word === '--') {
      operands = true;
      continue;
    }
    let problem: string | null = null;
    if (word.startsWith('--')) {
      const eq = word.indexOf('=');
      const name = eq === -1 ? word : word.slice(0, eq);
      const inline = eq === -1 ? undefined : word.slice(eq + 1);
      const takeValue = (): string | undefined => {
        if (inline !== undefined) return inline;
        i += 1;
        return words[i];
      };
      switch (name) {
        case '--units':
          problem = setUnits(takeValue());
          break;
        case '--days':
          problem = setDays(takeValue());
          break;
        case '--imperial':
        case '--metric':
        case '--here':
        case '--json':
        case '--oneline':
        case '--forget':
        case '--legend':
          if (inline !== undefined) return { ok: false, message: `option '${name}' doesn't allow an argument` };
          if (name === '--imperial') units = 'imperial';
          else if (name === '--metric') units = 'metric';
          else if (name === '--here') here = true;
          else if (name === '--json') format = 'json';
          else if (name === '--oneline') format = 'oneline';
          else if (name === '--forget') forget = true;
          else legend = true;
          break;
        default:
          return { ok: false, message: `unknown option '${name}'` };
      }
    } else {
      // Short options, alone or together: -u, -m, -d 3, -d3, -ud3.
      for (let k = 1; k < word.length; k += 1) {
        const c = word.charAt(k);
        if (c === 'u') units = 'imperial';
        else if (c === 'm') units = 'metric';
        else if (c === 'd') {
          const attached = word.slice(k + 1);
          if (attached !== '') problem = setDays(attached);
          else {
            i += 1;
            problem = setDays(words[i]);
          }
          break;
        } else return { ok: false, message: `unknown option '-${c}'` };
      }
    }
    if (problem !== null) return { ok: false, message: problem };
  }

  const text = place.join(' ').trim();
  let target: WeatherTarget;
  if (here) {
    if (text !== '') return { ok: false, message: '--here takes no place' };
    target = { kind: 'here' };
  } else if (text === '-') target = { kind: 'previous' };
  else if (text === '') target = { kind: 'none' };
  else target = { kind: 'query', text };
  if (forget && text !== '') return { ok: false, message: '--forget takes no place' };
  return { ok: true, args: { target, units, days, format, forget, legend } };
}

// ── Lines a chip may run ───────────────────────────────────────────────────────────────────

/** A place name a chip may carry: letters, digits, spaces and , . ' - (02, section 6). */
const SAFE_PLACE = /^[\p{L}\p{N}][\p{L}\p{N} ,.'-]*$/u;
/** Or coordinates. */
const COORDINATES = /^-?\d{1,2}(?:\.\d+)?,-?\d{1,3}(?:\.\d+)?$/;
const MAX_CHIP_PLACE = 100;

/** `place` as a word for a tappable line, or null when it is not safe to put in one. */
export function chipPlace(place: string): string | null {
  const text = place.replace(/\s+/g, ' ').trim();
  if (text === '' || text.length > MAX_CHIP_PLACE) return null;
  if (COORDINATES.test(text)) return text;
  if (!SAFE_PLACE.test(text) || text.split(' ').some((word) => word.startsWith('-'))) return null;
  // An apostrophe would open a quote; inside double quotes nothing else in the set is special.
  return text.includes("'") ? `"${text}"` : text;
}

/** A coordinate as a chip writes it: at most four decimals, never in exponent form. */
const coordinate = (value: number): string => String(Number(value.toFixed(4)));

/** The coordinates of a place, as a chip carries them. */
const coordinates = (place: Place): string => `${coordinate(place.lat)},${coordinate(place.lon)}`;

/** How a later line names the same place: null for "wherever I am" (the network or the device). */
function placeArgument(place: Place, typed: string | undefined): string | null {
  if (place.source === 'ip' || place.source === 'device' || place.approximate) return null;
  if (place.source === 'coords') return coordinates(place);
  if (place.source === 'curated') return chipPlace(place.name) ?? coordinates(place);
  if (typed !== undefined) {
    const safe = chipPlace(typed);
    if (safe !== null) return safe;
  }
  const within = place.region && place.region !== place.name ? place.region : place.countryCode ?? place.country;
  return chipPlace(within ? `${place.name}, ${within}` : place.name) ?? coordinates(place);
}

function unitFlag(units: UnitSystem | null): string[] {
  if (units === 'imperial') return ['-u'];
  if (units === 'metric') return ['-m'];
  if (units === 'uk') return ['--units', 'uk'];
  return [];
}

function line(...words: (string | null | undefined)[]): string {
  return ['weather', ...words.filter((word): word is string => typeof word === 'string' && word !== '')].join(' ');
}

/** The line that runs these arguments again, or null when the place cannot go in one. */
function againLine(args: WeatherArgs): string | null {
  const flags = [...unitFlag(args.units), ...(args.days === DEFAULT_DAYS ? [] : ['-d', String(args.days)])];
  if (args.format !== 'card') flags.push(`--${args.format}`);
  switch (args.target.kind) {
    case 'none':
      return line(...flags);
    case 'here':
      return line('--here', ...flags);
    case 'previous':
      return line(...flags, '-');
    case 'query': {
      const place = chipPlace(args.target.text);
      return place === null ? null : line(...flags, place);
    }
  }
}

function chip(label: string, run: string): ChipItem {
  return { label, action: out.action.run(run) };
}

function alternativeLabel(place: Place): string {
  const country = place.countryCode === 'PS' ? 'Palestine' : place.countryCode ?? place.country;
  return [place.name, place.region, country].filter((part, i, all) => part && all.indexOf(part) === i).join(', ');
}

// ── Messages ───────────────────────────────────────────────────────────────────────────────

const ERROR: SpanStyle = { fg: 'error' };
const MUTED: SpanStyle = { fg: 'muted' };

/** Who a host is, as messages name it, and what it was asked for. */
const HOSTS: Readonly<Record<string, readonly [string, string]>> = {
  'api.open-meteo.com': ['Open-Meteo', 'forecast'],
  'geocoding-api.open-meteo.com': ['Open-Meteo', 'place search'],
  'nominatim.openstreetmap.org': ['OpenStreetMap', 'place search'],
  'get.geojs.io': ['GeoJS', 'location'],
  'ipinfo.io': ['ipinfo.io', 'location'],
};

function who(host: string): readonly [string, string] {
  return Object.prototype.hasOwnProperty.call(HOSTS, host) ? (HOSTS[host] ?? [host, 'request']) : [host, 'request'];
}

/** A failed request in words: the error line, then any hints. */
export function netMessage(error: NetError): string[] {
  const [name, what] = who(error.host);
  switch (error.kind) {
    case 'offline':
      return ['weather: you appear to be offline.'];
    case 'timeout':
      return [`weather: ${name} didn't answer within ${Math.round((error.timeoutMs ?? 8000) / 1000)} s.`];
    case 'http': {
      if (error.status === 429) return [`weather: rate-limited by ${name} (HTTP 429). Try again in a minute.`];
      const reason = (error as NetError & { readonly reason?: unknown }).reason;
      const head = `weather: ${name} ${what} error (HTTP ${error.status ?? '?'})`;
      return typeof reason === 'string' && reason.trim() !== '' ? [head, reason.trim()] : [head];
    }
    case 'parse':
      return [`weather: ${name} sent an answer that could not be read.`];
    case 'cors':
    case 'network':
      return [`weather: couldn't reach ${name}. Check the connection and try again.`];
    case 'abort':
      return ['weather: cancelled.'];
  }
}

/** Writes an error line and its hints to stderr, then any chips; returns 1. */
async function report(ctx: CommandContext, lines: readonly string[], chips: readonly ChipItem[] = []): Promise<ExitCode> {
  const [head, ...hints] = lines;
  await ctx.stderr.line(out.span(head ?? 'weather: something went wrong.', ERROR));
  for (const hint of hints) await ctx.stderr.line(out.span(hint, MUTED));
  if (chips.length > 0 && ctx.stdout.isTTY) await ctx.stdout.block(out.chips(chips));
  return 1;
}

const IN_APP: Readonly<Record<InAppBrowser, string>> = { instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok' };

// ── Finding the place ──────────────────────────────────────────────────────────────────────

/** How long the device may take once permission was already given, and when the browser asks. */
export const LOCATE_GRANTED_MS = 8000;
export const LOCATE_PROMPT_MS = 15_000;

interface Located {
  readonly place: Place;
  readonly notes: readonly Note[];
  /** What the visitor typed, for chips that name the place again. */
  readonly typed?: string;
}

class Failure extends Error {
  constructor(readonly lines: readonly string[], readonly chips: readonly ChipItem[] = []) {
    super(lines[0] ?? 'weather failed');
    this.name = 'Failure';
  }
}

/** The help a bare `weather` gives when it can find no location at all. */
class NowhereToShow extends Error {}

function abortedBy(ctx: CommandContext, error: unknown): boolean {
  return ctx.signal.aborted || (ctx.net.isError(error) && error.kind === 'abort');
}

/** A device position as a place, named by OpenStreetMap when it can be. */
async function devicePlace(ctx: CommandContext, service: WeatherService, lat: number, lon: number): Promise<Place> {
  const named = await service.reverse(lat, lon, ctx.signal);
  const base: Place = { id: `pt:${lat.toFixed(2)},${lon.toFixed(2)}`, name: 'Your location', lat, lon, kind: 'point', source: 'device' };
  if (named === null) return base;
  const { id: _id, lat: _lat, lon: _lon, source: _source, ...label } = named;
  return { ...base, ...label, kind: 'point' };
}

/** Typed coordinates, named by OpenStreetMap when it can be; they keep their own position. */
async function namedPoint(ctx: CommandContext, service: WeatherService, place: Place): Promise<Place> {
  const named = await service.reverse(place.lat, place.lon, ctx.signal);
  if (named === null) return place;
  return {
    ...place,
    name: named.name,
    ...(named.region ? { region: named.region } : {}),
    ...(named.countryCode ? { countryCode: named.countryCode } : {}),
    ...(named.country ? { country: named.country } : {}),
    credit: 'osm',
  };
}

async function fromNetwork(ctx: CommandContext, service: WeatherService): Promise<Place> {
  ctx.tty.status('Locating you (approximate)…');
  return service.ipLocate(ctx.signal);
}

/** `--here`: the device's position, or the network's with the reason. */
async function here(ctx: CommandContext, service: WeatherService): Promise<Located> {
  const geo = service.geolocation;
  const permission = await geo.permission();
  let failure: GeoFailure;
  if (permission === 'unsupported' || permission === 'insecure') failure = permission;
  else if (permission === 'denied') failure = 'denied';
  else {
    ctx.tty.status(permission === 'granted' ? 'Locating you…' : 'Waiting for location permission…');
    try {
      const fix = await geo.locate({ timeoutMs: permission === 'granted' ? LOCATE_GRANTED_MS : LOCATE_PROMPT_MS, signal: ctx.signal });
      return { place: await devicePlace(ctx, service, fix.lat, fix.lon), notes: [] };
    } catch (error) {
      if (abortedBy(ctx, error)) throw error;
      failure = error instanceof GeoError ? error.reason : 'unavailable';
    }
  }
  const app = ctx.tty.inApp === null ? undefined : IN_APP[ctx.tty.inApp];
  const place = await fromNetwork(ctx, service);
  return { place, notes: [{ kind: 'device-fallback', reason: failure, ...(app === undefined ? {} : { app }) }] };
}

/**
 * A bare `weather`: the network's approximate location, the last place, or help. The device is
 * asked only by --here, even once it has been allowed (docs/plan/05-weather.md); the card offers
 * [use precise location] for that.
 */
async function wherever(ctx: CommandContext, service: WeatherService): Promise<Located> {
  try {
    return { place: await fromNetwork(ctx, service), notes: [] };
  } catch (error) {
    if (abortedBy(ctx, error)) throw error;
  }
  const last = service.recent()[0];
  if (last) return { place: last, notes: [{ kind: 'last-place' }] };
  throw new NowhereToShow();
}

function previous(service: WeatherService): Located {
  const recent = service.recent();
  const place = recent[1] ?? recent[0];
  if (!place) throw new Failure(['weather: no previous place yet.', 'Look one up first, such as weather Oslo.']);
  return { place, notes: [] };
}

async function typed(ctx: CommandContext, service: WeatherService, text: string): Promise<Located> {
  const { place, notes } = await service.resolve(text, { signal: ctx.signal, onPhase: (label) => ctx.tty.status(label) });
  return { place: place.source === 'coords' ? await namedPoint(ctx, service, place) : place, notes, typed: text };
}

function locate(ctx: CommandContext, service: WeatherService, args: WeatherArgs): Promise<Located> | Located {
  switch (args.target.kind) {
    case 'query':
      return typed(ctx, service, args.target.text);
    case 'previous':
      return previous(service);
    case 'here':
      return here(ctx, service);
    case 'none':
      return wherever(ctx, service);
  }
}

// ── Output ─────────────────────────────────────────────────────────────────────────────────

/** The card switches to the wide layout from this many columns (WeatherCard.svelte's query). */
export const WIDE_FROM = WIDE_COLS + 2;

/**
 * Whether asking for the device again could give a different answer: not inside an in-app
 * browser, which the card has just said cannot share one, nor where the browser cannot share one
 * at all, nor on a page that is not secure.
 */
function deviceMayAnswer(located: Located): boolean {
  return !located.notes.some(
    (note) => note.kind === 'device-fallback' && (note.app !== undefined || note.reason === 'unsupported' || note.reason === 'insecure'),
  );
}

function cardChips(args: WeatherArgs, located: Located, view: WeatherView): { chips: ChipItem[]; also: ChipItem[] } {
  const place = placeArgument(located.place, located.typed);
  const units = unitFlag(args.units);
  const days = args.days === DEFAULT_DAYS ? [] : ['-d', String(args.days)];
  const chips: ChipItem[] = [];
  if (view.units.system === 'imperial') chips.push(chip('°C', line('-m', ...days, place)));
  else chips.push(chip('°F', line('-u', ...days, place)));
  if (args.days < MAX_DAYS) chips.push(chip(`${MAX_DAYS} days`, line(...units, '-d', String(MAX_DAYS), place)));
  // Where asking again would be a dead end, the card's note says where to get a precise location.
  if (deviceMayAnswer(located)) {
    if (located.place.approximate) chips.push(chip('use precise location', line('--here', ...units)));
    else if (located.place.source !== 'device') chips.push(chip('my location', line('--here', ...units)));
  }

  const also: ChipItem[] = [];
  for (const note of located.notes) {
    if (note.kind !== 'alternatives') continue;
    for (const alternative of note.places) {
      const label = alternativeLabel(alternative);
      const within = alternative.region ?? alternative.countryCode;
      const name = chipPlace(within ? `${alternative.name}, ${within}` : alternative.name) ?? coordinates(alternative);
      also.push(chip(label, line(...units, name)));
    }
  }
  return { chips, also };
}

/** The forecast as JSON: the place, the units, and the values as the card shows them. */
function asJson(view: WeatherView): string {
  const { place, current, units } = view;
  const { art: _art, ...now } = current;
  return JSON.stringify(
    {
      place: {
        name: place.name,
        ...(place.knownAs ? { knownAs: place.knownAs } : {}),
        ...(place.region ? { region: place.region } : {}),
        ...(place.country ? { country: place.country } : {}),
        ...(place.countryCode ? { countryCode: place.countryCode } : {}),
        lat: place.lat,
        lon: place.lon,
        ...(place.approximate ? { approximate: true } : {}),
      },
      units: { temperature: units.temp, wind: units.wind, precipitation: units.precip },
      current: now,
      days: view.days.map((day) => ({
        date: day.date,
        conditions: day.cond.label,
        min: day.min,
        max: day.max,
        precipitation: day.precip,
        precipitationChance: day.precipProb,
        windMax: day.windMax,
      })),
      notes: view.notes,
      attribution: [view.attribution.openMeteo, ...(view.attribution.osm ? [view.attribution.osm] : [])],
    },
    null,
    2,
  );
}

/** Every icon, in its colours: for checking the art in each theme (hidden). */
async function legend(ctx: CommandContext): Promise<ExitCode> {
  const lines: Line[] = [];
  const keys = Object.keys(ART) as ArtKey[];
  for (const key of keys) {
    const codes = WMO_CODES.filter((code) => wmo(code).icon === key).join(' ');
    lines.push([out.span(key, { fg: 'fg-strong', bold: true }), out.span(codes === '' ? '' : `  WMO ${codes}`, MUTED)]);
    for (const row of ART[key]) lines.push(row.map(([role, text]) => out.span(text, { fg: ROLE_COLOUR[role] })));
    lines.push([]);
  }
  await ctx.stdout.block(out.lines(lines));
  return 0;
}

/** When no place could be found for a bare `weather`: what to type, and places to tap. */
async function nowhere(ctx: CommandContext): Promise<ExitCode> {
  await ctx.stdout.block(
    out.lines([
      [out.span("weather: couldn't tell where you are.")],
      [out.span('Name a place, "City, Country" or lat,lon, such as: ', MUTED), out.span('weather Oslo')],
    ]),
  );
  if (ctx.stdout.isTTY) await ctx.stdout.block(out.chips(['Gadigal', 'Oslo', 'Aotearoa'].map((name) => chip(`weather ${name}`, `weather ${name}`))));
  return 0;
}

// ── The command ────────────────────────────────────────────────────────────────────────────

async function loadService(args: WeatherArgs): Promise<WeatherService | null> {
  const pending = weatherService();
  if (pending === null) return null;
  try {
    return await pending;
  } catch {
    const again = againLine(args);
    throw new Failure(['weather: could not load the weather service. Check the connection and try again.'], again ? [chip('try again', again)] : []);
  }
}

export async function run(ctx: CommandContext): Promise<ExitCode> {
  const parsed = parseWeatherArgs(ctx.args);
  if (parsed.ok !== true) return ctx.usage(parsed.message);
  const args = parsed.args;
  if (args.legend) return legend(ctx);

  try {
    const service = await loadService(args);
    if (args.forget) {
      service?.forget();
      await ctx.stdout.line('weather: forgot the places you looked up.');
      return 0;
    }
    if (service === null) return await report(ctx, ['weather: there is no weather service here.']);
    return await forecast(ctx, service, args);
  } catch (error) {
    if (abortedBy(ctx, error)) throw ctx.signal.aborted ? ctx.signal.reason : error;
    if (error instanceof NowhereToShow) return nowhere(ctx);
    if (error instanceof Failure) return report(ctx, error.lines, error.chips);
    const again = againLine(args);
    const retry = again === null ? [] : [chip('try again', again)];
    if (error instanceof WeatherError) {
      if (error.kind === 'usage') return ctx.usage(error.message.replace(/^weather: /, ''));
      const hints = [
        ...(error.suggestions.length > 0 ? [`Did you mean: ${error.suggestions.map((name) => `weather ${name}`).join(', ')}?`] : []),
        'Try a city, "City, Country" or lat,lon.',
      ];
      const suggestions = error.suggestions.flatMap((name) => {
        const safe = chipPlace(name);
        return safe === null ? [] : [chip(`weather ${name}`, line(...unitFlag(args.units), safe))];
      });
      return report(ctx, [error.message, ...hints], suggestions);
    }
    if (ctx.net.isError(error)) return report(ctx, netMessage(error), retry);
    throw error;
  }
}

async function forecast(ctx: CommandContext, service: WeatherService, args: WeatherArgs): Promise<ExitCode> {
  const located = await locate(ctx, service, args);
  const { place } = located;
  ctx.tty.status(`Fetching forecast for ${place.name}…`);
  const result = await service.forecast(place.lat, place.lon, ctx.signal);
  service.remember(place);

  const units = args.units ?? defaultUnits(ctx.sys.snapshot().languages);
  const notes: Note[] = [...located.notes];
  if (result.stale) notes.push({ kind: 'stale', ...result.stale });
  const view = buildView(result.forecast, place, UNIT_PRESETS[units], ctx.clock.now(), { days: args.days, notes });

  if (args.format === 'json') {
    await ctx.stdout.write(`${asJson(view)}\n`);
    return 0;
  }
  if (args.format === 'oneline') {
    await ctx.stdout.write(`${renderOneLine(view)}\n`);
    return 0;
  }
  const plain = `${renderPlain(view, ctx.stdout.columns >= WIDE_FROM ? 'wide' : 'compact')}\n`;
  const { chips, also } = ctx.stdout.isTTY ? cardChips(args, located, view) : { chips: [], also: [] };
  // On the card the same-named places are chips after 'Also:', so its text leaves out the note
  // that lists them; the plain text keeps it.
  const shown =
    also.length > 0
      ? buildView(result.forecast, place, UNIT_PRESETS[units], ctx.clock.now(), {
          days: args.days,
          notes: notes.filter((note) => note.kind !== 'alternatives'),
        })
      : view;
  const props: WeatherCardProps = { ...shown, chips, also };
  await ctx.stdout.block(out.component('weather-card', props, plain, view.summary));
  return 0;
}
