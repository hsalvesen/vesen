// WMO weather interpretation codes as Open-Meteo reports them, with labels, icons and art.
// The codes are the 28 that Open-Meteo documents for `weather_code`; any other value in 0-99
// falls back to 'Unknown'.

import type { ArtKey, ArtRow, IconKey, WeatherRole, WmoInfo } from './types';

/** Each art row is exactly this many columns, so the text beside it lines up. */
export const ART_WIDTH = 13;
export const ART_HEIGHT = 5;

/** Label length limits, so each fits the column it is used in. */
export const MEDIUM_MAX = 16;
export const SHORT_MAX = 9;

const info = (label: string, medium: string, short: string, icon: IconKey): WmoInfo => ({ label, medium, short, icon });

export const WMO: Readonly<Record<number, WmoInfo>> = {
  0: info('Clear sky', 'Clear sky', 'Clear', 'clear'),
  1: info('Mainly clear', 'Mainly clear', 'Clear', 'clear'),
  2: info('Partly cloudy', 'Partly cloudy', 'Pt cloudy', 'partly'),
  3: info('Overcast', 'Overcast', 'Overcast', 'cloudy'),
  45: info('Fog', 'Fog', 'Fog', 'fog'),
  48: info('Depositing rime fog', 'Rime fog', 'Rime fog', 'fog'),
  51: info('Light drizzle', 'Light drizzle', 'Drizzle', 'drizzle'),
  53: info('Drizzle', 'Drizzle', 'Drizzle', 'drizzle'),
  55: info('Dense drizzle', 'Dense drizzle', 'Drizzle', 'drizzle'),
  56: info('Light freezing drizzle', 'Lt frz drizzle', 'Frz drzl', 'sleet'),
  57: info('Dense freezing drizzle', 'Freezing drizzle', 'Frz drzl', 'sleet'),
  61: info('Light rain', 'Light rain', 'Lt rain', 'rain'),
  63: info('Rain', 'Rain', 'Rain', 'rain'),
  65: info('Heavy rain', 'Heavy rain', 'Hvy rain', 'heavyRain'),
  66: info('Light freezing rain', 'Lt freezing rain', 'Frz rain', 'sleet'),
  67: info('Heavy freezing rain', 'Freezing rain', 'Frz rain', 'sleet'),
  71: info('Light snow', 'Light snow', 'Lt snow', 'snow'),
  73: info('Snow', 'Snow', 'Snow', 'snow'),
  75: info('Heavy snow', 'Heavy snow', 'Hvy snow', 'heavySnow'),
  77: info('Snow grains', 'Snow grains', 'Sn grains', 'snow'),
  80: info('Light rain showers', 'Light showers', 'Showers', 'rain'),
  81: info('Rain showers', 'Showers', 'Showers', 'rain'),
  82: info('Violent rain showers', 'Heavy showers', 'Hvy shwrs', 'heavyRain'),
  85: info('Light snow showers', 'Snow showers', 'Snow shwr', 'snow'),
  86: info('Heavy snow showers', 'Hvy snow showers', 'Snow shwr', 'heavySnow'),
  95: info('Thunderstorm', 'Thunderstorm', 'T-storm', 'thunder'),
  96: info('Thunderstorm with light hail', 'Thunder and hail', 'T-storm', 'thunder'),
  99: info('Thunderstorm with heavy hail', 'Heavy hail storm', 'T-storm', 'thunder'),
};

/** Every code Open-Meteo documents, in order. */
export const WMO_CODES: readonly number[] = Object.keys(WMO).map(Number);

const UNKNOWN: WmoInfo = info('Unknown', 'Unknown', 'Unknown', 'unknown');

export function wmo(code: number | null | undefined): WmoInfo {
  return (code != null && Object.prototype.hasOwnProperty.call(WMO, code) ? WMO[code] : undefined) ?? UNKNOWN;
}

// ── Art ────────────────────────────────────────────────────────────────────────────────────
// Original pictograms, 13 columns by 5 rows, drawn in the block, quadrant and box-drawing
// characters of the terminal's font. Each segment carries the role that colours it, and an art
// row carries only the art roles below, never a text role: the weather card draws the lines
// that start with one at line height 1, so the blocks of one row meet the blocks of the next. A
// blank row is a cloud row of spaces, and the unknown mark is drawn in fog, which is muted like
// dim.

/** The roles the art is drawn in; no text line starts with one (view.ts). */
export const ART_ROLES: ReadonlySet<WeatherRole> = new Set<WeatherRole>(['sun', 'moon', 'cloud', 'rain', 'snow', 'bolt', 'fog']);

