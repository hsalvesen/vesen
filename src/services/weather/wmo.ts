// WMO weather interpretation codes as Open-Meteo reports them, with labels, icons and art.
// The codes are the 28 that Open-Meteo documents for `weather_code`; any other value in 0-99
// falls back to 'Unknown'. Each code's icon is the one wego gives the like World Weather Online
// condition (moderate rain and snow count as heavy there; a thunderstorm is thundery showers,
// one with hail thundery heavy rain), so the card reads as wttr.in did.

import type { ArtKey, ArtRow, IconKey, WeatherRole, WmoInfo } from './types';

/** Each art row is exactly this many columns, so the text beside it lines up. */
export const ART_WIDTH = 13;
export const ART_HEIGHT = 5;

/** Label length limits, so each fits the column it is used in. */
export const MEDIUM_MAX = 16;
export const SHORT_MAX = 9;

const info = (label: string, medium: string, short: string, icon: IconKey): WmoInfo => ({ label, medium, short, icon });

export const WMO: Readonly<Record<number, WmoInfo>> = {
  0: info('Clear sky', 'Clear sky', 'Clear', 'sunny'),
  1: info('Mainly clear', 'Mainly clear', 'Clear', 'sunny'),
  2: info('Partly cloudy', 'Partly cloudy', 'Pt cloudy', 'partlyCloudy'),
  3: info('Overcast', 'Overcast', 'Overcast', 'veryCloudy'),
  45: info('Fog', 'Fog', 'Fog', 'fog'),
  48: info('Depositing rime fog', 'Rime fog', 'Rime fog', 'fog'),
  51: info('Light drizzle', 'Light drizzle', 'Drizzle', 'lightRain'),
  53: info('Drizzle', 'Drizzle', 'Drizzle', 'lightRain'),
  55: info('Dense drizzle', 'Dense drizzle', 'Drizzle', 'lightRain'),
  56: info('Light freezing drizzle', 'Lt frz drizzle', 'Frz drzl', 'lightSleet'),
  57: info('Dense freezing drizzle', 'Freezing drizzle', 'Frz drzl', 'lightSleet'),
  61: info('Light rain', 'Light rain', 'Lt rain', 'lightRain'),
  63: info('Rain', 'Rain', 'Rain', 'heavyRain'),
  65: info('Heavy rain', 'Heavy rain', 'Hvy rain', 'heavyRain'),
  66: info('Light freezing rain', 'Lt freezing rain', 'Frz rain', 'lightSleet'),
  67: info('Heavy freezing rain', 'Freezing rain', 'Frz rain', 'lightSleet'),
  71: info('Light snow', 'Light snow', 'Lt snow', 'lightSnow'),
  73: info('Snow', 'Snow', 'Snow', 'heavySnow'),
  75: info('Heavy snow', 'Heavy snow', 'Hvy snow', 'heavySnow'),
  77: info('Snow grains', 'Snow grains', 'Sn grains', 'lightSnow'),
  80: info('Light rain showers', 'Light showers', 'Showers', 'lightShowers'),
  81: info('Rain showers', 'Showers', 'Showers', 'heavyShowers'),
  82: info('Violent rain showers', 'Heavy showers', 'Hvy shwrs', 'heavyShowers'),
  85: info('Light snow showers', 'Snow showers', 'Snow shwr', 'lightSnowShowers'),
  86: info('Heavy snow showers', 'Hvy snow showers', 'Snow shwr', 'heavySnowShowers'),
  95: info('Thunderstorm', 'Thunderstorm', 'T-storm', 'thunderyShowers'),
  96: info('Thunderstorm with light hail', 'Thunder and hail', 'T-storm', 'thunderyHeavyRain'),
  99: info('Thunderstorm with heavy hail', 'Heavy hail storm', 'T-storm', 'thunderyHeavyRain'),
};

/** Every code Open-Meteo documents, in order. */
export const WMO_CODES: readonly number[] = Object.keys(WMO).map(Number);

const UNKNOWN: WmoInfo = info('Unknown', 'Unknown', 'Unknown', 'unknown');

export function wmo(code: number | null | undefined): WmoInfo {
  return (code != null && Object.prototype.hasOwnProperty.call(WMO, code) ? WMO[code] : undefined) ?? UNKNOWN;
}

