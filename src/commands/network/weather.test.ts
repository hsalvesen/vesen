// weather (docs/plan/05-weather.md): the spec, its words, and every way a run can go, through the
// shell, over the recorded fixtures in tests/fixtures/weather. No test touches the network.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixture, json, memoryKV, weatherFetch, type Responder, type WeatherFetch } from '../../../tests/support/weather';
import { createAppShell, type AppShell } from '../../app/shell';
import { isTrustedAction, type Block, type ChipItem, type ChipsBlock, type ComponentBlock } from '../../output/model';
import { createClock } from '../../services/clock';
import { createMemo } from '../../services/net';
import { STORAGE_KEYS } from '../../services/storage-keys';
import { createWeatherService } from '../../services/weather/service';
import { createWeatherSources } from '../../services/weather/sources';
import { GeoError, type GeoFix, type GeoPermission, type Geolocator, type WeatherCardProps } from '../../services/weather/types';
import { COMPACT_COLS, WIDE_COLS, lineWidth } from '../../services/weather/view';
import type { InAppBrowser } from '../../shell/types';
import { createScreen } from '../../stores/screen';
import { screenText } from '../../testing/shell-harness';
import spec, { placeWords } from './weather';
import { LOCATE_GRANTED_MS, LOCATE_PROMPT_MS, chipPlace, netMessage, parseWeatherArgs } from './weather.run';

/** When the fixtures were recorded: 14:15 in Sydney, 05:15 in Oslo. */
const RECORDED = Date.parse('2026-10-06T03:15:00Z');

const FORECAST = 'api.open-meteo.com';
const GEOCODING = 'geocoding-api.open-meteo.com';
const NOMINATIM = 'nominatim.openstreetmap.org';

interface FakeGeo extends Geolocator {
  state: GeoPermission;
  /** The timeout of each locate() call. */
  readonly asked: number[];
  answer: (signal: AbortSignal | undefined) => Promise<GeoFix>;
}

function fakeGeo(state: GeoPermission = 'prompt'): FakeGeo {
  const geo: FakeGeo = {
    state,
    asked: [],
    answer: () => Promise.resolve({ lat: -33.87, lon: 151.21 }),
    permission: () => Promise.resolve(geo.state),
    locate: ({ timeoutMs, signal }) => {
      geo.asked.push(timeoutMs);
      return geo.answer(signal);
    },
  };
  return geo;
}

interface RunResult {
  readonly status: number;
  readonly blocks: readonly Block[];
  readonly stdout: string;
  readonly stderr: string;
  readonly card: (ComponentBlock & { readonly props: WeatherCardProps }) | undefined;
  readonly chips: readonly ChipItem[];
  /** What the status line said while it ran, in order. */
  readonly labels: readonly string[];
}

interface RigOptions {
  readonly cols?: number;
  readonly languages?: readonly string[];
  readonly inApp?: InAppBrowser | null;
  readonly respond?: Responder;
  readonly geo?: FakeGeo;
  /** False: the shell has no weather service at all. */
  readonly service?: boolean;
}

let clock = RECORDED + 5 * 60_000;

