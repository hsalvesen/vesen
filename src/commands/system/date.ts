// date: print the date and time, as coreutils' date does: in the visitor's time zone (or $TZ),
// or UTC with -u, in date's own format or a +FORMAT of the common conversions.

import { defineCommand } from '../../shell/types';
import { localTime } from '../lib/listing';

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

/** True when the platform knows the zone. */
function knownZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

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

/** Formats `ms` in `zone` with date's conversions; an unknown one is printed as it is. */
export function formatDate(format: string, ms: number, zone: string): string {
  const t = localTime(ms, zone);
  const weekday = new Date(Date.UTC(t.year, t.month - 1, t.day)).getUTCDay();
  const dayOfYear = Math.round((Date.UTC(t.year, t.month - 1, t.day) - Date.UTC(t.year, 0, 1)) / 86_400_000) + 1;
  const sign = t.offset < 0 ? '-' : '+';
  const abs = Math.abs(t.offset);
  const hour12 = t.hour % 12 === 0 ? 12 : t.hour % 12;
  const conversions: Readonly<Record<string, () => string>> = {
    Y: () => String(t.year),
    y: () => two(t.year % 100),
    m: () => two(t.month),
    d: () => two(t.day),
    e: () => String(t.day).padStart(2),
    H: () => two(t.hour),
    I: () => two(hour12),
    M: () => two(t.minute),
    S: () => two(t.second),
    p: () => (t.hour < 12 ? 'AM' : 'PM'),
    a: () => (DAYS[weekday] ?? '').slice(0, 3),
    A: () => DAYS[weekday] ?? '',
    b: () => (MONTHS[t.month - 1] ?? '').slice(0, 3),
    h: () => (MONTHS[t.month - 1] ?? '').slice(0, 3),
    B: () => MONTHS[t.month - 1] ?? '',
    j: () => String(dayOfYear).padStart(3, '0'),
    u: () => String(weekday === 0 ? 7 : weekday),
    w: () => String(weekday),
    s: () => String(Math.floor(ms / 1000)),
    Z: () => zoneName(zone, ms, t.offset),
    z: () => `${sign}${two(Math.floor(abs / 60))}${two(abs % 60)}`,
    F: () => `${t.year}-${two(t.month)}-${two(t.day)}`,
    T: () => `${two(t.hour)}:${two(t.minute)}:${two(t.second)}`,
    D: () => `${two(t.month)}/${two(t.day)}/${two(t.year % 100)}`,
    R: () => `${two(t.hour)}:${two(t.minute)}`,
    n: () => '\n',
    t: () => '\t',
    '%': () => '%',
  };
  let result = '';
  for (let i = 0; i < format.length; i += 1) {
    const c = format.charAt(i);
    if (c !== '%' || i === format.length - 1) {
      result += c;
      continue;
    }
    // %:z is the offset with a colon: +11:00.
    if (format.startsWith(':z', i + 1)) {
      result += `${sign}${two(Math.floor(abs / 60))}:${two(abs % 60)}`;
      i += 2;
      continue;
    }
    const next = format.charAt(i + 1);
    const conversion = conversions[next];
    result += conversion === undefined ? `%${next}` : conversion();
    i += 1;
  }
  return result;
}

export default defineCommand({
  name: 'date',
  category: 'system',
  summary: 'print the date and time',
  synopsis: ['date [-u] [-I[FMT]] [+FORMAT]'],
  description:
    'Prints the date and time in your time zone, or in $TZ when it names one. With +FORMAT, prints FORMAT with each conversion replaced: %Y year, %m month, %d day, %H hour, %M minute, %S second, %a and %b the day and month names, %Z the zone, %s seconds since 1970, %j day of the year, %u day of the week (1 is Monday), %e the day padded with a space.',
  flags: [
    { short: 'u', long: 'utc', description: 'print Coordinated Universal Time (UTC)' },
    { short: 'R', long: 'rfc-email', description: 'print it as email headers do: Tue, 06 Oct 2026 20:00:00 +1100' },
    {
      short: 'I',
      long: 'iso-8601',
      description: "print it in ISO 8601: FMT is 'date' (the default), 'hours', 'minutes' or 'seconds'",
      value: {
        name: 'FMT',
        optional: true,
        source: { kind: 'enum', values: () => Object.keys(ISO_FORMATS).map((value) => ({ value })) },
      },
    },
  ],
  args: [{ name: '+FORMAT', source: { kind: 'free', placeholder: '+%Y-%m-%d' }, optional: true }],
  examples: [
    { line: 'date', offline: true },
    { line: 'date -u', note: 'in UTC', offline: true },
    { line: 'date +%Y-%m-%d', offline: true },
    { line: "date '+%a %e %b, %H:%M'", offline: true },
    { line: 'TZ=Europe/Oslo date', note: 'in another zone', offline: true },
  ],
  seeAlso: ['sleep', 'ls'],
  async run(ctx) {
    if (ctx.args.length > 1) return ctx.fail(`extra operand '${ctx.args[1] ?? ''}'`, 1);
    const [given] = ctx.args;
    if (given !== undefined && !given.startsWith('+')) return ctx.fail(`invalid date '${given}'`);
    let format = given === undefined ? DEFAULT_FORMAT : given.slice(1);
    const iso = ctx.opts['iso-8601'];
    if (iso !== undefined) {
      const fmt = typeof iso === 'string' ? iso : 'date';
      const found = ISO_FORMATS[fmt];
      if (found === undefined) return ctx.fail(`invalid argument '${fmt}' for '--iso-8601'`);
      format = found;
    } else if (ctx.opts['rfc-email'] === true) {
      format = '%a, %d %b %Y %H:%M:%S %z';
    }
    const tz = ctx.env.get('TZ');
    // glibc reads an unknown $TZ as UTC.
    const zone = ctx.opts.utc === true ? 'UTC' : tz !== undefined && tz !== '' ? (knownZone(tz) ? tz : 'UTC') : ctx.clock.timeZone();
    await ctx.stdout.write(`${formatDate(format, ctx.clock.now(), zone)}\n`);
    return 0;
  },
});
