// Dates as `touch -d` reads them, the common part of GNU's date syntax: a moment as @SECONDS,
// a calendar date (2026-10-06, 2026/10/06, 6 Oct 2026, Oct 6), a time of day (14:30, 14:30:15),
// both at once (2026-10-06T14:30:00Z), a zone (UTC, Z, +11:00), and relative words (now, today,
// yesterday, tomorrow, 3 days ago, +2 hours, next week, last month). A date with no time is
// midnight; a time with no date is today. Wall-clock times are in `timeZone` unless the text names
// a zone. Also `touch -t`'s [[CC]YY]MMDDhhmm[.ss].

import { localTime } from './listing';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const UNITS: Readonly<Record<string, { readonly ms?: number; readonly days?: number; readonly months?: number }>> = {
  sec: { ms: 1000 },
  second: { ms: 1000 },
  min: { ms: 60_000 },
  minute: { ms: 60_000 },
  hour: { ms: 3_600_000 },
  day: { days: 1 },
  week: { days: 7 },
  fortnight: { days: 14 },
  month: { months: 1 },
  year: { months: 12 },
};

interface Fields {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  ms: number;
}

/** The epoch milliseconds of a wall-clock time in `timeZone`, or with a fixed offset in minutes. */
export function fromWallClock(fields: Fields, timeZone: string, offset?: number): number {
  const naive = Date.UTC(fields.year, fields.month - 1, fields.day, fields.hour, fields.minute, fields.second, fields.ms);
  if (offset !== undefined) return naive - offset * 60_000;
  // The zone's offset at the moment itself, found twice so a DST change is crossed correctly.
  let guess = naive - localTime(naive, timeZone).offset * 60_000;
  guess = naive - localTime(guess, timeZone).offset * 60_000;
  return guess;
}

function unitOf(word: string): (typeof UNITS)[string] | undefined {
  return UNITS[word.replace(/s$/, '')];
}

