// How stock writes prices, changes, times and ages: the instrument's own currency and decimals,
// never a hard-coded '$', and a sign and arrow on every change.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MINUS,
  formatAge,
  formatChange,
  formatClock,
  formatCompact,
  formatDay,
  formatDuration,
  formatNumber,
  formatPercent,
  formatPrice,
  formatSigned,
  toneOf,
} from './format';

afterEach(() => vi.restoreAllMocks());

describe('prices', () => {
  it('follow the price hint and the currency, with the ISO code after the number', () => {
    expect(formatPrice(332.89, 'USD', 2)).toBe('332.89 USD');
    expect(formatPrice(152.09, 'AUD', 2)).toBe('152.09 AUD');
    expect(formatPrice(0.6978, 'USD', 4)).toBe('0.6978 USD');
    expect(formatPrice(2893.5, 'JPY', 0)).toBe('2,894 JPY');
    expect(formatPrice(85459.57, 'USD', 2)).toBe('85,459.57 USD');
  });

  it('write minor units as their own suffix: pence for London', () => {
    expect(formatPrice(127.2, 'GBp', 2)).toBe('127.20p');
    expect(formatPrice(4512, 'ZAc', 0)).toBe('4,512c');
    expect(formatPrice(1234.5, 'ILA', 1)).toBe('1,234.5 ag');
  });

  it('never invent a currency', () => {
    expect(formatPrice(10, null, 2)).toBe('10.00');
    expect(formatPrice(10, 'us dollars', 2)).toBe('10.00');
    for (const value of [formatPrice(1, 'USD', 2), formatPrice(1, 'AUD', 2), formatPrice(1, null, 2)]) expect(value).not.toContain('$');
  });
});

describe('changes', () => {
  it('always show the sign and the arrow, with a real minus', () => {
    expect(formatChange(0.65, 0.4293, 2)).toBe('▲ +0.65 (+0.43%)');
    expect(formatChange(-0.8, -0.2397, 2)).toBe(`▼ ${MINUS}0.80 (${MINUS}0.24%)`);
    expect(formatChange(0, 0, 2)).toBe('◆ 0.00 (0.00%)');
    expect(formatChange(null, -0.698, 2)).toBe(`▼ ${MINUS}0.70%`);
    expect(formatChange(null, null, 2)).toBeNull();
    expect(formatPercent(1.5)).toBe('▲ +1.50%');
    expect(formatPercent(null)).toBeNull();
  });

  it('never print -0, and call a change flat when it rounds to nothing', () => {
    expect(formatNumber(-0, 2)).toBe('0.00');
    expect(formatNumber(-0.001, 2)).toBe('0.00');
    expect(formatSigned(-0.001, 2)).toBe('0.00');
    expect(toneOf(-0.001, 2)).toBe('flat');
    expect(toneOf(0.01, 2)).toBe('up');
    expect(toneOf(-0.01, 2)).toBe('down');
    expect(toneOf(null, 2)).toBe('flat');
  });
});

describe('volumes', () => {
  it('are compact', () => {
    expect(formatCompact(34_328_912)).toBe('34.3M');
    expect(formatCompact(1_100)).toBe('1.1K');
  });

  it('fall back when Intl lacks compact notation', () => {
    vi.spyOn(Intl, 'NumberFormat').mockImplementation(() => {
      throw new RangeError('notation');
    });
    expect(formatCompact(34_328_912)).toBe('34.3M');
    expect(formatCompact(2_500_000_000)).toBe('2.5B');
    expect(formatCompact(512)).toBe('512');
    expect(formatNumber(1234.5, 2)).toBe('1234.50');
  });
});

describe('times', () => {
  // 2026-10-05 20:00 UTC: 4:00 PM in New York (EDT), 7:00 AM the next day in Sydney (AEDT).
  const CLOSE = Date.UTC(2026, 9, 5, 20, 0, 0) / 1000;

  it("read the exchange's clock and its abbreviation", () => {
    expect(formatClock(CLOSE, 'America/New_York', 'EDT')).toBe('4:00 PM EDT');
    expect(formatClock(CLOSE, 'Australia/Sydney', 'AEDT')).toBe('7:00 AM AEDT');
    expect(formatClock(CLOSE, 'America/New_York', null)).toBe('4:00 PM');
  });

  it('fall back to UTC for an unknown zone', () => {
    expect(formatClock(CLOSE, null, 'EDT')).toBe('20:00 UTC');
    expect(formatClock(CLOSE, 'Not/AZone', 'XYZ')).toBe('20:00 UTC');
  });

  it('write days and months for longer charts', () => {
    expect(formatDay(CLOSE, 'America/New_York', 'day')).toBe('Oct 5');
    expect(formatDay(CLOSE, 'Australia/Sydney', 'day')).toBe('Oct 6');
    expect(formatDay(CLOSE, 'America/New_York', 'month')).toBe('Oct 2026');
  });

  it('say how long until, and how long ago', () => {
    expect(formatDuration(99 * 60_000)).toBe('1h 39m');
    expect(formatDuration(45 * 60_000)).toBe('45m');
    expect(formatDuration(10_000)).toBe('1m');
    expect(formatDuration(51 * 3_600_000)).toBe('2d 3h');
    expect(formatAge(20_000)).toBe('just now');
    expect(formatAge(2 * 60_000)).toBe('2 min ago');
    expect(formatAge(2 * 3_600_000)).toBe('2 h ago');
    expect(formatAge(16 * 3_600_000)).toBe('16 h ago');
    expect(formatAge(3 * 86_400_000)).toBe('3 days ago');
    expect(formatAge(-5000)).toBe('just now');
  });
});
