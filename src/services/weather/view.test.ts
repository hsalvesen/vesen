import { afterEach, describe, expect, it } from 'vitest';
import { isPalette, isRole } from '../../output/model';
import { fixture } from '../../../tests/support/weather';
import { lookupCurated } from './places';
import { parseForecast, parseGeocoding } from './sources';
import type { Daily, Forecast, Line, Note, Place } from './types';
import { UNIT_PRESETS, UNIT_SYSTEMS } from './units';
import { ART, ART_WIDTH } from './wmo';
import { textWidth } from '../../output/model';
import {
  COMPACT_COLS, ROLE_COLOUR, WIDE_COLS, barText, buildView, fit, lineWidth, noteText, renderOneLine, renderPlain,
  toPlain, wrap,
} from './view';

/** 14:15 in Sydney (GMT+11) and 05:15 in Oslo (GMT+2), when the fixtures were recorded. */
const FETCHED = Date.parse('2026-10-06T03:15:00Z');
const NOW = FETCHED + 5 * 60_000;

function forecastFixture(name: string): Forecast {
  const forecast = parseForecast(fixture(name), FETCHED);
  if (!forecast) throw new Error(`${name} is not a forecast`);
  return forecast;
}

const sydney = forecastFixture('forecast-sydney.json');
const oslo = forecastFixture('forecast-oslo.json');
const gadigal = lookupCurated('Gadigal') as Place;
const osloPlace = parseGeocoding(fixture('geocode-oslo.json'))[0] as Place;
const springfields = parseGeocoding(fixture('geocode-springfield.json'));

const longPlace: Place = {
  ...osloPlace,
  name: 'Llanfairpwllgwyngyllgogerychwyrndrobwllllantysiliogogogoch Village',
  knownAs: 'A Very Long Known-As Name',
  region: 'Isle of Anglesey County Council Area',
};
const wideCharPlace: Place = { ...osloPlace, name: '東京都千代田区丸の内一丁目', region: '東京都' };
const combiningPlace: Place = { ...osloPlace, name: 'Tāmaki Makaurau á é í ó ú with marks' };

const ALL_NOTES: readonly Note[] = [
  { kind: 'stale', ageMs: 95 * 60_000, cause: 'timeout' },
  { kind: 'alternatives', places: springfields.slice(1, 3) },
  { kind: 'last-place' },
];

const overflow = (lines: readonly Line[], cols: number): string[] =>
  lines.filter((line) => lineWidth(line) > cols).map((line) => line.map((s) => s[1]).join(''));

describe('layout widths', () => {
  it('keeps compact lines within 36 columns and wide lines within 72', () => {
    const places = [gadigal, osloPlace, longPlace, wideCharPlace, combiningPlace, { ...longPlace, approximate: true, credit: 'osm' as const }];
    for (const forecast of [sydney, oslo]) {
      for (const system of UNIT_SYSTEMS) {
        for (const days of [1, 3, 7]) {
          for (const place of places) {
            for (const notes of [[], ALL_NOTES]) {
              const view = buildView(forecast, place, UNIT_PRESETS[system], NOW, { days, notes });
              expect(overflow(view.compact, COMPACT_COLS)).toEqual([]);
              expect(overflow(view.wide, WIDE_COLS)).toEqual([]);
            }
          }
        }
      }
    }
  });

  it('keeps every line within its width for random forecasts, including extremes and gaps', () => {
    const random = mulberry32(0x5eed);
    for (let run = 0; run < 400; run += 1) {
      const forecast = randomForecast(random);
      const system = pick(random, UNIT_SYSTEMS);
      const place = pick(random, [gadigal, osloPlace, longPlace, wideCharPlace, combiningPlace]);
      const days = 1 + Math.floor(random() * 7);
      const view = buildView(forecast, place, UNIT_PRESETS[system], NOW, { days, notes: ALL_NOTES });
      const context = JSON.stringify({ run, system, days, current: forecast.current, daily: forecast.daily[0] });
      expect(overflow(view.compact, COMPACT_COLS), context).toEqual([]);
      expect(overflow(view.wide, WIDE_COLS), context).toEqual([]);
    }
  });

  it('starts each art row with exactly the 13 art columns', () => {
    const view = buildView(sydney, gadigal, UNIT_PRESETS.metric, NOW);
    const artRows = ART.clear.map((row) => row.map(([, s]) => s).join(''));
    expect(toPlain(view.compact).split('\n').slice(1, 6).map((l) => l.slice(0, ART_WIDTH))).toEqual(artRows);
    expect(toPlain(view.wide).split('\n').slice(2, 7).map((l) => l.slice(0, ART_WIDTH))).toEqual(artRows);
  });
});