function rig(options: RigOptions = {}) {
  const network: WeatherFetch = weatherFetch(options.respond);
  vi.stubGlobal('fetch', network.fetch);
  const kv = memoryKV();
  const geo = options.geo ?? fakeGeo();
  const now = (): number => clock;
  const sources = createWeatherSources({ now, memo: createMemo({ now }), kv, nominatimGapMs: 0 });
  const service = createWeatherService({ sources, geolocation: geo, nominatim: true });
  const cols = options.cols ?? 80;
  const app: AppShell = createAppShell({
    banner: () => '',
    screen: createScreen(),
    version: '0.0.0-test',
    clock: createClock({ now, random: () => 0.5, timeZone: 'Australia/Sydney' }),
    sysHost: {
      navigator: { userAgent: 'test', languages: options.languages ?? ['en-AU'], hardwareConcurrency: 4 },
      screen: { width: 1280, height: 800, colorDepth: 24 },
      devicePixelRatio: 1,
    },
    terminal: { size: () => ({ cols, rows: 24 }), touch: false, inApp: options.inApp ?? null },
    yieldToHost: () => Promise.resolve(),
    ...(options.service === false ? {} : { weather: () => Promise.resolve(service) }),
  });
  const labels: string[] = [];
  const unsubscribe = app.shell.job.subscribe((job) => {
    if (job?.label && labels[labels.length - 1] !== job.label) labels.push(job.label);
  });

  const collect = (status: number, blocks: readonly Block[]): RunResult => {
    const card = blocks.find((block): block is ComponentBlock & { props: WeatherCardProps } => block.type === 'component');
    const chips = blocks.filter((block): block is ChipsBlock => block.type === 'chips').flatMap((block) => block.items);
    return {
      status,
      blocks,
      stdout: screenText(blocks, 'stdout'),
      stderr: screenText(blocks, 'stderr'),
      card,
      chips: card ? [...card.props.chips, ...card.props.also] : chips,
      labels: [...labels],
    };
  };

  return {
    app,
    network,
    kv,
    geo,
    service,
    labels,
    async run(line: string): Promise<RunResult> {
      labels.length = 0;
      const result = await app.shell.run(line);
      return collect(result.status, result.blocks);
    },
    stop(): void {
      unsubscribe();
      app.stop();
    },
  };
}

const lines = (chips: readonly ChipItem[]): string[] =>
  chips.map((chip) => (isTrustedAction(chip.action) && chip.action.kind === 'run' ? chip.action.line : `untrusted ${chip.label}`));

const labelled = (chips: readonly ChipItem[]): Record<string, string> =>
  Object.fromEntries(chips.map((chip, i) => [chip.label, lines(chips)[i] ?? '']));

beforeEach(() => {
  clock = RECORDED + 5 * 60_000;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the spec', () => {
  it('is a network command with a 25 s budget that reads its own words', () => {
    expect(spec).toMatchObject({ name: 'weather', category: 'network', network: true, budgetMs: 25_000, usageStatus: 2, rawArgs: true });
    expect(spec.summary.length).toBeLessThanOrEqual(50);
    expect(spec.synopsis?.[0]).toBe('weather [place | "place, qualifier" | lat,lon] [-u|-m|--units metric|imperial|uk] [-d N] [--json|--oneline]');
    expect(spec.args?.[0]?.source).toEqual({ kind: 'examples', caseInsensitive: true, fromHistory: true });
    expect(spec.examples?.filter((example) => example.offline === false).map((example) => example.line)).toEqual([
      'weather Gadigal',
      'weather Oslo',
      'weather Aotearoa',
    ]);
    expect(spec.examples?.filter((example) => example.offline === true).map((example) => example.line)).toEqual(['weather --forget']);
  });

  it('says what it is doing before its body has said anything', () => {
    expect(spec.loadingLabel?.(['weather', 'Springfield,', 'IL'])).toBe('Searching for “Springfield, IL”…');
    expect(spec.loadingLabel?.(['weather', '-d', '3', '-u', 'Oslo'])).toBe('Searching for “Oslo”…');
    expect(spec.loadingLabel?.(['weather'])).toBe('Locating you…');
    expect(spec.loadingLabel?.(['weather', '--here'])).toBe('Locating you…');
    expect(placeWords(['weather', '--units', 'uk', '-33.87,151.21'])).toEqual(['-33.87,151.21']);
  });
});

describe('help', () => {
  it('comes from the spec, with the long help from the body', async () => {
    const r = rig();
    const help = await r.run('weather --help');
    expect(help.status).toBe(0);
    expect(help.stdout).toContain('weather --here | weather - | weather --forget');
    expect(help.stdout).toContain('--units=UNITS');
    expect(help.stdout).toContain('weather Gadigal');
    expect(help.stdout).toContain('Units follow your browser');
    expect(help.stdout).not.toContain('--legend');
    const man = await r.run('man weather');
    expect(man.stdout).toContain('PLACES');
    expect(man.stdout).toContain('Gadigal, Naarm');
    expect(man.stdout).toContain('Open-Meteo.com (CC BY 4.0)');
    expect(r.network.calls).toEqual([]);
    r.stop();
  });
});

