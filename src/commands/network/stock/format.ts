// How stock writes numbers, prices, times and ages. Fixed en-US grouping, so a quote reads the
// same in every browser; prices in the instrument's own currency, to its own decimals, with the
// ISO code after the number ('332.89 USD') and minor units as their own suffix ('127.20p'), never
// a hard-coded '$'. Every Intl call has a fallback, for older WebViews that lack an option.

/** U+2212, which lines up with '+' where a hyphen would not. */
export const MINUS = '−';

/** Minor-unit currencies Yahoo reports prices in, and the suffix each is written with. */
const MINOR_UNITS: Readonly<Record<string, string>> = {
  GBp: 'p',
  GBX: 'p',
  ZAc: 'c',
  ZAC: 'c',
  ILA: ' ag',
};

const LOCALE = 'en-US';

/** A number to `decimals` places with thousands separators; never '-0'. */
export function formatNumber(value: number, decimals: number): string {
  const places = Math.min(8, Math.max(0, Math.round(decimals)));
  const rounded = Number(value.toFixed(places));
  const clean = Object.is(rounded, -0) ? 0 : rounded;
  let text: string;
  try {
    text = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: places, maximumFractionDigits: places }).format(Math.abs(clean));
  } catch {
    text = Math.abs(clean).toFixed(places);
  }
  return clean < 0 ? `${MINUS}${text}` : text;
}

/** A price in its currency: '332.89 USD', '127.20p', '0.6978 USD'; the bare number when unknown. */
export function formatPrice(value: number, currency: string | null, priceHint: number): string {
  const number = formatNumber(value, priceHint);
  if (currency === null) return number;
  const minor = MINOR_UNITS[currency];
  if (minor !== undefined) return `${number}${minor}`;
  return /^[A-Z]{3}$/.test(currency) ? `${number} ${currency}` : number;
}

/** With its sign always shown: '+0.65', '−0.80', '0.00'. */
export function formatSigned(value: number, decimals: number): string {
  const text = formatNumber(value, decimals);
  if (text.startsWith(MINUS)) return text;
  return /[1-9]/.test(text) ? `+${text}` : text;
}

/** Whether a change reads as up, down or flat at the decimals it is shown to. */
export function toneOf(value: number | null, decimals: number): 'up' | 'down' | 'flat' {
  if (value === null) return 'flat';
  const shown = formatNumber(value, decimals);
  if (!/[1-9]/.test(shown)) return 'flat';
  return value > 0 ? 'up' : 'down';
}

/** '▲ +0.65 (+0.43%)', '▼ −0.80 (−0.24%)', '◆ 0.00 (0.00%)'; null when there is no change. */
export function formatChange(change: number | null, percent: number | null, priceHint: number): string | null {
  if (change === null && percent === null) return null;
  const tone = toneOf(change ?? percent, change === null ? 2 : priceHint);
  const arrow = tone === 'up' ? '▲' : tone === 'down' ? '▼' : '◆';
  const parts = [arrow];
  if (change !== null) parts.push(formatSigned(change, priceHint));
  if (percent !== null) parts.push(change === null ? `${formatSigned(percent, 2)}%` : `(${formatSigned(percent, 2)}%)`);
  return parts.join(' ');
}

/** '▲ +0.43%', for the table. */
export function formatPercent(percent: number | null): string | null {
  if (percent === null) return null;
  const tone = toneOf(percent, 2);
  return `${tone === 'up' ? '▲' : tone === 'down' ? '▼' : '◆'} ${formatSigned(percent, 2)}%`;
}

/** 34.3M, 1.1K, 2.5B. */
export function formatCompact(value: number): string {
  try {
    return new Intl.NumberFormat(LOCALE, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
  } catch {
    const units: [number, string][] = [
      [1e12, 'T'],
      [1e9, 'B'],
      [1e6, 'M'],
      [1e3, 'K'],
    ];
    for (const [size, unit] of units) if (Math.abs(value) >= size) return `${Number((value / size).toFixed(1))}${unit}`;
    return String(Math.round(value));
  }
}

/** Unix seconds as a time of day in the exchange's zone: '4:00 PM EDT'; UTC when the zone is unknown. */
export function formatClock(sec: number, timezone: string | null, tzAbbr: string | null): string {
  const date = new Date(sec * 1000);
  if (timezone !== null) {
    try {
      const time = new Intl.DateTimeFormat(LOCALE, { timeZone: timezone, hour: 'numeric', minute: '2-digit' }).format(date);
      return tzAbbr === null ? time : `${time} ${tzAbbr}`;
    } catch {
      // An unknown zone name: UTC below.
    }
  }
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mm = String(date.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm} UTC`;
}

/** Unix seconds as a day, 'Oct 6', or a month, 'Oct 2026', in the exchange's zone. */
export function formatDay(sec: number, timezone: string | null, style: 'day' | 'month'): string {
  const date = new Date(sec * 1000);
  const options: Intl.DateTimeFormatOptions = style === 'day' ? { month: 'short', day: 'numeric' } : { month: 'short', year: 'numeric' };
  try {
    return new Intl.DateTimeFormat(LOCALE, { ...options, timeZone: timezone ?? 'UTC' }).format(date);
  } catch {
    return date.toISOString().slice(0, style === 'day' ? 10 : 7);
  }
}

/** A span of time ahead: '45m', '1h 39m', '2d 3h'. */
export function formatDuration(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/** How long ago: 'just now', '2 min ago', '2 h ago', '3 days ago'. */
export function formatAge(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} days ago`;
}
