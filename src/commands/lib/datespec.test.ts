// touch -d and -t's dates (lib/datespec.ts), in Sydney, where daylight saving starts on
// 4 October 2026.
import { describe, expect, it } from 'vitest';
import { parseDate, parseStamp } from './datespec';

const ZONE = 'Australia/Sydney';
/** 2026-10-06 09:00:00 UTC, 20:00 in Sydney (+11:00). */
const NOW = Date.UTC(2026, 9, 6, 9, 0, 0);
const iso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());

describe('parseDate', () => {
  it.each([
    ['now', '2026-10-06T09:00:00.000Z'],
    ['today', '2026-10-06T09:00:00.000Z'],
    ['@0', '1970-01-01T00:00:00.000Z'],
    ['@1700000000.5', '2023-11-14T22:13:20.500Z'],
    ['2026-10-01', '2026-09-30T14:00:00.000Z'],
    ['2026/10/01', '2026-09-30T14:00:00.000Z'],
    ['2026-10-01 09:30', '2026-09-30T23:30:00.000Z'],
    ['2026-10-01T09:30:15Z', '2026-10-01T09:30:15.000Z'],
    ['2026-10-01 09:30 UTC', '2026-10-01T09:30:00.000Z'],
    ['2026-10-01T09:30:00+02:00', '2026-10-01T07:30:00.000Z'],
    ['14:30', '2026-10-06T03:30:00.000Z'],
    ['yesterday', '2026-10-05T09:00:00.000Z'],
    ['tomorrow 08:00', '2026-10-06T21:00:00.000Z'],
    ['2 days ago', '2026-10-04T09:00:00.000Z'],
    ['3 hours ago', '2026-10-06T06:00:00.000Z'],
    ['+90 minutes', '2026-10-06T10:30:00.000Z'],
    ['-1 week', '2026-09-29T10:00:00.000Z'],
    ['next month', '2026-11-06T09:00:00.000Z'],
    ['last year', '2025-10-06T09:00:00.000Z'],
    ['1 Jan 2025', '2024-12-31T13:00:00.000Z'],
    ['Oct 1', '2026-09-30T14:00:00.000Z'],
    ['March 3 2024 10:00', '2024-03-02T23:00:00.000Z'],
    ['hour ago', '2026-10-06T08:00:00.000Z'],
  ])('%s', (text, expected) => {
    expect(iso(parseDate(text, NOW, ZONE))).toBe(expected);
  });

  it('crosses daylight saving by the calendar: a day before the change is still 20:00', () => {
    // 5 October 2026 20:00 in Sydney is +11:00; 3 October 20:00 was +10:00.
    expect(iso(parseDate('3 days ago', NOW, ZONE))).toBe('2026-10-03T10:00:00.000Z');
  });

  it("reads no text at all as the start of today, as GNU's date -d '' and touch -d '' do", () => {
    expect(iso(parseDate('', NOW, ZONE))).toBe('2026-10-05T13:00:00.000Z');
    expect(iso(parseDate('  ', NOW, ZONE))).toBe('2026-10-05T13:00:00.000Z');
  });

  it('refuses what it does not understand', () => {
    for (const bad of ['nonsense', '2026-13-01', '25:00', '3 lightyears ago', '2026', 'funday', 'next funday']) expect(parseDate(bad, NOW, ZONE), bad).toBeNull();
  });

  it('refuses a day the month does not have, rather than rolling it over', () => {
    for (const bad of ['2024-02-30', '2023-02-29', '1900-02-29', '2024-04-31 10:00', 'Feb 30', '30 Feb 2024', 'Sep 31', '2026-06-31']) {
      expect(parseDate(bad, NOW, ZONE), bad).toBeNull();
    }
    expect(iso(parseDate('2024-02-29', NOW, ZONE))).toBe('2024-02-28T13:00:00.000Z');
    expect(iso(parseDate('2000-02-29', NOW, ZONE))).toBe('2000-02-28T13:00:00.000Z');
    // A relative shift may still go past the end of a month, as GNU's does.
    expect(iso(parseDate('2026-01-31 +1 month', NOW, ZONE))).toBe('2026-03-02T13:00:00.000Z');
  });

  it('refuses a moment past the range of a date, written as @SECONDS too', () => {
    for (const bad of ['@99999999999999999', '@8640000000001', '@-8640000000001']) expect(parseDate(bad, NOW, ZONE), bad).toBeNull();
    expect(parseDate('@8640000000000', NOW, ZONE)).toBe(8.64e15);
  });

  // Tuesday 6 October 2026 in Sydney: a day named alone is the next one on or after today, at
  // midnight; next skips today, last goes back a week from that.
  it.each([
    ['monday', '2026-10-11T13:00:00.000Z'],
    ['Monday', '2026-10-11T13:00:00.000Z'],
    ['mon', '2026-10-11T13:00:00.000Z'],
    ['tuesday', '2026-10-05T13:00:00.000Z'],
    ['this tuesday', '2026-10-05T13:00:00.000Z'],
    ['next monday', '2026-10-11T13:00:00.000Z'],
    ['next tuesday', '2026-10-12T13:00:00.000Z'],
    ['last friday', '2026-10-01T14:00:00.000Z'],
    ['last tuesday', '2026-09-28T14:00:00.000Z'],
    ['fri', '2026-10-08T13:00:00.000Z'],
    ['thurs', '2026-10-07T13:00:00.000Z'],
    ['monday 10:00', '2026-10-11T23:00:00.000Z'],
    ['monday next week', '2026-10-18T13:00:00.000Z'],
    ['tomorrow 9am', '2026-10-06T22:00:00.000Z'],
    ['9am', '2026-10-05T22:00:00.000Z'],
    ['9 pm', '2026-10-06T10:00:00.000Z'],
    ['9:30pm', '2026-10-06T10:30:00.000Z'],
    ['9:30 p.m.', '2026-10-06T10:30:00.000Z'],
    ['12am', '2026-10-05T13:00:00.000Z'],
    ['12pm', '2026-10-06T01:00:00.000Z'],
    ['next friday 5pm', '2026-10-09T06:00:00.000Z'],
  ])('reads days of the week and am/pm: %s', (text, expected) => {
    expect(iso(parseDate(text, NOW, ZONE))).toBe(expected);
  });

  it('refuses an hour that am or pm cannot take', () => {
    for (const bad of ['13pm', '0am', '13:00pm', '9 am pm']) expect(parseDate(bad, NOW, ZONE), bad).toBeNull();
  });
});

describe('parseStamp', () => {
  it('reads [[CC]YY]MMDDhhmm[.ss]', () => {
    expect(iso(parseStamp('202501020304.05', NOW, ZONE))).toBe('2025-01-01T16:04:05.000Z');
    expect(iso(parseStamp('2501020304', NOW, ZONE))).toBe('2025-01-01T16:04:00.000Z');
    expect(iso(parseStamp('7001020304', NOW, ZONE))).toBe('1970-01-01T17:04:00.000Z');
    expect(iso(parseStamp('10011200', NOW, ZONE))).toBe('2026-10-01T02:00:00.000Z');
    for (const bad of ['99', '20251302', '2025010203041', '202501020304.5', '202402300000', '02310000']) expect(parseStamp(bad, NOW, ZONE), bad).toBeNull();
    expect(iso(parseStamp('202402290000', NOW, ZONE))).toBe('2024-02-28T13:00:00.000Z');
  });
});