describe('cards', () => {
  it('draws the Gadigal card', () => {
    const view = buildView(sydney, gadigal, UNIT_PRESETS.metric, NOW);
    expect(renderPlain(view, 'compact')).toMatchSnapshot();
    expect(renderPlain(view, 'wide')).toMatchSnapshot();
  });

  it('draws the Oslo card at night in imperial units over seven days', () => {
    const view = buildView(oslo, osloPlace, UNIT_PRESETS.imperial, NOW, { days: 7 });
    expect(view.current.art).toBe(ART.clearNight);
    expect(renderPlain(view, 'compact')).toMatchSnapshot();
    expect(renderPlain(view)).toMatchSnapshot();
  });

  it('titles the card from the place', () => {
    const view = buildView(sydney, gadigal, UNIT_PRESETS.metric, NOW);
    expect(view.title).toEqual({
      compact: 'Gadigal Country · Sydney, AU',
      wide: 'Gadigal Country · Sydney, New South Wales, Australia',
    });
    expect(toPlain(view.compact).split('\n')[0]).toBe('Gadigal Country · Sydney, AU');
    expect(toPlain(view.wide).split('\n')[0]).toBe('Weather for Gadigal Country · Sydney, New South Wales, Australia');
  });

  it('cuts a long title with an ellipsis', () => {
    const view = buildView(sydney, longPlace, UNIT_PRESETS.metric, NOW);
    const title = toPlain(view.compact).split('\n')[0] ?? '';
    expect(title).toMatch(/…$/);
    expect(textWidth(title)).toBeLessThanOrEqual(COMPACT_COLS);
  });

  it('converts current conditions and days into the chosen units', () => {
    const metric = buildView(sydney, gadigal, UNIT_PRESETS.metric, NOW);
    expect(metric.current).toMatchObject({ temp: 24, feels: 26, humidity: 51, wind: 6, gust: 25, windFrom: 'W', uv: 7.6 });
    expect(metric.current).toMatchObject({ sunrise: '06:26', sunset: '19:01', label: 'Clear sky', icon: 'clear' });

    const imperial = buildView(sydney, gadigal, UNIT_PRESETS.imperial, NOW);
    expect(imperial.current).toMatchObject({ temp: 76, feels: 80, wind: 3, gust: 15, precip: 0 });
    const imperialText = renderPlain(imperial);
    expect(imperialText).toContain('°F');
    expect(imperialText).toContain('mph');
    expect(imperialText).toMatch(/\d\.\d\din/);
    expect(imperialText).not.toContain('°C');
    expect(imperialText).not.toContain('km/h');

    const uk = renderPlain(buildView(sydney, gadigal, UNIT_PRESETS.uk, NOW));
    expect(uk).toContain('°C');
    expect(uk).toContain('mph');
    expect(uk).toContain('mm');
    expect(uk).not.toContain('°F');
  });

  it('shows missing values as a dash', () => {
    const blank: Forecast = {
      ...sydney,
      current: { ...sydney.current, tempC: null, feelsC: null, windKmh: null, gustKmh: null, windDeg: null, humidity: null, precipMm: null, code: null },
      daily: sydney.daily.map((d) => ({ ...d, code: null, minC: null, maxC: null, precipProb: null, precipMm: null, windMaxKmh: null, uvMax: null, sunrise: null, sunset: null })),
    };
    const view = buildView(blank, gadigal, UNIT_PRESETS.metric, NOW);
    const compact = renderPlain(view, 'compact');
    expect(compact).toContain('-°C feels -');
    expect(compact).toContain('Hum - · - mm');
    expect(compact).toContain('UV - · ---');
    expect(compact.split('\n')).toContain(`Today${' '.repeat(4)}-${' '.repeat(10)}-${' '.repeat(4)}- Unknown`);
    expect(view.days.every((d) => d.bar === null)).toBe(true);
    expect(view.current.label).toBe('Unknown');
  });
});

