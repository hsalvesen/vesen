import { commandHelp } from '../helpTexts';
import { playBeep } from '../beep';
import { fetchJson, fetchText, isNetError } from '../../services/net';
import { escapeHtml } from '../../output/escape';
import { cancelledNotice, errorLine } from '../notice';

// Per-request deadlines (docs/plan/02-architecture-and-contracts.md, section 4).
const WEATHER_TIMEOUT_MS = 8000;
const STOCK_TIMEOUT_MS = 8000;

// Interim source for stock until the owned Worker lands (docs/plan/07-stock-and-proxy.md).
const ALLORIGINS = 'https://api.allorigins.win/get';

const inSeconds = (ms: number) => `${ms / 1000} s`;

const wasCancelled = (error: unknown, signal?: AbortSignal) =>
  Boolean(signal?.aborted) || (isNetError(error) && error.kind === 'abort');

/** wttr.in's report in the theme's colours: temperatures, wind, rain, distances and conditions. */
function colourWeather(report: string): string {
  return report
    .replace(/(\d+°[CF]?)/g, `<span style="color: var(--theme-bright-red); font-weight: bold;">$1</span>`)
    .replace(/(\d+\s*(?:km\/h|mph|m\/s|kts))/g, `<span style="color: var(--theme-bright-blue); font-weight: bold;">$1</span>`)
    .replace(/(\d+%)/g, `<span style="color: var(--theme-cyan);">$1</span>`)
    .replace(/(\d+(?:\.\d+)?\s*mm)/g, `<span style="color: var(--theme-bright-cyan);">$1</span>`)
    .replace(/(\d+(?:\.\d+)?\s*km)/g, `<span style="color: var(--theme-green);">$1</span>`)
    .replace(/\b(sunny|clear|cloudy|overcast|rainy|snowy|foggy|misty|thunderstorm|drizzle|partly cloudy|mostly cloudy)\b/gi,
      `<span style="color: var(--theme-yellow); font-weight: bold;">$1</span>`)
    .replace(/\b([NSEW]{1,3})\b/g, `<span style="color: var(--theme-purple);">$1</span>`)
    .replace(/([☀☁⛅⛈🌧🌦🌩❄⛄🌫])/g, `<span style="color: var(--theme-bright-yellow);">$1</span>`)
    // The terminal's font has no diagonal arrows. The fallback font's glyph is held to one cell,
    // so the forecast table's columns after a wind direction stay in line.
    .replace(/([↖↗↘↙])/g, `<span class="art-cell">$1</span>`);
}

function weatherFailure(error: unknown): string {
  if (!isNetError(error)) return 'weather: the forecast could not be read. Try again in a moment.';
  switch (error.kind) {
    case 'timeout':
      return `weather: wttr.in did not respond within ${inSeconds(WEATHER_TIMEOUT_MS)}. Try again in a moment.`;
    case 'offline':
      return 'weather: you appear to be offline.';
    case 'http':
      return `weather: wttr.in returned HTTP ${error.status}. Try again later.`;
    default:
      return 'weather: could not reach wttr.in. Check your connection and try again.';
  }
}

function unknownLocation(place: string): string {
  return errorLine(`weather: no weather data for "${place}"`, 'Check the place name and try again, for example: weather Oslo');
}

function stockFailure(error: unknown): string {
  if (!isNetError(error)) return 'stock: something went wrong reading the quote. Try again later.';
  switch (error.kind) {
    case 'timeout':
      return `stock: no response from the quote service within ${inSeconds(STOCK_TIMEOUT_MS)}. Try again shortly.`;
    case 'offline':
      return 'stock: you appear to be offline.';
    case 'http':
      return `stock: the quote service is unavailable right now (HTTP ${error.status}). Try again later.`;
    case 'parse':
      return 'stock: the quote service sent a response that could not be read. Try again later.';
    default:
      return 'stock: could not reach the quote service. Try again later.';
  }
}

/** Yahoo's chart metadata as it arrives: relayed by a third-party proxy, so nothing is trusted. */
type YahooMeta = Record<string, unknown>;

/** The fields the card shows, each checked: a number is a finite number, text is a string. */
interface Quote {
  symbol: string | null;
  longName: string | null;
  shortName: string | null;
  price: number;
  previousClose: number | undefined;
  volume: number | undefined;
  high: number | undefined;
  low: number | undefined;
  open: number | undefined;
}