/** The moment `text` names, or null when it is not a date touch understands. */
export function parseDate(text: string, now: number, timeZone: string): number | null {
  const trimmed = text.trim().toLowerCase();
  if (trimmed === '') return null;
  const epoch = /^@(-?\d+(?:\.\d+)?)$/.exec(trimmed);
  if (epoch !== null) return Math.round(Number(epoch[1]) * 1000);

  const today = localTime(now, timeZone);
  const fields: Fields = { year: today.year, month: today.month, day: today.day, hour: today.hour, minute: today.minute, second: today.second, ms: now % 1000 };
  let dated = false;
  let timed = false;
  let offset: number | undefined;
  let shiftMs = 0;
  let shiftDays = 0;
  let shiftMonths = 0;
  const tokens = trimmed
    .replace(/(\d)t(\d)/, '$1 $2')
    .replace(/(\d)(z|[+-]\d\d:?\d\d)$/, '$1 $2')
    .split(/[\s,]+/)
    .filter((token) => token !== '');
  let last: { ms: number; days: number; months: number } | null = null;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i] ?? '';
    let match: RegExpExecArray | null;
    if ((match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(token)) !== null) {
      Object.assign(fields, { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) });
      dated = true;
    } else if ((match = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?$/.exec(token)) !== null) {
      Object.assign(fields, { hour: Number(match[1]), minute: Number(match[2]), second: Number(match[3] ?? 0), ms: Number(`0.${match[4] ?? '0'}`) * 1000 });
      timed = true;
    } else if (token === 'z' || token === 'utc' || token === 'gmt') {
      offset = 0;
    } else if ((match = /^([+-])(\d\d):?(\d\d)$/.exec(token)) !== null && timed) {
      offset = (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3]));
    } else if (MONTHS.includes(token.slice(0, 3)) && /^[a-z]+\.?$/.test(token)) {
      fields.month = MONTHS.indexOf(token.slice(0, 3)) + 1;
      dated = true;
      // Oct 6 [2026], with the day and year after the month.
      const day = tokens[i + 1];
      if (day !== undefined && /^\d{1,2}$/.test(day)) {
        fields.day = Number(day);
        i += 1;
        const year = tokens[i + 1];
        if (year !== undefined && /^\d{4}$/.test(year)) {
          fields.year = Number(year);
          i += 1;
        }
      }
    } else if (/^\d{1,2}$/.test(token) && MONTHS.includes((tokens[i + 1] ?? '').slice(0, 3))) {
      // 6 Oct [2026]: the day before the month.
      fields.day = Number(token);
    } else if (/^\d{4}$/.test(token) && dated) {
      fields.year = Number(token);
    } else if (token === 'now' || token === 'today') {
      // Now is where everything starts.
    } else if (token === 'yesterday' || token === 'tomorrow') {
      shiftDays += token === 'yesterday' ? -1 : 1;
    } else if (token === 'ago' && last !== null) {
      shiftMs -= 2 * last.ms;
      shiftDays -= 2 * last.days;
      shiftMonths -= 2 * last.months;
      last = null;
    } else if ((token === 'next' || token === 'last') && unitOf(tokens[i + 1] ?? '') !== undefined) {
      const unit = unitOf(tokens[i + 1] ?? '') ?? {};
      const sign = token === 'next' ? 1 : -1;
      shiftMs += sign * (unit.ms ?? 0);
      shiftDays += sign * (unit.days ?? 0);
      shiftMonths += sign * (unit.months ?? 0);
      i += 1;
    } else if ((match = /^([+-]?\d+)([a-z]*)$/.exec(token)) !== null) {
      const unit = unitOf(match[2] !== '' ? (match[2] ?? '') : (tokens[i + 1] ?? ''));
      if (unit === undefined) return null;
      if (match[2] === '') i += 1;
      const n = Number(match[1]);
      last = { ms: n * (unit.ms ?? 0), days: n * (unit.days ?? 0), months: n * (unit.months ?? 0) };
      shiftMs += last.ms;
      shiftDays += last.days;
      shiftMonths += last.months;
    } else {
      const unit = unitOf(token);
      if (unit === undefined) return null;
      // `hour ago`, `week`: one of the unit.
      last = { ms: unit.ms ?? 0, days: unit.days ?? 0, months: unit.months ?? 0 };
      shiftMs += last.ms;
      shiftDays += last.days;
      shiftMonths += last.months;
    }
  }
  if (dated && !timed) Object.assign(fields, { hour: 0, minute: 0, second: 0, ms: 0 });
  if (fields.month < 1 || fields.month > 12 || fields.day < 1 || fields.day > 31 || fields.hour > 23 || fields.minute > 59 || fields.second > 60) return null;
  if (shiftMonths !== 0) {
    const total = fields.year * 12 + (fields.month - 1) + shiftMonths;
    fields.year = Math.floor(total / 12);
    fields.month = (total % 12) + 1;
  }
  fields.day += shiftDays;
  const moment = fromWallClock(fields, timeZone, offset) + shiftMs;
  return Number.isFinite(moment) && Math.abs(moment) <= 8.64e15 ? moment : null;
}

/** touch -t's [[CC]YY]MMDDhhmm[.ss], in `timeZone`; null when it is not one. */
export function parseStamp(text: string, now: number, timeZone: string): number | null {
  const match = /^(\d{8}|\d{10}|\d{12})(?:\.(\d{2}))?$/.exec(text);
  if (match === null) return null;
  const digits = match[1] ?? '';
  const tail = digits.slice(-8);
  let year = localTime(now, timeZone).year;
  if (digits.length === 12) year = Number(digits.slice(0, 4));
  else if (digits.length === 10) {
    const yy = Number(digits.slice(0, 2));
    year = yy >= 69 ? 1900 + yy : 2000 + yy;
  }
  const fields: Fields = {
    year,
    month: Number(tail.slice(0, 2)),
    day: Number(tail.slice(2, 4)),
    hour: Number(tail.slice(4, 6)),
    minute: Number(tail.slice(6, 8)),
    second: Number(match[2] ?? 0),
    ms: 0,
  };
  if (fields.month < 1 || fields.month > 12 || fields.day < 1 || fields.day > 31 || fields.hour > 23 || fields.minute > 59 || fields.second > 60) return null;
  return fromWallClock(fields, timeZone);
}
