// The body of date; its spec, in date.ts, loads this the first time date runs, so the
// kernel's chunk carries only the spec.

import type { CommandContext, CommandDoc, ExitCode } from '../../shell/types';
import { parseDate } from '../lib/datespec';
import { localTime } from '../lib/listing';
import { zoneOf } from '../lib/sysread';

/** What --help, help and man say about date, besides its spec (date.ts). */
export const doc: CommandDoc = {
  description:
    "Prints the date and time in your time zone, or in $TZ when it names one; with -u, in UTC. With -d STRING, prints the time STRING describes rather than now: '@1700000000' (seconds since 1970), a date such as '2026-12-25' or 'Dec 25' (midnight unless a time is given), a time such as '14:30', a zone such as 'UTC' or '+05:30' after the time, and words such as 'now', 'today', 'tomorrow', 'yesterday', 'next week', 'last month', '+2 hours' and '3 days ago'; an empty STRING is the start of today. A time without a zone is read in the zone date prints in. With +FORMAT, prints FORMAT with each conversion replaced: %Y year, %m month, %d day, %H hour, %M minute, %S second, %N nanoseconds, %a and %b the day and month names, %Z the zone, %s seconds since 1970, %j day of the year, %u day of the week (1 is Monday), %V the ISO week, %e the day padded with a space, %c %x %X %r the date and time as the C locale writes them. After the %, - drops the padding (%-d), _ pads with spaces, 0 with zeros, ^ makes it upper case, and a number sets the width. Only one of +FORMAT, -I and -R may be given.",
};

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December',
] as const;

/** date's own format: `Tue Oct  6 20:00:00 AEDT 2026`. */
export const DEFAULT_FORMAT = '%a %b %e %H:%M:%S %Z %Y';

const ISO_FORMATS: Readonly<Record<string, string>> = {
  date: '%Y-%m-%d',
  hours: '%Y-%m-%dT%H%:z',
  minutes: '%Y-%m-%dT%H:%M%:z',
  seconds: '%Y-%m-%dT%H:%M:%S%:z',
};

const two = (n: number): string => String(n).padStart(2, '0');

/** `+11`, `+0530`, `-03`: the numeric names tzdata gives zones without letters. */
function numericZone(offset: number): string {
  const sign = offset < 0 ? '-' : '+';
  const abs = Math.abs(offset);
  return `${sign}${two(Math.floor(abs / 60))}${abs % 60 === 0 ? '' : two(abs % 60)}`;
}

/** The zone's abbreviation at `ms`, such as AEDT or CET; numeric where the zone has none. */
export function zoneName(zone: string, ms: number, offset: number): string {
  if (zone === 'UTC' || zone === 'Etc/UTC') return 'UTC';
  for (const locale of ['en-US', 'en-AU', 'en-GB', 'en-NZ', 'en-IN', 'en-CA']) {
    try {
      const name = new Intl.DateTimeFormat(locale, { timeZone: zone, timeZoneName: 'short' })
        .formatToParts(new Date(ms))
        .find((part) => part.type === 'timeZoneName')?.value;
      if (name !== undefined && !/^(?:GMT|UTC)[+\-\u2212]/.test(name)) return name;
    } catch {
      break;
    }
  }
  return numericZone(offset);
}

/** A number as a conversion gives it, with its natural width and padding; or text. */
type Converted = { readonly n: number; readonly width: number; readonly pad: '0' | ' ' } | string;