interface AllOriginsEnvelope {
  contents?: unknown;
  status?: { http_code?: unknown };
}

type QuoteLookup =
  | { kind: 'ok'; quote: Quote }
  | { kind: 'not-found' }
  | { kind: 'upstream'; status: number }
  | { kind: 'unreadable' };

const num = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const str = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);

/** Checks every field the card uses. No price means the response is unreadable. */
function readQuote(meta: YahooMeta): Quote | null {
  const price = num(meta.regularMarketPrice);
  if (price === undefined) return null;
  return {
    symbol: str(meta.symbol),
    longName: str(meta.longName),
    shortName: str(meta.shortName),
    price,
    previousClose: num(meta.previousClose),
    volume: num(meta.regularMarketVolume),
    high: num(meta.regularMarketDayHigh),
    low: num(meta.regularMarketDayLow),
    open: num(meta.regularMarketOpen),
  };
}

/** Checks the proxy's envelope and Yahoo's chart response inside it. */
function readQuoteEnvelope(envelope: AllOriginsEnvelope | null): QuoteLookup {
  const code = envelope?.status?.http_code;
  const upstreamStatus = typeof code === 'number' && (code < 200 || code >= 300) ? code : null;

  let chart: { error?: unknown; result?: { meta?: unknown }[] } | undefined;
  if (typeof envelope?.contents === 'string' && envelope.contents !== '') {
    try {
      chart = JSON.parse(envelope.contents)?.chart;
    } catch {
      chart = undefined;
    }
  }

  // Yahoo answers an unknown ticker with 404 and a chart error, which the proxy passes through.
  if (chart && (chart.error || !Array.isArray(chart.result) || chart.result.length === 0)) return { kind: 'not-found' };
  if (upstreamStatus !== null) return { kind: 'upstream', status: upstreamStatus };
  const meta = chart?.result?.[0]?.meta;
  const quote = meta && typeof meta === 'object' ? readQuote(meta as YahooMeta) : null;
  return quote ? { kind: 'ok', quote } : { kind: 'unreadable' };
}

function quoteLookupFailure(lookup: Exclude<QuoteLookup, { kind: 'ok' }>, ticker: string): string {
  switch (lookup.kind) {
    case 'not-found':
      return errorLine(`stock: no data found for ticker ${ticker}`, 'Check the ticker symbol and try again, for example: stock AAPL');
    case 'upstream':
      return errorLine(
        lookup.status === 429
          ? 'stock: the quote service is rate-limited (HTTP 429). Try again in a minute.'
          : `stock: the quote service returned HTTP ${lookup.status}. Try again later.`,
      );
    case 'unreadable':
      return errorLine('stock: the quote service sent a response that could not be read. Try again later.');
  }
}