describe('arguments', () => {
  const parse = (...words: string[]) => parseWeatherArgs(words);

  it('reads units, days and formats in any order', () => {
    expect(parse('-u', 'Oslo', '-d2')).toEqual({
      ok: true,
      args: { target: { kind: 'query', text: 'Oslo' }, units: 'imperial', days: 2, format: 'card', forget: false, legend: false },
    });
    for (const words of [['-d', '5'], ['-d5'], ['--days=5'], ['--days', '5'], ['-ud5']]) {
      expect(parse('Oslo', ...words)).toMatchObject({ ok: true, args: { days: 5 } });
    }
    expect(parse('-m', 'Oslo')).toMatchObject({ args: { units: 'metric' } });
    expect(parse('--units', 'UK', 'Oslo')).toMatchObject({ args: { units: 'uk' } });
    expect(parse('--units=imperial', 'Oslo')).toMatchObject({ args: { units: 'imperial' } });
    expect(parse('--imperial', 'Oslo')).toMatchObject({ args: { units: 'imperial' } });
    expect(parse('Oslo', '--json')).toMatchObject({ args: { format: 'json' } });
    expect(parse('--oneline', 'Oslo')).toMatchObject({ args: { format: 'oneline' } });
    expect(parse('--legend')).toMatchObject({ args: { legend: true } });
  });

  it('refuses days outside 1-7, unknown units and unknown options', () => {
    for (const words of [['-d', '0'], ['-d', '8'], ['-d', 'ten'], ['--days'], ['-d']]) {
      expect(parse('Oslo', ...words)).toEqual({ ok: false, message: '--days must be 1-7' });
    }
    expect(parse('--units', 'kelvin', 'Oslo')).toEqual({ ok: false, message: '--units must be metric, imperial or uk' });
    expect(parse('--foo', 'Oslo')).toEqual({ ok: false, message: "unknown option '--foo'" });
    expect(parse('-x', 'Oslo')).toEqual({ ok: false, message: "unknown option '-x'" });
    expect(parse('--here=yes')).toEqual({ ok: false, message: "option '--here' doesn't allow an argument" });
    expect(parse('--here', 'Oslo')).toEqual({ ok: false, message: '--here takes no place' });
    expect(parse('--forget', 'Oslo')).toEqual({ ok: false, message: '--forget takes no place' });
  });

  it('takes coordinates as a place, never as options', () => {
    expect(parse('-33.87,151.21')).toMatchObject({ args: { target: { kind: 'query', text: '-33.87,151.21' } } });
    expect(parse('-33.87,', '151.21')).toMatchObject({ args: { target: { kind: 'query', text: '-33.87, 151.21' } } });
    expect(parse('-u', '@-33.87,151.21')).toMatchObject({ args: { units: 'imperial', target: { text: '@-33.87,151.21' } } });
  });

  it("reads '-' as the previous place, '--' as the end of options, and nothing as wherever you are", () => {
    expect(parse('-')).toMatchObject({ args: { target: { kind: 'previous' } } });
    expect(parse('-u', '-')).toMatchObject({ args: { units: 'imperial', target: { kind: 'previous' } } });
    expect(parse('--', '--here')).toMatchObject({ args: { target: { kind: 'query', text: '--here' } } });
    expect(parse()).toMatchObject({ args: { target: { kind: 'none' }, days: 3, units: null } });
    expect(parse('--here')).toMatchObject({ args: { target: { kind: 'here' } } });
    expect(parse('Springfield,', 'IL')).toMatchObject({ args: { target: { kind: 'query', text: 'Springfield, IL' } } });
  });
});

describe('chip words', () => {
  it('lets through place names and coordinates only', () => {
    expect(chipPlace('Oslo')).toBe('Oslo');
    expect(chipPlace('Springfield, Illinois')).toBe('Springfield, Illinois');
    expect(chipPlace('Tāmaki Makaurau')).toBe('Tāmaki Makaurau');
    expect(chipPlace('Te Whanganui-a-Tara')).toBe('Te Whanganui-a-Tara');
    expect(chipPlace("Martha's Vineyard")).toBe('"Martha\'s Vineyard"');
    expect(chipPlace('-33.87,151.21')).toBe('-33.87,151.21');
    for (const hostile of ['Oslo; rm -rf ~', '$HOME', '`id`', 'a | b', 'x > f', '-x', 'Oslo --here', '<img src=x>', 'a"b', 'a\\b', '', 'x'.repeat(101)]) {
      expect(chipPlace(hostile), hostile).toBeNull();
    }
  });
});

