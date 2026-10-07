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

  it('refuses what it does not understand', () => {
    for (const bad of ['', 'nonsense', '2026-13-01', '25:00', '3 lightyears ago', '2026', 'monday']) expect(parseDate(bad, NOW, ZONE), bad).toBeNull();
  });
});

describe('parseStamp', () => {
  it('reads [[CC]YY]MMDDhhmm[.ss]', () => {
    expect(iso(parseStamp('202501020304.05', NOW, ZONE))).toBe('2025-01-01T16:04:05.000Z');
    expect(iso(parseStamp('2501020304', NOW, ZONE))).toBe('2025-01-01T16:04:00.000Z');
    expect(iso(parseStamp('7001020304', NOW, ZONE))).toBe('1970-01-01T17:04:00.000Z');
    expect(iso(parseStamp('10011200', NOW, ZONE))).toBe('2026-10-01T02:00:00.000Z');
    for (const bad of ['99', '20251302', '2025010203041', '202501020304.5']) expect(parseStamp(bad, NOW, ZONE), bad).toBeNull();
  });
});