/** The legacy stock card: price, change, day range, trends and a small OHLC chart. */
function renderQuote(quote: Quote, ticker: string): string {
  const symbol = escapeHtml(quote.symbol ?? ticker);
  const companyName = escapeHtml(quote.longName ?? quote.shortName ?? quote.symbol ?? ticker);
  const price = quote.price;
  const previousClose = quote.previousClose || 0;
  const change = price - previousClose;
  const changePercent = previousClose > 0 ? ((change / previousClose) * 100) : 0;
  const volume = quote.volume === undefined ? '—' : quote.volume.toLocaleString();
  const high = quote.high || price;
  const low = quote.low || price;
  const open = quote.open || price;

  // Determine if stock is up or down
  const isPositive = change >= 0;
  const changeColor = isPositive ? 'var(--theme-bright-green)' : 'var(--theme-bright-red)';
  const arrow = isPositive ? '↗' : '↘';

  // Create simple ASCII chart based on day's range
  const createMiniChart = (current: number, low: number, high: number): string => {
    const range = high - low;
    if (range === 0 || isNaN(range)) return '━━━━━━━━━━';

    const position = Math.round(((current - low) / range) * 9);
    let chart = '';

    for (let i = 0; i <= 9; i++) {
      if (i === position) {
        chart += isPositive ? '▲' : '▼';
      } else if (i < position) {
        chart += '━';
      } else {
        chart += '─';
      }
    }
    return chart;
  };

  const miniChart = createMiniChart(price, low, high);

  // OHLC ASCII chart: about a dozen columns wide, so it fits any screen.
  const createOHLCChart = (open: number, high: number, low: number, close: number): string => {
    const range = high - low;
    if (range === 0 || isNaN(range)) return 'No range data available';

    const formatPriceLabel = (label: string, price: number): string => {
      const priceStr = price.toFixed(2);
      return `${label}─${priceStr.padStart(8, ' ')}`;
    };

    const chartHeight = 8;
    const normalize = (value: number) => Math.round(((value - low) / range) * chartHeight);

    const openPos = normalize(open);
    const closePos = normalize(close);
    const highPos = normalize(high);
    const lowPos = normalize(low);

    let chart = '';

    for (let row = chartHeight; row >= 0; row--) {
      let line = '';

      if (row === highPos) {
        line = `<span style="color: var(--theme-bright-green);">${formatPriceLabel('H', high)}</span>`;
      } else if (row === openPos && row === closePos) {
        const color = close >= open ? 'var(--theme-bright-green)' : 'var(--theme-bright-red)';
        line = `<span style="color: ${color};">${formatPriceLabel('O/C', close)}</span>`;
      } else if (row === openPos) {
        line = `<span style="color: var(--theme-yellow);">${formatPriceLabel('O', open)}</span>`;
      } else if (row === closePos) {
        const color = close >= open ? 'var(--theme-bright-green)' : 'var(--theme-bright-red)';
        line = `<span style="color: ${color};">${formatPriceLabel('C', close)}</span>`;
      } else if (row === lowPos) {
        line = `<span style="color: var(--theme-bright-red);">${formatPriceLabel('L', low)}</span>`;
      } else if (row > lowPos && row < highPos) {
        if ((row > Math.min(openPos, closePos) && row < Math.max(openPos, closePos)) ||
            (openPos === closePos && Math.abs(row - openPos) <= 1)) {
          const color = close >= open ? 'var(--theme-green)' : 'var(--theme-red)';
          line = `<span style="color: ${color};">│</span>`;
        } else {
          line = `<span style="color: var(--theme-white);">│</span>`;
        }
      } else {
        line = ' ';
      }

      chart += line + '\n';
    }

    return chart;
  };

  const ohlcChart = createOHLCChart(open, high, low, price);

  // Format the output
  let output = `<span style="color: var(--theme-bright-cyan); font-weight: bold;">${symbol}</span>`;
  if (companyName && companyName !== symbol) {
    output += ` <span style="color: var(--theme-white);">- ${companyName}</span>`;
  }
  output += `\n`;
  output += `<span style="color: var(--theme-white);">$${price.toFixed(2)}</span> `;
  output += `<span style="color: ${changeColor}; font-weight: bold;">${arrow} ${change >= 0 ? '+' : ''}${change.toFixed(2)} (${changePercent.toFixed(2)}%)</span>\n\n`;

  // Side by side where the output has room, the chart under the figures where it has not: the
  // layout follows the output's own width, so a rotated phone reflows it without fetching the
  // quote again (styles/components.css, .out-split).
  output += `<div class="out-split">\n`;

  output += `<div class="out-split-main">`;
  output += `<span style="color: var(--theme-yellow);">Day Range:</span> `;
  output += `<span style="color: var(--theme-green);">$${low.toFixed(2)}</span> `;
  output += `<span style="color: var(--theme-white);">${miniChart}</span> `;
  output += `<span style="color: var(--theme-red);">$${high.toFixed(2)}</span>\n\n`;

  output += `<span style="color: var(--theme-cyan);">Open:</span> <span style="color: var(--theme-white);">$${open.toFixed(2)}</span>\n`;
  output += `<span style="color: var(--theme-cyan);">Previous Close:</span> <span style="color: var(--theme-white);">$${previousClose.toFixed(2)}</span>\n`;
  output += `<span style="color: var(--theme-cyan);">Volume:</span> <span style="color: var(--theme-white);">${volume}</span>\n\n`;

  const trendFromOpen = price - open;
  const trendFromPrevious = change;

  output += `<span style="color: var(--theme-purple);">Trends:</span>\n`;
  output += `From Open: <span style="color: ${trendFromOpen >= 0 ? 'var(--theme-green)' : 'var(--theme-red)'};">$${trendFromOpen.toFixed(2)} (${open > 0 ? ((trendFromOpen/open)*100).toFixed(2) : '0.00'}%)</span>\n`;
  output += `From Previous: <span style="color: ${trendFromPrevious >= 0 ? 'var(--theme-green)' : 'var(--theme-red)'};">$${trendFromPrevious.toFixed(2)} (${changePercent.toFixed(2)}%)</span>\n`;
  output += `</div>\n`;

  output += `<div class="out-split-side">`;
  output += `<span style="color: var(--theme-purple); font-weight: bold;">OHLC Chart:</span>\n`;
  output += `<pre class="art" style="margin: 0;">${ohlcChart}</pre>`;
  output += `</div>\n`;

  output += `</div>\n`;

  return output;
}