describe('a curated place', () => {
  it('draws a card for Gadigal with no place search, and chips that are trusted actions', async () => {
    const r = rig();
    const result = await r.run('weather Gadigal');
    expect(result.status).toBe(0);
    expect(r.network.callsTo(GEOCODING)).toEqual([]);
    expect(r.network.callsTo(NOMINATIM)).toEqual([]);
    expect(r.network.callsTo(FORECAST)).toHaveLength(1);
    expect(result.card?.name).toBe('weather-card');
    expect(result.card?.props.title.compact).toBe('Gadigal Country · Sydney, AU');
    expect(result.card?.alt).toMatch(/^Weather for Gadigal Country · Sydney, New South Wales, Australia: Clear sky, 24°C/);
    expect(result.chips.every((chip) => isTrustedAction(chip.action))).toBe(true);
    expect(labelled(result.chips)).toEqual({
      '°F': 'weather -u Gadigal Country',
      '7 days': 'weather -d 7 Gadigal Country',
      'my location': 'weather --here',
    });
    expect(result.labels).toEqual(['Searching for “Gadigal”…', 'Fetching forecast for Gadigal Country…']);
    r.stop();
  });

  it('gives pipes and files the compact or the wide layout as plain text, by width', async () => {
    const narrow = rig({ cols: 40 });
    const compact = (await narrow.run('weather Gadigal')).card?.plain ?? '';
    expect(compact.split('\n')[0]).toBe('Gadigal Country · Sydney, AU');
    expect(Math.max(...compact.trimEnd().split('\n').map((row) => [...row].length))).toBeLessThanOrEqual(COMPACT_COLS);
    expect(compact).toContain('Weather data by Open-Meteo.com');
    narrow.stop();

    const wide = rig({ cols: 80 });
    const result = await wide.run('weather Gadigal');
    const text = result.card?.plain ?? '';
    expect(text.split('\n')[0]).toBe('Weather for Gadigal Country · Sydney, New South Wales, Australia');
    expect(Math.max(...text.trimEnd().split('\n').map((row) => [...row].length))).toBeLessThanOrEqual(WIDE_COLS);
    expect(result.card?.props.compact.every((row) => lineWidth(row) <= COMPACT_COLS)).toBe(true);
    expect(result.card?.props.wide.every((row) => lineWidth(row) <= WIDE_COLS)).toBe(true);
    // Into a pipe: the text alone, no chips.
    const piped = await wide.run('weather Gadigal | cat');
    expect(piped.stdout).toBe(text.trimEnd());
    expect(piped.blocks.some((block) => block.type === 'component' || block.type === 'chips')).toBe(false);
    wide.stop();
  });

  it('follows the browser language for units until a flag chooses them', async () => {
    const us = rig({ languages: ['en-US'] });
    const imperial = await us.run('weather Gadigal');
    expect(imperial.card?.props.units.system).toBe('imperial');
    expect(labelled(imperial.chips)['°C']).toBe('weather -m Gadigal Country');
    expect((await us.run('weather -m Gadigal')).card?.props.units.system).toBe('metric');
    us.stop();

    const gb = rig({ languages: ['en-GB'] });
    expect((await gb.run('weather Gadigal')).card?.props.units).toMatchObject({ system: 'uk', temp: '°C', wind: 'mph' });
    gb.stop();

    const au = rig({ languages: ['en-AU'] });
    const metric = await au.run('weather -d 7 --units uk Gadigal');
    expect(metric.card?.props.days).toHaveLength(7);
    expect(labelled(metric.chips)).toEqual({ '°F': 'weather -u -d 7 Gadigal Country', 'my location': 'weather --here --units uk' });
    au.stop();
  });

  it('writes one line, or JSON, for scripts', async () => {
    const r = rig();
    const oneline = await r.run('weather --oneline Gadigal');
    expect(oneline.stdout).toBe('Gadigal Country · Sydney, AU: clear sky, 24°C (feels 26°C), W 6 km/h · today 16–26°C, 98% rain');
    expect(oneline.card).toBeUndefined();
    const parsed = JSON.parse((await r.run('weather --json Gadigal')).stdout) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      place: { name: 'Gadigal Country', knownAs: 'Sydney', countryCode: 'AU' },
      units: { temperature: '°C', wind: 'km/h', precipitation: 'mm' },
      current: { label: 'Clear sky', temp: 24 },
      attribution: ['Weather data by Open-Meteo.com (CC BY 4.0)'],
    });
    expect(parsed.days).toHaveLength(3);
    expect(JSON.stringify(parsed)).not.toContain('art');
    r.stop();
  });
});