/** The flags GNU date reads after `%`: - no padding, _ spaces, 0 zeros, ^ upper case, # swap case. */
const DATE_SPEC = /^([-_0^#]*)(\d*)[EO]?(:{0,3}z|[A-Za-z%])/;

/** ISO 8601's week-numbering year and week of a date, as %G and %V give them. */
function isoWeek(year: number, month: number, day: number): { year: number; week: number } {
  const date = Date.UTC(year, month - 1, day);
  const isoDay = ((new Date(date).getUTCDay() + 6) % 7) + 1;
  const thursday = new Date(date + (4 - isoDay) * 86_400_000);
  const isoYear = thursday.getUTCFullYear();
  const week = Math.floor((thursday.getTime() - Date.UTC(isoYear, 0, 1)) / (7 * 86_400_000)) + 1;
  return { year: isoYear, week };
}

/**
 * Formats `ms` in `zone` with date's conversions, GNU's flags (%-d, %_H, %^a, %#Z) and widths
 * (%10s, %3N) included; an unknown conversion is printed as it is.
 */
export function formatDate(format: string, ms: number, zone: string): string {
  const t = localTime(ms, zone);
  const weekday = new Date(Date.UTC(t.year, t.month - 1, t.day)).getUTCDay();
  const dayOfYear = Math.round((Date.UTC(t.year, t.month - 1, t.day) - Date.UTC(t.year, 0, 1)) / 86_400_000) + 1;
  const sign = t.offset < 0 ? '-' : '+';
  const abs = Math.abs(t.offset);
  const hour12 = t.hour % 12 === 0 ? 12 : t.hour % 12;
  const iso = isoWeek(t.year, t.month, t.day);
  const num = (n: number, width: number, pad: '0' | ' ' = '0'): Converted => ({ n, width, pad });
  const conversions: Readonly<Record<string, () => Converted>> = {
    Y: () => num(t.year, 1),
    y: () => num(t.year % 100, 2),
    C: () => num(Math.floor(t.year / 100), 2),
    G: () => num(iso.year, 1),
    g: () => num(iso.year % 100, 2),
    m: () => num(t.month, 2),
    d: () => num(t.day, 2),
    e: () => num(t.day, 2, ' '),
    H: () => num(t.hour, 2),
    k: () => num(t.hour, 2, ' '),
    I: () => num(hour12, 2),
    l: () => num(hour12, 2, ' '),
    M: () => num(t.minute, 2),
    S: () => num(t.second, 2),
    j: () => num(dayOfYear, 3),
    u: () => num(weekday === 0 ? 7 : weekday, 1),
    w: () => num(weekday, 1),
    U: () => num(Math.floor((dayOfYear - 1 + 7 - weekday) / 7), 2),
    W: () => num(Math.floor((dayOfYear - 1 + 7 - ((weekday + 6) % 7)) / 7), 2),
    V: () => num(iso.week, 2),
    s: () => num(Math.floor(ms / 1000), 1),
    p: () => (t.hour < 12 ? 'AM' : 'PM'),
    P: () => (t.hour < 12 ? 'am' : 'pm'),
    a: () => (DAYS[weekday] ?? '').slice(0, 3),
    A: () => DAYS[weekday] ?? '',
    b: () => (MONTHS[t.month - 1] ?? '').slice(0, 3),
    h: () => (MONTHS[t.month - 1] ?? '').slice(0, 3),
    B: () => MONTHS[t.month - 1] ?? '',
    Z: () => zoneName(zone, ms, t.offset),
    z: () => `${sign}${two(Math.floor(abs / 60))}${two(abs % 60)}`,
    ':z': () => `${sign}${two(Math.floor(abs / 60))}:${two(abs % 60)}`,
    '::z': () => `${sign}${two(Math.floor(abs / 60))}:${two(abs % 60)}:00`,
    ':::z': () => (abs % 60 === 0 ? `${sign}${two(Math.floor(abs / 60))}` : `${sign}${two(Math.floor(abs / 60))}:${two(abs % 60)}`),
    F: () => `${t.year}-${two(t.month)}-${two(t.day)}`,
    T: () => `${two(t.hour)}:${two(t.minute)}:${two(t.second)}`,
    D: () => `${two(t.month)}/${two(t.day)}/${two(t.year % 100)}`,
    x: () => `${two(t.month)}/${two(t.day)}/${two(t.year % 100)}`,
    X: () => `${two(t.hour)}:${two(t.minute)}:${two(t.second)}`,
    R: () => `${two(t.hour)}:${two(t.minute)}`,
    r: () => `${two(hour12)}:${two(t.minute)}:${two(t.second)} ${t.hour < 12 ? 'AM' : 'PM'}`,
    c: () => `${(DAYS[weekday] ?? '').slice(0, 3)} ${(MONTHS[t.month - 1] ?? '').slice(0, 3)} ${String(t.day).padStart(2)} ${two(t.hour)}:${two(t.minute)}:${two(t.second)} ${t.year}`,
    n: () => '\n',
    t: () => '\t',
    '%': () => '%',
  };
  let result = '';
  let i = 0;
  while (i < format.length) {
    const c = format.charAt(i);
    const match = c === '%' ? DATE_SPEC.exec(format.slice(i + 1)) : null;
    if (match === null) {
      result += c;
      i += 1;
      continue;
    }
    const [whole, flags = '', widthText = '', letter = ''] = match;
    i += 1 + whole.length;
    const width = widthText === '' ? null : Math.min(1024, Number(widthText));
    if (letter === 'N') {
      // Nanoseconds; a width keeps that many leading digits, so %3N is milliseconds.
      const digits = String((((ms % 1000) + 1000) % 1000) * 1_000_000).padStart(9, '0');
      result += width === null || flags.includes('-') ? digits : digits.slice(0, width).padEnd(width, '0');
      continue;
    }
    const conversion = conversions[letter];
    if (conversion === undefined) {
      result += `%${whole}`;
      continue;
    }
    const value = conversion();
    let text: string;
    if (typeof value === 'string') {
      const pad = flags.includes('0') ? '0' : ' ';
      text = width === null ? value : value.padStart(width, pad);
    } else if (flags.includes('-')) {
      text = String(value.n);
    } else {
      const pad = flags.includes('_') ? ' ' : flags.includes('0') ? '0' : value.pad;
      const digits = String(Math.abs(value.n)).padStart((width ?? value.width) - (value.n < 0 ? 1 : 0), pad);
      text = value.n < 0 ? `-${digits}` : digits;
    }
    if (flags.includes('^')) text = text.toUpperCase();
    else if (flags.includes('#')) text = letter === 'p' || letter === 'Z' ? text.toLowerCase() : text.toUpperCase();
    result += text;
  }
  return result;
}

/** Runs date. */
export async function run(ctx: CommandContext): Promise<ExitCode | void> {
  if (ctx.args.length > 1) return ctx.usage(`extra operand '${ctx.args[1] ?? ''}'`);
  const [given] = ctx.args;
  const described = ctx.opts.date;
  if (given !== undefined && !given.startsWith('+')) {
    if (typeof described !== 'string') return ctx.fail(`invalid date '${given}'`);
    return ctx.usage(
      `the argument '${given}' lacks a leading '+';\nwhen using an option to specify date(s), any non-option\nargument must be a format string beginning with '+'`,
    );
  }
  const iso = ctx.opts['iso-8601'];
  const rfc = ctx.opts['rfc-email'] === true;
  if ([given !== undefined, iso !== undefined, rfc].filter(Boolean).length > 1) return ctx.fail('multiple output formats specified');
  let format = given === undefined ? DEFAULT_FORMAT : given.slice(1);
  if (iso !== undefined) {
    const fmt = typeof iso === 'string' ? iso : 'date';
    const found = ISO_FORMATS[fmt];
    if (found === undefined) return ctx.fail(`invalid argument '${fmt}' for '--iso-8601'`);
    format = found;
  } else if (rfc) {
    format = '%a, %d %b %Y %H:%M:%S %z';
  }
  // -u is TZ=UTC0, as POSIX has it: STRING is read in UTC too.
  const zone = ctx.opts.utc === true ? 'UTC' : zoneOf(ctx);
  const at = typeof described === 'string' ? parseDate(described, ctx.clock.now(), zone) : ctx.clock.now();
  if (at === null) return ctx.fail(`invalid date '${String(described)}'`);
  await ctx.stdout.write(`${formatDate(format, at, zone)}\n`);
  return 0;
}