export const networkCommands = {
  weather: async (args: string[], signal?: AbortSignal) => {
    let city = args.join('+');

    if (!city) {
      return commandHelp.weather;
    }

    // Location mapping for better accuracy and accessibility
    const locationMappings: Record<string, string> = {
      'palestine': 'occupied+palestinian+territories',
      'gaza': 'gaza+palestine',
      'west+bank': 'west+bank+palestine',
      'westbank': 'west+bank+palestine',
      'ramallah': 'ramallah+palestine',
      'bethlehem': 'bethlehem+palestine',
      'hebron': 'hebron+palestine',
      'nablus': 'nablus+palestine',
      'jenin': 'jenin+palestine',
      'tulkarm': 'tulkarm+palestine',
      'qalqilya': 'qalqilya+palestine',
      'jericho': 'jericho+palestine',
      'khan+younis': 'khan+younis+gaza+palestine',
      'rafah': 'rafah+gaza+palestine'
    };

    // Check if the query matches any location mapping
    const normalisedCity = city.toLowerCase();
    if (locationMappings[normalisedCity]) {
      city = locationMappings[normalisedCity];
    }
    const place = city.replace(/\+/g, ' ');

    let result: string;
    try {
      result = escapeHtml(await fetchText(`https://wttr.in/${city}?ATm`, { signal, timeoutMs: WEATHER_TIMEOUT_MS }));
    } catch (error) {
      if (wasCancelled(error, signal)) return cancelledNotice('weather');
      playBeep();
      if (isNetError(error) && error.kind === 'http' && error.status === 404) return unknownLocation(place);
      return errorLine(weatherFailure(error));
    }

    // Check if the response indicates an unknown location
    if (result.includes('404 UNKNOWN LOCATION') || result.includes('ERROR') || result.includes('Unknown location')) {
      playBeep();
      return unknownLocation(place);
    }

    // Remove the attribution line (last line with @igor_chubin)
    const lines = result.split('\n');
    const filteredLines = lines.filter(line =>
      !line.includes('Follow @igor_chubin') &&
      !line.includes('wttr.in updates')
    );

    // The report opens with the current conditions (seven lines), then the forecast tables, which
    // are about 125 columns wide, then the location. The tables are art: they keep their rows,
    // shrink a little to the output's width (.out-wide), and below that scroll sideways inside
    // themselves on a narrow screen, rather than wrapping into a jumble.
    const locationAt = filteredLines.findIndex(line =>
      line.includes('Location:') && line.includes('[') && line.includes(']')
    );
    const tableEnd = locationAt === -1 ? filteredLines.length : locationAt;
    const current = filteredLines.slice(0, 7).join('\n');
    const forecast = filteredLines.slice(7, tableEnd).join('\n');
    const rest = filteredLines.slice(tableEnd).join('\n');

    // The report's title, its first line, is the one in bold green.
    return colourWeather(current).replace(/^(.+)$/m, `<span style="color: var(--theme-bright-green); font-weight: bold;">$1</span>`) +
      (forecast.trim() ? `<div class="art out-wide">${colourWeather(forecast)}</div>` : '\n') +
      colourWeather(rest);
  },

  stock: async (args: string[], signal?: AbortSignal) => {
    if (args.length === 0) {
      return commandHelp.stock;
    }

    const ticker = args[0].toUpperCase();
    const chartUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}`;

    let lookup: QuoteLookup;
    try {
      const envelope = await fetchJson<AllOriginsEnvelope | null>(`${ALLORIGINS}?url=${encodeURIComponent(chartUrl)}`, {
        signal,
        timeoutMs: STOCK_TIMEOUT_MS,
      });
      lookup = readQuoteEnvelope(envelope);
    } catch (error) {
      if (wasCancelled(error, signal)) return cancelledNotice('stock');
      playBeep();
      return errorLine(stockFailure(error));
    }

    if (lookup.kind !== 'ok') {
      playBeep();
      return quoteLookupFailure(lookup, ticker);
    }
    return renderQuote(lookup.quote, ticker);
  }
}
