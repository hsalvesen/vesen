// WMO weather interpretation codes as Open-Meteo reports them, with labels, icons and art.
// The codes are the 28 that Open-Meteo documents for `weather_code`; any other value in 0-99
// falls back to 'Unknown'.

import type { ArtKey, ArtRow, IconKey, WmoInfo } from './types';

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
// Original, pure ASCII, 13 columns by 5 rows. Segments carry the role that colours them.

const C1: ArtRow = [['cloud', '     .--.    ']];
const C2: ArtRow = [['cloud', '  .-(    ).  ']];
const C3: ArtRow = [['cloud', ' (___.__)__) ']];
const BLANK: ArtRow = [['dim', '             ']];

export const ART: Readonly<Record<ArtKey, readonly ArtRow[]>> = {
  clear: [
    [['sun', '    \\ | /    ']],
    [['sun', '   - .-. -   ']],
    [['sun', '  -- (   ) --']],
    [['sun', "   - `-' -   "]],
    [['sun', '    / | \\    ']],
  ],
  clearNight: [
    [['moon', '     _..     ']],
    [['moon', "   .' .'     "]],
    [['moon', '  :  :       ']],
    [['moon', "   '. '.     "]],
    [['moon', "     `''     "]],
  ],
  partly: [
    [['sun', '  \\ | /      ']],
    [['sun', ' -  O  '], ['cloud', '.--.  ']],
    [['sun', '  / | '], ['cloud', '(    ).']],
    [['dim', '     '], ['cloud', '(___(__)']],
    BLANK,
  ],
  partlyNight: [
    [['moon', '   _..       ']],
    [['moon', " .' .' "], ['cloud', '.--.  ']],
    [['moon', ' :  : '], ['cloud', '(    ).']],
    [['moon', "  '. "], ['cloud', '(___(__)']],
    BLANK,
  ],
  cloudy: [BLANK, C1, C2, C3, BLANK],
  fog: [BLANK, [['fog', ' _ - _ - _ - ']], [['fog', '  _ - _ - _  ']], [['fog', ' _ - _ - _ - ']], BLANK],
  drizzle: [C1, C2, C3, [['rain', "   '   '   ' "]], [['rain', "  '   '   '  "]]],
  rain: [C1, C2, C3, [['rain', "  ' ' ' ' '  "]], [['rain', " ' ' ' ' '   "]]],
  heavyRain: [C1, C2, C3, [['rain', " ,',',',','  "]], [['rain', " ,',',',','  "]]],
  sleet: [
    C1,
    C2,
    C3,
    [['rain', "  ' "], ['snow', '*'], ['rain', " ' "], ['snow', '*'], ['rain', " '  "]],
    [['snow', ' * '], ['rain', "' "], ['snow', '* '], ['rain', "' "], ['snow', '*   ']],
  ],
  snow: [C1, C2, C3, [['snow', '  *   *   *  ']], [['snow', '    *   *    ']]],
  heavySnow: [C1, C2, C3, [['snow', ' * * * * * * ']], [['snow', '  * * * * *  ']]],
  thunder: [
    C1,
    C2,
    C3,
    [['bolt', '   _/  _/    ']],
    [['rain', "  ' "], ['bolt', '/'], ['rain', " ' "], ['bolt', '/'], ['rain', " '  "]],
  ],
  unknown: [
    [['dim', '     .-.     ']],
    [['dim', '    (   )    ']],
    [['dim', "      .'     "]],
    [['dim', '      |      ']],
    [['dim', '      .      ']],
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