describe('a searched place', () => {
  it('searches Open-Meteo once, then remembers the place', async () => {
    const r = rig();
    const result = await r.run('weather Oslo');
    expect(result.card?.props.title.compact).toBe('Oslo, NO');
    expect(r.network.callsTo(GEOCODING).map((url) => url.searchParams.get('name'))).toEqual(['Oslo']);
    expect(labelled(result.chips)['°F']).toBe('weather -u Oslo');
    await r.run('weather -u Oslo');
    expect(r.network.callsTo(GEOCODING)).toHaveLength(1);
    expect(r.network.callsTo(FORECAST)).toHaveLength(1);
    expect(JSON.parse(r.kv.get(STORAGE_KEYS.weather.key) ?? '{}')).toMatchObject({ v: 1, recent: [{ name: 'Oslo', countryCode: 'NO' }] });
    r.stop();
  });

  it('offers same-named places of a similar size, as chips after Also:', async () => {
    const r = rig();
    const result = await r.run('weather Springfield');
    expect(result.card?.props.place.region).toBe('Missouri');
    // Chips on the card; the note in the text a pipe gets.
    expect(result.card?.props.notes.join(' ')).not.toContain('Also:');
    expect(result.card?.plain).toContain('Also: Springfield, Illinois, US · Springfield, Massachusetts, US');
    expect((await r.run('weather Springfield | cat')).stdout).toContain('Also: Springfield, Illinois, US');
    expect(labelled(result.card?.props.also ?? [])).toEqual({
      'Springfield, Illinois, US': 'weather Springfield, Illinois',
      'Springfield, Massachusetts, US': 'weather Springfield, Massachusetts',
    });
    expect((await r.run('weather Springfield, Illinois')).card?.props.place.region).toBe('Illinois');
    r.stop();
  });

  it('falls back to OpenStreetMap, says so on the status line, and credits it', async () => {
    const r = rig();
    const result = await r.run('weather Eora Nation');
    expect(result.status).toBe(0);
    expect(result.card?.props.place).toMatchObject({ name: 'Sydney', source: 'nominatim', credit: 'osm' });
    expect(result.card?.plain).toContain('Place search © OpenStreetMap contributors');
    expect(result.labels).toContain('Searching OpenStreetMap for “Eora Nation”…');
    r.stop();
  });

  it('names typed coordinates through OpenStreetMap, and keeps them as the chip carries them', async () => {
    const r = rig();
    const result = await r.run('weather -33.87,151.21');
    expect(result.card?.props.place).toMatchObject({ name: 'Sydney', region: 'New South Wales', lat: -33.87, lon: 151.21, source: 'coords', credit: 'osm' });
    expect(labelled(result.chips)['°F']).toBe('weather -u -33.87,151.21');
    expect(r.network.callsTo(GEOCODING)).toEqual([]);
    r.stop();
  });

  it("goes back to the place before with '-', as cd - does", async () => {
    const r = rig();
    expect(await r.run('weather -')).toMatchObject({ status: 1, stderr: 'weather: no previous place yet.\nLook one up first, such as weather Oslo.' });
    await r.run('weather Oslo');
    await r.run('weather Gadigal');
    expect((await r.run('weather -')).card?.props.place.name).toBe('Oslo');
    expect((await r.run('weather -')).card?.props.place.name).toBe('Gadigal Country');
    r.stop();
  });
});

