// weather: the forecast for a place, from Open-Meteo, drawn as a card that fits a phone or a
// laptop (docs/plan/05-weather.md). The spec is all the kernel carries; the body, with the card,
// the location chain and the long help, loads the first time weather runs (weather.run.ts), and
// the service it talks to loads with it (commands/lib/weather.ts).
//
// It reads its own words, because coordinates such as -33.87,151.21 start with a hyphen, and a
// lone - means the previous place, as cd - does.

import type { RawArgsSpec } from '../../shell/flags';
import type { CommandSpec, EnumValue, RunnerChoice } from '../../shell/types';

const UNITS: readonly EnumValue[] = [
  { value: 'metric', summary: '°C, km/h, mm' },
  { value: 'imperial', summary: '°F, mph, inches' },
  { value: 'uk', summary: '°C, mph, mm' },
];

/** Flags whose value is the next word. */
const VALUE_FLAGS = new Set(['-d', '--days', '--units']);

/** The words that name the place: everything but the flags and their values. */
export function placeWords(argv: readonly string[]): string[] {
  const words: string[] = [];
  let operands = false;
  for (let i = 1; i < argv.length; i += 1) {
    const word = argv[i] ?? '';
    if (operands || word === '-' || !word.startsWith('-') || /^-[\d.]/.test(word)) words.push(word);
    else if (word === '--') operands = true;
    else if (VALUE_FLAGS.has(word)) i += 1;
  }
  return words;
}

/** What the status line says before the body has said anything itself. */
function loadingLabel(argv: readonly string[]): string {
  if (argv.includes('--forget') || argv.includes('--legend')) return 'weather';
  const place = placeWords(argv).join(' ');
  if (place === '-') return 'Fetching the forecast…';
  return place === '' ? 'Locating you…' : `Searching for “${place}”…`;
}

const spec: CommandSpec & RawArgsSpec & RunnerChoice = {
  name: 'weather',
  category: 'network',
  summary: 'show the weather forecast for a place',
  synopsis: [
    'weather [place | "place, qualifier" | lat,lon] [-u|-m|--units metric|imperial|uk] [-d N] [--json|--oneline]',
    'weather --here | weather - | weather --forget',
  ],
  rawArgs: true,
  network: true,
  // It may wait on a location prompt.
  budgetMs: 25_000,
  usageStatus: 2,
  loadingLabel,
  flags: [
    { short: 'u', long: 'imperial', description: 'imperial units: °F, mph and inches' },
    { short: 'm', long: 'metric', description: 'metric units: °C, km/h and millimetres' },
    { long: 'units', description: 'metric, imperial or uk (°C with mph)', value: { name: 'UNITS', source: { kind: 'enum', values: () => UNITS } } },
    { short: 'd', long: 'days', description: 'days of forecast, 1 to 7 (3 unless given)', value: { name: 'N', source: { kind: 'int' } } },
    { long: 'here', description: "this device's location (the browser asks first)" },
    { long: 'json', description: 'the forecast as JSON' },
    { long: 'oneline', description: 'the forecast in one line of text' },
    { long: 'forget', description: 'forget the places you looked up' },
  ],
  args: [{ name: 'PLACE', source: { kind: 'examples', caseInsensitive: true, fromHistory: true }, optional: true, variadic: true }],
  examples: [
    { line: 'weather Gadigal', note: 'Sydney, on Gadigal Country', offline: false },
    { line: 'weather Oslo', offline: false },
    { line: 'weather Aotearoa', note: 'Wellington', offline: false },
    { line: 'weather --forget', note: 'forget the places you looked up', offline: true },
  ],
  seeAlso: ['privacy'],
  load: () => import('./weather.run'),
};

export default spec;