/** Whether a segment's role is one the art is drawn in. */
export function isArtRole(role: unknown): boolean {
  return typeof role === 'string' && (ART_ROLES as ReadonlySet<string>).has(role);
}

/** The cloud, three rows: two bumps and a flat base; the rain, snow and bolt fall from it. */
const CLOUD: readonly ArtRow[] = [
  [['cloud', '     ▄███▄   ']],
  [['cloud', '  ▄███████▙  ']],
  [['cloud', '  ▀█████████▘']],
];
const BLANK: ArtRow = [['cloud', '             ']];

export const ART: Readonly<Record<ArtKey, readonly ArtRow[]>> = {
  // The sun's disc with eight rays, a gap between them.
  clear: [
    [['sun', '  ╲   ╵   ╱  ']],
    [['sun', '    ▟███▙    ']],
    [['sun', '  ─ █████ ─  ']],
    [['sun', '    ▜███▛    ']],
    [['sun', '  ╱   ╷   ╲  ']],
  ],
  // A crescent and two stars.
  clearNight: [
    [['moon', '     ▄██▄  · ']],
    [['moon', '    ███▀     ']],
    [['moon', '    ██    ·  ']],
    [['moon', '    ███▄     ']],
    [['moon', '     ▀██▀    ']],
  ],
  // The sun above a cloud in front of it, its lower half behind the cloud's edge.
  partly: [
    [['sun', '   ╲ ╵ ╱     ']],
    [['sun', '  ─ ▟█▙ ─    ']],
    [['sun', '    ███ '], ['cloud', '▗██▖ ']],
    [['cloud', '  ▗▄▄▄▄▟████▙']],
    [['cloud', '  ▀█████████▘']],
  ],
  partlyNight: [
    [['moon', '   ▄█▄    ·  ']],
    [['moon', '  ██▀        ']],
    [['moon', '  ▀█▄   '], ['cloud', '▗██▖ ']],
    [['cloud', '  ▗▄▄▄▄▟████▙']],
    [['cloud', '  ▀█████████▘']],
  ],
  cloudy: [BLANK, ...CLOUD, BLANK],
  // Layers of haze.
  fog: [
    BLANK,
    [['fog', ' ─── ─── ─── ']],
    [['fog', '   ───── ─── ']],
    [['fog', ' ─── ─── ─── ']],
    [['fog', '   ─── ───── ']],
  ],
  // Rain by intensity: short ticks, lines, then heavy lines.
  drizzle: [...CLOUD, [['rain', '    ╷   ╷    ']], [['rain', '  ╷   ╷   ╷  ']]],
  rain: [...CLOUD, [['rain', '   │  │  │   ']], [['rain', '  │  │  │    ']]],
  heavyRain: [...CLOUD, [['rain', '  ┃ ┃ ┃ ┃ ┃  ']], [['rain', ' ┃ ┃ ┃ ┃ ┃   ']]],
  sleet: [
    ...CLOUD,
    [['rain', '   │ '], ['snow', '• '], ['rain', '│ '], ['snow', '•   ']],
    [['snow', '  • '], ['rain', '│ '], ['snow', '• '], ['rain', '│    ']],
  ],
  snow: [...CLOUD, [['snow', '   •   •   • ']], [['snow', '  •   •   •  ']]],
  heavySnow: [...CLOUD, [['snow', '  • • • • •  ']], [['snow', ' • • • • • • ']]],
  // A bolt with a kink and a tip, rain either side of it.
  thunder: [
    ...CLOUD,
    [['rain', '  │  '], ['bolt', '▄█▛  '], ['rain', '│  ']],
    [['rain', '   │ '], ['bolt', '▜▛  '], ['rain', '│   ']],
  ],
  // A question mark.
  unknown: [
    [['fog', '    ▗███▖    ']],
    [['fog', '    ▝▘ ▐▌    ']],
    [['fog', '      ▗▛     ']],
    [['fog', '      █      ']],
    [['fog', '      ▄      ']],
  ],
};

/** The art for an icon, using the moon at night for clear and partly cloudy skies. */
export function artFor(icon: IconKey, isDay: boolean): readonly ArtRow[] {
  if (!isDay && icon === 'clear') return ART.clearNight;
  if (!isDay && icon === 'partly') return ART.partlyNight;
  return ART[icon];
}

// ── Compass ────────────────────────────────────────────────────────────────────────────────

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'] as const;

/** The 16-point compass direction for a bearing in degrees, or '' when unknown. */
export function compass16(deg: number | null | undefined): string {
  if (deg == null || !Number.isFinite(deg)) return '';
  const normalised = ((deg % 360) + 360) % 360;
  return COMPASS[Math.round(normalised / 22.5) % 16] ?? '';
}