describe('no place found', () => {
  it('says so, escaped, with did-you-mean chips', async () => {
    const r = rig({ respond: (url) => (url.host === NOMINATIM ? json([]) : undefined) });
    const result = await r.run('weather Aoteroa');
    expect(result.status).toBe(1);
    expect(result.stderr).toBe(
      'weather: no place called "Aoteroa".\nDid you mean: weather Aotearoa?\nTry a city, "City, Country" or lat,lon.',
    );
    expect(labelled(result.chips)).toEqual({ 'weather Aotearoa': 'weather Aotearoa' });
    r.stop();
  });

  it('keeps hostile input as text, and puts none of it in a chip', async () => {
    const r = rig({ respond: (url) => (url.host === NOMINATIM ? json([]) : undefined) });
    const result = await r.run("weather '<img src=x onerror=alert(1)>'");
    expect(result.status).toBe(1);
    expect(result.stderr.split('\n')[0]).toBe('weather: no place called "<img src=x onerror=alert(1)>".');
    expect(result.chips).toEqual([]);
    r.stop();
  });
});

describe('location', () => {
  it('uses the network location for a bare weather, without asking for the device', async () => {
    const r = rig();
    const result = await r.run('weather');
    expect(r.geo.asked).toEqual([]);
    expect(r.network.callsTo('get.geojs.io')).toHaveLength(1);
    expect(result.card?.props.title.compact).toBe('≈ Sydney, AU');
    expect(result.card?.props.notes).toContain('≈ Sydney, New South Wales, AU (approximate, from your network)');
    expect(labelled(result.chips)).toEqual({
      '°F': 'weather -u',
      '7 days': 'weather -d 7',
      'use precise location': 'weather --here',
    });
    expect(result.labels).toContain('Locating you (approximate)…');
    // Never kept as a recent place.
    expect(r.service.recent()).toEqual([]);
    r.stop();
  });

  it('asks ipinfo.io when GeoJS fails, then the last place, then shows places to try', async () => {
    const r = rig({ respond: (url) => (url.host === 'get.geojs.io' ? json({}, 500) : undefined) });
    expect((await r.run('weather')).card?.props.place).toMatchObject({ name: 'Sydney', approximate: true });
    expect(r.network.callsTo('ipinfo.io')).toHaveLength(1);
    r.stop();

    const fresh = rig({ respond: (url) => (url.host === 'get.geojs.io' || url.host === 'ipinfo.io' ? json({}, 500) : undefined) });
    const help = await fresh.run('weather');
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("weather: couldn't tell where you are.");
    expect(lines(help.chips)).toEqual(['weather Gadigal', 'weather Oslo', 'weather Aotearoa']);
    await fresh.run('weather Oslo');
    const last = await fresh.run('weather');
    expect(last.card?.props.place.name).toBe('Oslo');
    expect(last.card?.props.notes).toContain('Last place you looked up · weather --forget to clear');
    fresh.stop();
  });

  it('keeps a bare weather on the network location even once the device is allowed', async () => {
    const r = rig({ geo: fakeGeo('granted') });
    const result = await r.run('weather');
    expect(r.geo.asked).toEqual([]);
    expect(r.network.callsTo('get.geojs.io')).toHaveLength(1);
    expect(r.network.callsTo(NOMINATIM)).toEqual([]);
    expect(result.card?.props.place).toMatchObject({ name: 'Sydney', approximate: true });
    expect(labelled(result.chips)['use precise location']).toBe('weather --here');
    r.stop();
  });

  it('uses the device with --here once permission is granted, named by OpenStreetMap, and keeps none of it', async () => {
    const r = rig({ geo: fakeGeo('granted') });
    const result = await r.run('weather --here');
    expect(r.geo.asked).toEqual([LOCATE_GRANTED_MS]);
    expect(r.network.callsTo('get.geojs.io')).toEqual([]);
    expect(r.network.callsTo(NOMINATIM)[0]?.pathname).toBe('/reverse');
    expect(result.card?.props.place).toMatchObject({ name: 'Sydney', source: 'device', lat: -33.87, lon: 151.21 });
    expect(result.card?.props.attribution.osm).toBe('Place search © OpenStreetMap contributors');
    // The chips never carry the device's position.
    expect(lines(result.chips)).toEqual(['weather -u', 'weather -d 7']);
    expect(r.service.recent()).toEqual([]);
    // Neither the position nor its name is kept in storage.
    const stored = r.kv.get(STORAGE_KEYS.weather.key) ?? '';
    expect(stored).not.toContain('151.21');
    expect(stored).not.toContain('rev:');
    r.stop();
  });

  it('asks for the device with --here, with 15 s for the prompt', async () => {
    const r = rig();
    const result = await r.run('weather --here');
    expect(r.geo.asked).toEqual([LOCATE_PROMPT_MS]);
    expect(result.labels).toContain('Waiting for location permission…');
    expect(result.card?.props.place.source).toBe('device');
    expect(labelled(result.chips)['my location']).toBeUndefined();
    r.stop();
  });

  it('explains a refusal, and uses the network location instead', async () => {
    const geo = fakeGeo('prompt');
    geo.answer = () => Promise.reject(new GeoError('denied'));
    const r = rig({ geo });
    const denied = await r.run('weather --here');
    expect(denied.status).toBe(0);
    expect(denied.card?.props.place.approximate).toBe(true);
    expect(denied.card?.props.notes).toContain('Location permission was denied, so this uses an approximate network location.');

    geo.state = 'denied';
    geo.asked.length = 0;
    await r.run('weather --here');
    expect(geo.asked).toEqual([]);

    geo.state = 'insecure';
    expect((await r.run('weather --here')).card?.props.notes).toContain(
      'The location needs a secure (https) page, so this uses an approximate network location.',
    );
    r.stop();
  });

  it("says Instagram didn't share the location, and how to get a precise one, with no chip to ask again", async () => {
    const geo = fakeGeo('prompt');
    geo.answer = () => Promise.reject(new GeoError('timeout'));
    const r = rig({ geo, inApp: 'instagram' });
    const result = await r.run('weather --here');
    expect(result.card?.props.notes).toContain(
      "Instagram didn't share your location, so this uses an approximate network location. Open vesen.app in Safari or Chrome for a precise fix.",
    );
    // Asking again in the same in-app browser gets the same answer.
    expect(labelled(result.chips)['use precise location']).toBeUndefined();
    // A bare weather there still offers it: the visitor has not been asked yet.
    expect(labelled((await r.run('weather')).chips)['use precise location']).toBe('weather --here');
    r.stop();
  });

  it('offers to ask again after a refusal in a normal browser, but not where it cannot work', async () => {
    const geo = fakeGeo('prompt');
    geo.answer = () => Promise.reject(new GeoError('denied'));
    const r = rig({ geo });
    expect(labelled((await r.run('weather --here')).chips)['use precise location']).toBe('weather --here');
    geo.state = 'insecure';
    expect(labelled((await r.run('weather --here')).chips)['use precise location']).toBeUndefined();
    r.stop();
  });
});