// ── Art ────────────────────────────────────────────────────────────────────────────────────
// wttr.in's pictograms, as the site drew them before this rewrite (it showed wttr.in's own text
// then): the icon table of wego 2.1 (github.com/schachmat/wego, frontends/ascii-art-table.go,
// ISC licence, copyright 2014-2017 its author, Markus Teich), which wttr.in renders with, row for row.
// Thirteen columns by five rows; each run carries the role of the colour wego gives it: the sun
// (yellow), a cloud (grey; heavy weather's is darker and bold there), rain (blue), snow (white),
// the bolt (yellow, blinking there) and fog (grey); the unknown mark is drawn in fog. Six glyphs
// are outside ASCII: the okina ʻ of the rain drops is in the terminal font; the figure dash ‒
// of the sun's rays, the Greek psili ᾿ of the sun's and the unknown mark's chins and the ⚡ of
// thunder are not, so the card pins each to one cell (WeatherCard.svelte). wttr.in has no night
// variants: the sun shines at night too.

/** The roles the art is drawn in; every art segment carries one, so each has a colour. */
export const ART_ROLES: ReadonlySet<WeatherRole> = new Set<WeatherRole>(['sun', 'cloud', 'rain', 'snow', 'bolt', 'fog']);

/** Whether a segment's role is one the art is drawn in. */
export function isArtRole(role: unknown): boolean {
  return typeof role === 'string' && (ART_ROLES as ReadonlySet<string>).has(role);
}

/** The glyphs of the art that the terminal font lacks, each pinned to one cell by the card. */
export const ART_FALLBACK_GLYPHS: readonly string[] = ['\u2012', '\u1fbf', '\u26a1'];