describe('days', () => {
  it('starts at today at the place and labels the rest by weekday', () => {
    const view = buildView(sydney, gadigal, UNIT_PRESETS.metric, NOW, { days: 7 });
    expect(view.days.map((d) => d.label)).toEqual(['Today', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Mon']);
    expect(view.days.map((d) => d.labelLong).slice(0, 3)).toEqual(['Today', 'Wed 07', 'Thu 08']);
  });

  it('skips a day that is already over at the place', () => {
    // 01:00 UTC on the 7th is midday on Wednesday in Sydney.
    const view = buildView(sydney, gadigal, UNIT_PRESETS.metric, Date.parse('2026-10-07T01:00:00Z'), { days: 3 });
    expect(view.days.map((d) => d.date)).toEqual(['2026-10-07', '2026-10-08', '2026-10-09']);
    expect(view.days[0]?.label).toBe('Today');
    // The current conditions use that day's sunrise and UV.
    expect(view.current.sunrise).toBe(sydney.daily[1]?.sunrise);
  });

  it('clamps the day count to 1-7 and to what the forecast has', () => {
    expect(buildView(sydney, gadigal, UNIT_PRESETS.metric, NOW, { days: 0 }).days).toHaveLength(1);
    expect(buildView(sydney, gadigal, UNIT_PRESETS.metric, NOW, { days: 12 }).days).toHaveLength(7);
    expect(buildView(sydney, gadigal, UNIT_PRESETS.metric, NOW).days).toHaveLength(3);
    const short = { ...sydney, daily: sydney.daily.slice(0, 2) };
    expect(buildView(short, gadigal, UNIT_PRESETS.metric, NOW, { days: 7 }).days).toHaveLength(2);
  });

  describe('in other time zones', () => {
    const original = process.env.TZ;
    afterEach(() => {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    });

    it('labels the same weekdays wherever the viewer is', () => {
      const labels = (): string[] => buildView(sydney, gadigal, UNIT_PRESETS.metric, NOW, { days: 7 }).days.map((d) => d.labelLong);
      const expected = labels();
      for (const zone of ['Pacific/Kiritimati', 'America/Adak', 'UTC', 'Asia/Kathmandu']) {
        process.env.TZ = zone;
        expect(labels(), zone).toEqual(expected);
      }
    });
  });
});

describe('range bars', () => {
  it('puts every day on one scale, with whole percentages and low before high', () => {
    const view = buildView(sydney, gadigal, UNIT_PRESETS.metric, NOW, { days: 7 });
    for (const day of view.days) {
      const bar = day.bar;
      expect(bar).not.toBeNull();
      if (!bar) continue;
      for (const value of [bar.lo, bar.hi, ...(bar.now === undefined ? [] : [bar.now])]) {
        expect(Number.isInteger(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(100);
      }
      expect(bar.lo).toBeLessThanOrEqual(bar.hi);
    }
    expect(Math.min(...view.days.map((d) => d.bar?.lo ?? 100))).toBe(0);
    expect(Math.max(...view.days.map((d) => d.bar?.hi ?? 0))).toBe(100);
  });

  it('marks the current temperature exactly once, on today', () => {
    const view = buildView(sydney, gadigal, UNIT_PRESETS.metric, NOW, { days: 7 });
    expect(view.days.filter((d) => d.bar?.now !== undefined).map((d) => d.label)).toEqual(['Today']);
    for (const layout of [view.compact, view.wide]) {
      const markers = layout.flatMap((line) => line.filter((s) => s[0] === 'bar' && s[1].includes('|')));
      expect(markers).toHaveLength(1);
    }
  });

  it('draws ASCII bars of the exact width', () => {
    expect(barText({ lo: 0, hi: 100 }, 10)).toBe('==========');
    expect(barText({ lo: 20, hi: 60 }, 10)).toBe('--====----');
    expect(barText({ lo: 50, hi: 50 }, 5)).toBe('--=--');
    expect(barText({ lo: 0, hi: 100, now: 100 }, 5)).toBe('====|');
    expect(barText({ lo: 0, hi: 40, now: 0 }, 5)).toBe('|=---');
  });
});

describe('notes and credits', () => {
  it('says when the forecast is stale, in the warning role', () => {
    const view = buildView(sydney, gadigal, UNIT_PRESETS.metric, NOW, { notes: [{ kind: 'stale', ageMs: 14 * 60_000, cause: 'timeout' }] });
    expect(view.notes).toEqual(["Showing the forecast from 14 min ago (Open-Meteo didn't answer)."]);
    const warn = view.wide.filter((line) => line.some((s) => s[0] === 'warn'));
    expect(warn.map((line) => line.map((s) => s[1]).join(''))).toEqual(view.notes);
  });

  it('describes every note', () => {
    expect(noteText({ kind: 'stale', ageMs: 90 * 60_000, cause: 'offline' })).toBe('Showing the forecast from 1 h 30 min ago (you are offline).');
    expect(noteText({ kind: 'stale', ageMs: 2 * 3_600_000, cause: 'upstream' })).toBe('Showing the forecast from 2 h ago (Open-Meteo had a problem).');
    expect(noteText({ kind: 'country-point' })).toBe('Country-level point. Try a city for local weather.');
    expect(noteText({ kind: 'approximate' })).toBe('Approximate location from your network.');
    expect(noteText({ kind: 'last-place' })).toBe('Last place you looked up · weather --forget to clear');
    expect(noteText({ kind: 'alternatives', places: springfields.slice(1, 3) })).toBe(
      'Also: Springfield, Illinois, US · Springfield, Massachusetts, US',
    );
  });

  it('adds the country-level and approximate notes from the place itself, once', () => {
    const country: Place = { ...osloPlace, kind: 'country', approximate: true };
    const view = buildView(oslo, country, UNIT_PRESETS.metric, NOW, { notes: [{ kind: 'country-point' }] });
    expect(view.notes).toEqual(['Approximate location from your network.', 'Country-level point. Try a city for local weather.']);
  });

  it('always credits Open-Meteo, and OpenStreetMap when it found the place', () => {
    const plain = buildView(sydney, gadigal, UNIT_PRESETS.metric, NOW);
    expect(plain.attribution).toEqual({ openMeteo: 'Weather data by Open-Meteo.com (CC BY 4.0)', osm: null, updated: '14:15 GMT+11' });
    expect(renderPlain(plain)).toContain('Updated 14:15 GMT+11 · Weather data by Open-Meteo.com (CC BY 4.0)');
    expect(renderPlain(plain, 'compact')).toContain('Open-Meteo.com · 14:15 GMT+11');

    const osm = buildView(sydney, { ...gadigal, credit: 'osm' }, UNIT_PRESETS.metric, NOW);
    expect(renderPlain(osm)).toContain('Place search © OpenStreetMap contributors');
    expect(renderPlain(osm, 'compact')).toContain('© OpenStreetMap contributors');
  });
});

describe('plain text', () => {
  it('prints one line for --oneline', () => {
    expect(renderOneLine(buildView(oslo, osloPlace, UNIT_PRESETS.metric, NOW))).toBe(
      'Oslo, NO: clear sky, 12°C (feels 9°C), SSW 13 km/h · today 10–17°C, 0% rain',
    );
    expect(renderOneLine(buildView(sydney, gadigal, UNIT_PRESETS.imperial, NOW))).toBe(
      'Gadigal Country · Sydney, AU: clear sky, 76°F (feels 80°F), W 3 mph · today 60–78°F, 98% rain',
    );
  });

  it('summarises the card in one sentence for screen readers', () => {
    expect(buildView(sydney, gadigal, UNIT_PRESETS.metric, NOW).summary).toBe(
      'Weather for Gadigal Country · Sydney, New South Wales, Australia: Clear sky, 24°C, feels like 26°C, wind W 6 km/h. Today 16 to 26°C, 98% chance of rain.',
    );
  });

  it('joins segments and trims line ends', () => {
    expect(toPlain([[['text', 'a '], ['dim', 'b  ']], [], [['bar', '==--', { lo: 0, hi: 50 }]]])).toBe('a b\n\n==--');
  });
});

describe('text measurement', () => {
  it('counts wide characters twice and combining marks not at all', () => {
    expect(textWidth('Oslo')).toBe(4);
    expect(textWidth('東京')).toBe(4);
    expect(textWidth('Tāmaki')).toBe(6);
    expect(textWidth('17°C · ≈ …')).toBe(10);
  });

  it('fits and wraps by columns', () => {
    expect(fit('Gadigal Country', 8)).toBe('Gadigal…');
    expect(fit('Oslo', 8)).toBe('Oslo');
    expect(textWidth(fit('東京都千代田区', 7))).toBeLessThanOrEqual(7);
    expect(wrap('Showing the forecast from 14 min ago', 20)).toEqual(['Showing the forecast', 'from 14 min ago']);
    expect(wrap('Supercalifragilistic', 10)).toEqual(['Supercali…']);
  });

  it('maps every role to a theme colour token', () => {
    for (const colour of Object.values(ROLE_COLOUR)) expect(isPalette(colour) || isRole(colour)).toBe(true);
  });
});

// ── Random forecasts ───────────────────────────────────────────────────────────────────────

/** A small seeded PRNG, so the random cases are the same on every run. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)] as T;
}

function randomForecast(random: () => number): Forecast {
  const maybe = (min: number, max: number): number | null => (random() < 0.1 ? null : min + random() * (max - min));
  const extreme = (min: number, max: number): number | null => {
    const roll = random();
    if (roll < 0.1) return null;
    if (roll < 0.2) return min;
    if (roll < 0.3) return max;
    return min + random() * (max - min);
  };
  const time = (): string | null => (random() < 0.1 ? null : pick(random, ['00:00', '06:26', '23:59']));
  const daily: Daily[] = Array.from({ length: 1 + Math.floor(random() * 7) }, (_, i) => ({
    date: `2026-10-${String(6 + i).padStart(2, '0')}`,
    code: random() < 0.1 ? null : Math.floor(random() * 100),
    minC: extreme(-90, 60),
    maxC: extreme(-90, 60),
    precipMm: extreme(0, 999.9),
    precipProb: random() < 0.1 ? null : Math.round(random() * 100),
    windMaxKmh: extreme(0, 400),
    sunrise: time(),
    sunset: time(),
    uvMax: extreme(0, 20),
  }));
  return {
    lat: 0,
    lon: 0,
    timezone: 'UTC',
    tzAbbrev: pick(random, ['GMT+11', 'CEST', 'GMT-9:30', '+0545', '', 'GMT+13:45']),
    utcOffsetSeconds: 0,
    current: {
      time: '2026-10-06T12:00',
      isDay: random() < 0.5,
      code: random() < 0.1 ? null : Math.floor(random() * 100),
      tempC: extreme(-90, 60),
      feelsC: extreme(-110, 80),
      humidity: maybe(0, 100),
      precipMm: extreme(0, 999.9),
      windKmh: extreme(0, 400),
      gustKmh: extreme(0, 500),
      windDeg: maybe(0, 360),
    },
    daily,
    fetchedAt: FETCHED,
  };
}