describe('failures', () => {
  it('says when Open-Meteo does not answer in time, with a chip to try again', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const r = rig({ respond: (url) => (url.host === FORECAST ? new Promise<Response>(() => {}) : undefined) });
    const pending = r.run('weather Gadigal');
    await vi.advanceTimersByTimeAsync(8000);
    const result = await pending;
    expect(result.status).toBe(1);
    expect(result.stderr).toBe("weather: Open-Meteo didn't answer within 8 s.");
    expect(lines(result.chips)).toEqual(['weather Gadigal']);
    // The chip asks Open-Meteo again at once, rather than replaying the failure for 30 s.
    const again = r.run('weather Gadigal');
    await vi.advanceTimersByTimeAsync(8000);
    expect((await again).stderr).toBe("weather: Open-Meteo didn't answer within 8 s.");
    expect(r.network.callsTo(FORECAST)).toHaveLength(2);
    r.stop();
  });

  it('says when the browser is offline', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const r = rig();
    const result = await r.run('weather -u Gadigal');
    expect(result).toMatchObject({ status: 1, stderr: 'weather: you appear to be offline.' });
    expect(lines(result.chips)).toEqual(['weather -u Gadigal']);
    r.stop();
  });

  it('says when Open-Meteo rate-limits, and gives its reason for other errors', async () => {
    const limited = rig({ respond: (url) => (url.host === FORECAST ? json({ error: true, reason: 'Too many requests' }, 429) : undefined) });
    expect(await limited.run('weather Gadigal')).toMatchObject({
      status: 1,
      stderr: 'weather: rate-limited by Open-Meteo (HTTP 429). Try again in a minute.',
    });
    limited.stop();

    const broken = rig({ respond: (url) => (url.host === FORECAST ? json(fixture('forecast-error-400.json'), 400) : undefined) });
    expect(await broken.run('weather Gadigal')).toMatchObject({
      status: 1,
      stderr: 'weather: Open-Meteo forecast error (HTTP 400)\nLatitude must be in range of -90 to 90°. Given: 200.0.',
    });
    broken.stop();
  });

  it('shows the last forecast, marked stale, when Open-Meteo fails later', async () => {
    let down = false;
    const r = rig({ respond: (url) => (down && url.host === FORECAST ? json({ error: true }, 503) : undefined) });
    await r.run('weather Gadigal');
    down = true;
    clock += 15 * 60_000;
    const result = await r.run('weather Gadigal');
    expect(result.status).toBe(0);
    expect(result.card?.props.notes).toEqual(['Showing the forecast from 15 min ago (Open-Meteo had a problem).']);
    r.stop();
  });

  it('describes every kind of network failure', () => {
    const error = (kind: string, host: string, extra: object = {}) => ({ kind, host, name: 'NetError', message: '', ...extra }) as never;
    expect(netMessage(error('cors', GEOCODING))).toEqual(["weather: couldn't reach Open-Meteo. Check the connection and try again."]);
    expect(netMessage(error('parse', NOMINATIM))).toEqual(['weather: OpenStreetMap sent an answer that could not be read.']);
    expect(netMessage(error('http', NOMINATIM, { status: 503 }))).toEqual(['weather: OpenStreetMap place search error (HTTP 503)']);
    expect(netMessage(error('timeout', 'get.geojs.io', { timeoutMs: 4000 }))).toEqual(["weather: GeoJS didn't answer within 4 s."]);
  });

  it('is interrupted by ^C at once', async () => {
    const r = rig({ respond: (url) => (url.host === FORECAST ? new Promise<Response>(() => {}) : undefined) });
    const handle = r.app.shell.start('weather Gadigal');
    await vi.waitFor(() => expect(r.network.callsTo(FORECAST)).toHaveLength(1));
    handle.abort();
    expect((await handle.done).status).toBe(130);
    r.stop();
  });

  it('refuses bad words with status 2', async () => {
    const r = rig();
    expect(await r.run('weather --foo Oslo')).toMatchObject({
      status: 2,
      stderr: "weather: unknown option '--foo'\nTry 'weather --help' for more information.",
    });
    expect(await r.run('weather -d 9 Oslo')).toMatchObject({ status: 2, stderr: expect.stringContaining('weather: --days must be 1-7') });
    expect(r.network.calls).toEqual([]);
    r.stop();
  });

  it('says so when the shell has no weather service', async () => {
    const r = rig({ service: false });
    expect(await r.run('weather Oslo')).toMatchObject({ status: 1, stderr: 'weather: there is no weather service here.' });
    expect(await r.run('weather --forget')).toMatchObject({ status: 0, stdout: 'weather: forgot the places you looked up.' });
    r.stop();
  });
});

describe('forgetting', () => {
  it('forgets the places with --forget, and with reset', async () => {
    const r = rig();
    await r.run('weather Oslo');
    expect(r.service.recent()).toHaveLength(1);
    expect(await r.run('weather --forget')).toMatchObject({ status: 0, stdout: 'weather: forgot the places you looked up.' });
    expect(r.service.recent()).toEqual([]);
    expect(r.kv.get(STORAGE_KEYS.weather.key)).toBeNull();

    await r.run('weather Oslo');
    expect(r.service.recent()).toHaveLength(1);
    await r.run('reset');
    await vi.waitFor(() => expect(r.service.recent()).toEqual([]));
    expect(r.kv.get(STORAGE_KEYS.weather.key)).toBeNull();
    r.stop();
  });
});

describe('the legend', () => {
  it('draws every icon, offline', async () => {
    const r = rig();
    const result = await r.run('weather --legend');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('clearNight');
    expect(result.stdout).toContain('thunder  WMO 95 96 99');
    expect(r.network.calls).toEqual([]);
    r.stop();
  });
});