export const ART: Readonly<Record<ArtKey, readonly ArtRow[]>> = {
  sunny: [
    [['sun', '    \\   /    ']],
    [['sun', '     .-.     ']],
    [['sun', '  ‒ (   ) ‒  ']],
    [['sun', '     `-᾿     ']],
    [['sun', '    /   \\    ']],
  ],
  partlyCloudy: [
    [['sun', '   \\  /      ']],
    [['sun', ' _ /""'], ['cloud', '.-.    ']],
    [['sun', '   \\_'], ['cloud', '(   ).  ']],
    [['sun', '   /'], ['cloud', '(___(__) ']],
    [['cloud', '             ']],
  ],
  cloudy: [
    [['cloud', '             ']],
    [['cloud', '     .--.    ']],
    [['cloud', '  .-(    ).  ']],
    [['cloud', ' (___.__)__) ']],
    [['cloud', '             ']],
  ],
  veryCloudy: [
    [['cloud', '             ']],
    [['cloud', '     .--.    ']],
    [['cloud', '  .-(    ).  ']],
    [['cloud', ' (___.__)__) ']],
    [['cloud', '             ']],
  ],
  fog: [
    [['fog', '             ']],
    [['fog', ' _ - _ - _ - ']],
    [['fog', '  _ - _ - _  ']],
    [['fog', ' _ - _ - _ - ']],
    [['fog', '             ']],
  ],
  lightRain: [
    [['cloud', '     .-.     ']],
    [['cloud', '    (   ).   ']],
    [['cloud', '   (___(__)  ']],
    [['rain', '    ʻ ʻ ʻ ʻ  ']],
    [['rain', '   ʻ ʻ ʻ ʻ   ']],
  ],
  heavyRain: [
    [['cloud', '     .-.     ']],
    [['cloud', '    (   ).   ']],
    [['cloud', '   (___(__)  ']],
    [['rain', '  ‚ʻ‚ʻ‚ʻ‚ʻ   ']],
    [['rain', '  ‚ʻ‚ʻ‚ʻ‚ʻ   ']],
  ],
  lightShowers: [
    [['sun', ' _`/""'], ['cloud', '.-.    ']],
    [['sun', '  ,\\_'], ['cloud', '(   ).  ']],
    [['sun', '   /'], ['cloud', '(___(__) ']],
    [['rain', '     ʻ ʻ ʻ ʻ ']],
    [['rain', '    ʻ ʻ ʻ ʻ  ']],
  ],
  heavyShowers: [
    [['sun', ' _`/""'], ['cloud', '.-.    ']],
    [['sun', '  ,\\_'], ['cloud', '(   ).  ']],
    [['sun', '   /'], ['cloud', '(___(__) ']],
    [['rain', '   ‚ʻ‚ʻ‚ʻ‚ʻ  ']],
    [['rain', '   ‚ʻ‚ʻ‚ʻ‚ʻ  ']],
  ],
  lightSleet: [
    [['cloud', '     .-.     ']],
    [['cloud', '    (   ).   ']],
    [['cloud', '   (___(__)  ']],
    [['rain', '    ʻ '], ['snow', '*'], ['rain', ' ʻ '], ['snow', '*  ']],
    [['snow', '   *'], ['rain', ' ʻ '], ['snow', '*'], ['rain', ' ʻ   ']],
  ],
  lightSleetShowers: [
    [['sun', ' _`/""'], ['cloud', '.-.    ']],
    [['sun', '  ,\\_'], ['cloud', '(   ).  ']],
    [['sun', '   /'], ['cloud', '(___(__) ']],
    [['rain', '     ʻ '], ['snow', '*'], ['rain', ' ʻ '], ['snow', '* ']],
    [['snow', '    *'], ['rain', ' ʻ '], ['snow', '*'], ['rain', ' ʻ  ']],
  ],
  lightSnow: [
    [['cloud', '     .-.     ']],
    [['cloud', '    (   ).   ']],
    [['cloud', '   (___(__)  ']],
    [['snow', '    *  *  *  ']],
    [['snow', '   *  *  *   ']],
  ],
  heavySnow: [
    [['cloud', '     .-.     ']],
    [['cloud', '    (   ).   ']],
    [['cloud', '   (___(__)  ']],
    [['snow', '   * * * *   ']],
    [['snow', '  * * * *    ']],
  ],
  lightSnowShowers: [
    [['sun', ' _`/""'], ['cloud', '.-.    ']],
    [['sun', '  ,\\_'], ['cloud', '(   ).  ']],
    [['sun', '   /'], ['cloud', '(___(__) ']],
    [['snow', '     *  *  * ']],
    [['snow', '    *  *  *  ']],
  ],
  heavySnowShowers: [
    [['sun', ' _`/""'], ['cloud', '.-.    ']],
    [['sun', '  ,\\_'], ['cloud', '(   ).  ']],
    [['sun', '   /'], ['cloud', '(___(__) ']],
    [['snow', '    * * * *  ']],
    [['snow', '   * * * *   ']],
  ],
  thunderyShowers: [
    [['sun', ' _`/""'], ['cloud', '.-.    ']],
    [['sun', '  ,\\_'], ['cloud', '(   ).  ']],
    [['sun', '   /'], ['cloud', '(___(__) ']],
    [['bolt', '    ⚡'], ['rain', 'ʻ ʻ'], ['bolt', '⚡'], ['rain', 'ʻ ʻ ']],
    [['rain', '    ʻ ʻ ʻ ʻ  ']],
  ],
  thunderyHeavyRain: [
    [['cloud', '     .-.     ']],
    [['cloud', '    (   ).   ']],
    [['cloud', '   (___(__)  ']],
    [['rain', '  ‚ʻ'], ['bolt', '⚡'], ['rain', 'ʻ‚'], ['bolt', '⚡'], ['rain', '‚ʻ   ']],
    [['rain', '  ‚ʻ‚ʻ'], ['bolt', '⚡'], ['rain', 'ʻ‚ʻ   ']],
  ],
  thunderySnowShowers: [
    [['sun', ' _`/""'], ['cloud', '.-.    ']],
    [['sun', '  ,\\_'], ['cloud', '(   ).  ']],
    [['sun', '   /'], ['cloud', '(___(__) ']],
    [['snow', '     *'], ['bolt', '⚡'], ['snow', ' *'], ['bolt', '⚡'], ['snow', ' * ']],
    [['snow', '    *  *  *  ']],
  ],
  unknown: [
    [['fog', '    .-.      ']],
    [['fog', '     __)     ']],
    [['fog', '    (        ']],
    [['fog', '     `-᾿     ']],
    [['fog', '      •      ']],
  ],
};

/** The art for an icon. The day flag stays for the view's call; wttr.in draws the same art at night. */
export function artFor(icon: IconKey, _isDay: boolean): readonly ArtRow[] {
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
