import { theme } from '../../stores/theme';
import { speedtestPhase } from '../../stores/history';
import { get } from 'svelte/store';
import { commandHelp } from '../helpTexts';
import { playBeep } from '../beep';
import { shouldUseStackedLayout, getAvailableWidth, isMobileDevice } from '../mobile';
import { fetchJson, fetchText, fetchWithTimeout, isNetError } from '../../services/net';
import { escapeHtml } from '../../output/escape';
import { cancelledNotice, errorLine } from '../notice';

// Per-request deadlines (docs/plan/02-architecture-and-contracts.md, section 4).
const WEATHER_TIMEOUT_MS = 8000;
const CURL_TIMEOUT_MS = 10000;
const STOCK_TIMEOUT_MS = 8000;
const SPEEDTEST_TIMEOUT_MS = 15000;

// Interim source for stock until the owned Worker lands (docs/plan/07-stock-and-proxy.md).
const ALLORIGINS = 'https://api.allorigins.win/get';

const inSeconds = (ms: number) => `${ms / 1000} s`;

const wasCancelled = (error: unknown, signal?: AbortSignal) =>
  Boolean(signal?.aborted) || (isNetError(error) && error.kind === 'abort');

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
  return `<span style="color: var(--theme-red); font-weight: bold;">Weather data not available for "${escapeHtml(place)}"</span>\n<span style="color: var(--theme-yellow);">Please check the city name and try again.</span>\n<span style="color: var(--theme-cyan);">Example: weather Oslo</span>`;
}

function curlFailure(error: unknown, host: string): string {
  if (isNetError(error)) {
    switch (error.kind) {
      case 'timeout':
        return `curl: (28) Operation timed out after ${CURL_TIMEOUT_MS} milliseconds`;
      case 'offline':
        return `curl: (6) Could not resolve host: ${host} (you appear to be offline)`;
      case 'cors':
      case 'network':
        return `curl: (7) blocked by CORS: ${host} does not allow browser requests`;
    }
  }
  return `curl: (56) Failure when receiving data from ${host}`;
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

function speedtestFailure(error: unknown): string {
  if (!isNetError(error)) return 'speedtest: the test failed. Try again later.';
  switch (error.kind) {
    case 'timeout':
      return `speedtest: ${error.host} did not respond within ${inSeconds(SPEEDTEST_TIMEOUT_MS)}.`;
    case 'offline':
      return 'speedtest: you appear to be offline.';
    case 'http':
      return `speedtest: ${error.host} returned HTTP ${error.status}.`;
    default:
      return `speedtest: could not reach ${error.host}.`;
  }
}

interface YahooMeta {
  symbol?: unknown;
  longName?: unknown;
  shortName?: unknown;
  regularMarketPrice?: number;
  previousClose?: number;
  regularMarketVolume?: number;
  regularMarketDayHigh?: number;
  regularMarketDayLow?: number;
  regularMarketOpen?: number;
}

interface AllOriginsEnvelope {
  contents?: unknown;
  status?: { http_code?: unknown };
}

type QuoteLookup =
  | { kind: 'ok'; meta: YahooMeta }
  | { kind: 'not-found' }
  | { kind: 'upstream'; status: number }
  | { kind: 'unreadable' };

/** Checks the proxy's envelope and Yahoo's chart response inside it. */
function readQuoteEnvelope(envelope: AllOriginsEnvelope | null): QuoteLookup {
  const code = envelope?.status?.http_code;
  const upstreamStatus = typeof code === 'number' && (code < 200 || code >= 300) ? code : null;

  let chart: { error?: unknown; result?: { meta?: YahooMeta }[] } | undefined;
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
  return meta ? { kind: 'ok', meta } : { kind: 'unreadable' };
}

function quoteLookupFailure(lookup: Exclude<QuoteLookup, { kind: 'ok' }>, ticker: string): string {
  switch (lookup.kind) {
    case 'not-found':
      return `<span style="color: var(--theme-red); font-weight: bold;">No data found for ticker: ${escapeHtml(ticker)}</span>\n<span style="color: var(--theme-yellow);">Please verify the ticker symbol is correct.</span>`;
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
function renderQuote(meta: YahooMeta, ticker: string): string {
  // Extract stock data with proper null checks
  const symbol = escapeHtml(String(meta.symbol ?? ticker));
  const longName = typeof meta.longName === 'string' ? meta.longName : '';
  const shortName = typeof meta.shortName === 'string' ? meta.shortName : '';
  const companyName = longName ? escapeHtml(longName) : shortName ? escapeHtml(shortName) : symbol;
  const price = meta.regularMarketPrice || 0;
  const previousClose = meta.previousClose || 0;
  const change = price - previousClose;
  const changePercent = previousClose > 0 ? ((change / previousClose) * 100) : 0;
  const volume = meta.regularMarketVolume || 0;
  const high = meta.regularMarketDayHigh || price;
  const low = meta.regularMarketDayLow || price;
  const open = meta.regularMarketOpen || price;

  // Ensure we have valid numbers
  if (isNaN(price) || isNaN(low) || isNaN(high)) {
    playBeep();
    return `<span style="color: var(--theme-red); font-weight: bold;">Invalid data received for ticker: ${escapeHtml(ticker)}</span>\n<span style="color: var(--theme-yellow);">Please try again later.</span>`;
  }

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

  // Determine layout type for responsive design
  const useStackedLayout = shouldUseStackedLayout(600);
  const availableWidth = getAvailableWidth();

  // Create OHLC ASCII chart with mobile responsiveness
  const createOHLCChart = (open: number, high: number, low: number, close: number, isMobile: boolean = false): string => {
    const range = high - low;
    if (range === 0 || isNaN(range)) return 'No range data available';

    const formatPriceLabel = (label: string, price: number): string => {
      const priceStr = price.toFixed(2);
      if (isMobile) {
        // Shorter format for mobile to prevent overflow
        return `${label}${priceStr.padStart(6, ' ')}`;
      }
      return `${label}─${priceStr.padStart(8, ' ')}`;
    };

    const chartHeight = isMobile ? 6 : 8; // Shorter chart on mobile
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

  const ohlcChart = createOHLCChart(open, high, low, price, useStackedLayout);

  // Format the output
  let output = `<span style="color: var(--theme-bright-cyan); font-weight: bold; font-size: 1em;">${symbol}</span>`;
  if (companyName && companyName !== symbol) {
    output += ` <span style="color: var(--theme-white); font-size: 1em;">- ${companyName}</span>`;
  }
  output += `\n`;
  output += `<span style="color: var(--theme-white); font-size: 1.1em;">$${price.toFixed(2)}</span> `;
  output += `<span style="color: ${changeColor}; font-weight: bold;">${arrow} ${change >= 0 ? '+' : ''}${change.toFixed(2)} (${changePercent.toFixed(2)}%)</span>\n\n`;

  // Use responsive layout based on screen size

  if (useStackedLayout) {
    // Mobile/narrow screen layout - stack vertically
    output += `<div style="display: flex; flex-direction: column; gap: 15px;">\n`;

    // Stock info section
    output += `<div style="width: 100%; max-width: ${availableWidth}px;">`;
    output += `<span style="color: var(--theme-yellow);">Day Range:</span> `;
    output += `<span style="color: var(--theme-green);">$${low.toFixed(2)}</span> `;
    output += `<span style="color: var(--theme-white);">${miniChart}</span> `;
    output += `<span style="color: var(--theme-red);">$${high.toFixed(2)}</span>\n\n`;

    output += `<span style="color: var(--theme-cyan);">Open:</span> <span style="color: var(--theme-white);">$${open.toFixed(2)}</span>\n`;
    output += `<span style="color: var(--theme-cyan);">Previous Close:</span> <span style="color: var(--theme-white);">$${previousClose.toFixed(2)}</span>\n`;
    output += `<span style="color: var(--theme-cyan);">Volume:</span> <span style="color: var(--theme-white);">${volume.toLocaleString()}</span>\n\n`;

    const trendFromOpen = price - open;
    const trendFromPrevious = change;

    output += `<span style="color: var(--theme-purple);">Trends:</span>\n`;
    output += `From Open: <span style="color: ${trendFromOpen >= 0 ? 'var(--theme-green)' : 'var(--theme-red)'};">$${trendFromOpen.toFixed(2)} (${open > 0 ? ((trendFromOpen/open)*100).toFixed(2) : '0.00'}%)</span>\n`;
    output += `From Previous: <span style="color: ${trendFromPrevious >= 0 ? 'var(--theme-green)' : 'var(--theme-red)'};">$${trendFromPrevious.toFixed(2)} (${changePercent.toFixed(2)}%)</span>\n`;
    output += `</div>\n`;

    // OHLC Chart section - stacked below on mobile
    output += `<div style="width: 100%; max-width: ${availableWidth}px; overflow-x: auto;">`;
    output += `<span style="color: var(--theme-purple); font-weight: bold;">OHLC Chart:</span>\n`;
    output += `<pre style="font-family: monospace; line-height: 1.2; margin: 0; white-space: pre; overflow-x: auto;">${ohlcChart}</pre>`;
    output += `</div>\n`;

  } else {
    // Desktop/wide screen layout - side by side
    output += `<div style="display: flex; gap: 15px; align-items: flex-start;">\n`;

    output += `<div style="flex: 0 0 380px;">`;
    output += `<span style="color: var(--theme-yellow);">Day Range:</span> `;
    output += `<span style="color: var(--theme-green);">$${low.toFixed(2)}</span> `;
    output += `<span style="color: var(--theme-white);">${miniChart}</span> `;
    output += `<span style="color: var(--theme-red);">$${high.toFixed(2)}</span>\n\n`;

    output += `<span style="color: var(--theme-cyan);">Open:</span> <span style="color: var(--theme-white);">$${open.toFixed(2)}</span>\n`;
    output += `<span style="color: var(--theme-cyan);">Previous Close:</span> <span style="color: var(--theme-white);">$${previousClose.toFixed(2)}</span>\n`;
    output += `<span style="color: var(--theme-cyan);">Volume:</span> <span style="color: var(--theme-white);">${volume.toLocaleString()}</span>\n\n`;

    const trendFromOpen = price - open;
    const trendFromPrevious = change;

    output += `<span style="color: var(--theme-purple);">Trends:</span>\n`;
    output += `From Open: <span style="color: ${trendFromOpen >= 0 ? 'var(--theme-green)' : 'var(--theme-red)'};">$${trendFromOpen.toFixed(2)} (${open > 0 ? ((trendFromOpen/open)*100).toFixed(2) : '0.00'}%)</span>\n`;
    output += `From Previous: <span style="color: ${trendFromPrevious >= 0 ? 'var(--theme-green)' : 'var(--theme-red)'};">$${trendFromPrevious.toFixed(2)} (${changePercent.toFixed(2)}%)</span>\n`;
    output += `</div>\n`;

    output += `<div style="flex: 1; padding-left: 10%;">`;
    output += `<span style="color: var(--theme-purple); font-weight: bold;">OHLC Chart:</span>\n`;
    output += `<pre style="font-family: monospace; line-height: 1.2; margin: 0;">${ohlcChart}</pre>`;
    output += `</div>\n`;
  }

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

    // On mobile, show only the current weather header (first section) plus location
    if (isMobileDevice()) {
      // Find the location line (contains coordinates in brackets)
      const locationLine = filteredLines.find(line =>
        line.includes('Location:') && line.includes('[') && line.includes(']')
      );

      let mobileResult = filteredLines.slice(0, 7).join('\n');
      if (locationLine) {
        mobileResult += '\n\n' + locationLine;
      }
      result = mobileResult + '\n\n';
    } else {
      result = filteredLines.join('\n');
    }

    // Apply theme colors to the weather output
    return result
      .replace(/(\d+°[CF]?)/g, `<span style="color: var(--theme-bright-red); font-weight: bold;">$1</span>`)
      .replace(/(\d+\s*(?:km\/h|mph|m\/s|kts))/g, `<span style="color: var(--theme-bright-blue); font-weight: bold;">$1</span>`)
      .replace(/(\d+%)/g, `<span style="color: var(--theme-cyan);">$1</span>`)
      .replace(/(\d+(?:\.\d+)?\s*mm)/g, `<span style="color: var(--theme-bright-cyan);">$1</span>`)
      .replace(/(\d+(?:\.\d+)?\s*km)/g, `<span style="color: var(--theme-green);">$1</span>`)
      .replace(/\b(sunny|clear|cloudy|overcast|rainy|snowy|foggy|misty|thunderstorm|drizzle|partly cloudy|mostly cloudy)\b/gi,
        `<span style="color: var(--theme-yellow); font-weight: bold;">$1</span>`)
      .replace(/\b([NSEW]{1,3})\b/g, `<span style="color: var(--theme-purple);">$1</span>`)
      .replace(/([☀☁⛅⛈🌧🌦🌩❄⛄🌫])/g, `<span style="color: var(--theme-bright-yellow);">$1</span>`)
      .replace(/^(.+)$/m, `<span style="color: var(--theme-bright-green); font-weight: bold;">$1</span>`);
  },

  // A direct fetch: the browser allows it only when the site sends CORS headers, and curl says so
  // when it does not. An owned proxy is planned (docs/plan/07-stock-and-proxy.md).
  curl: async (args: string[], signal?: AbortSignal) => {
    if (args.length === 0) {
      return commandHelp.curl;
    }

    let url = args[0];

    // Add protocol if missing
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }

    let host: string;
    try {
      host = new URL(url).host;
    } catch {
      playBeep();
      return errorLine('curl: (3) URL rejected: Malformed input to a URL function');
    }

    let data: string;
    try {
      // Like curl without -f, an HTTP error status still prints the body.
      data = await fetchText(url, { signal, timeoutMs: CURL_TIMEOUT_MS, throwHttpErrors: false });
    } catch (error) {
      if (wasCancelled(error, signal)) return cancelledNotice('curl');
      playBeep();
      return errorLine(curlFailure(error, host));
    }

    // Truncate if too long (more than 10000 characters)
    if (data.length > 10000) {
      data = data.substring(0, 10000) + '\n\n[Output truncated - content too long]';
    }

    // Use mobile-responsive styling
    const isMobileLayout = shouldUseStackedLayout(600);
    const maxWidth = isMobileLayout ? getAvailableWidth() : 'none';
    const currentTheme = get(theme);

    return `<pre style="color: ${currentTheme.foreground}; white-space: pre-wrap; word-wrap: break-word; word-break: break-word; max-width: ${maxWidth}px; overflow-wrap: break-word;">${escapeHtml(data)}</pre>`;
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
    return renderQuote(lookup.meta, ticker);
  },

  speedtest: async (args: string[], signal?: AbortSignal) => {
    const currentTheme = get(theme);

    const downUrl = 'https://speed.cloudflare.com/__down';
    const upUrl = 'https://speed.cloudflare.com/__up';

    // The deadline covers each request until its response arrives. A slow download body is not
    // cut off, so slow links still get a result; cancelling stops it. Time-bounded samples are Phase 4.
    const measureDownload = async (bytes: number) => {
      const url = `${downUrl}?bytes=${bytes}&ts=${Date.now()}`;
      const t0 = performance.now();
      const res = await fetchWithTimeout(url, { cache: 'no-store', signal, timeoutMs: SPEEDTEST_TIMEOUT_MS });
      const blob = await res.blob();
      const t1 = performance.now();
      const seconds = Math.max((t1 - t0) / 1000, 0.001);
      const mbps = (bytes * 8) / seconds / 1e6;
      return { seconds, mbps, bytes: blob.size || bytes };
    };

    const measureUploadBeacon = async (bytes: number) => {
      const chunkSize = 64 * 1024;
      let remaining = bytes;
      let sent = 0;
      const t0 = performance.now();
      while (remaining > 0) {
        const size = Math.min(remaining, chunkSize);
        const ab = new ArrayBuffer(size);
        new Uint8Array(ab).fill(0);
        const ok = navigator.sendBeacon(upUrl, ab);
        if (!ok) break;
        sent += size;
        remaining -= size;
        await new Promise((r) => setTimeout(r, 0));
      }
      const t1 = performance.now();
      const seconds = Math.max((t1 - t0) / 1000, 0.001);
      const mbps = (sent * 8) / seconds / 1e6;
      return { seconds, mbps, bytes: sent };
    };

    const measureUpload = async (bytes: number) => {
      const chunkSize = 64 * 1024;
      const chunks: Uint8Array[] = [];
      let remaining = bytes;

      while (remaining > 0) {
        const size = Math.min(remaining, chunkSize);
        const chunk = new Uint8Array(size);
        try {
          crypto.getRandomValues(chunk);
        } catch {}
        chunks.push(chunk);
        remaining -= size;
      }

      const parts: ArrayBuffer[] = chunks.map((c) => {
        const ab = new ArrayBuffer(c.byteLength);
        new Uint8Array(ab).set(c);
        return ab;
      });
      const payload = new Blob(parts, { type: 'application/octet-stream' });

      const t0 = performance.now();
      try {
        const fd = new FormData();
        fd.append('file', payload, 'upload.bin');
        await fetchWithTimeout(upUrl, {
          method: 'POST',
          body: fd,
          mode: 'no-cors',
          cache: 'no-store',
          signal,
          timeoutMs: SPEEDTEST_TIMEOUT_MS,
          referrerPolicy: 'no-referrer'
        });
      } catch (error) {
        if (wasCancelled(error, signal)) throw error;
        return measureUploadBeacon(bytes);
      }
      const t1 = performance.now();
      const seconds = Math.max((t1 - t0) / 1000, 0.001);
      const mbps = (bytes * 8) / seconds / 1e6;
      return { seconds, mbps, bytes };
    };

    const measureLatency = async (count: number) => {
      const samples: number[] = [];
      for (let i = 0; i < count; i++) {
        const url = `${downUrl}?bytes=1&ts=${Date.now()}&i=${i}`;
        const t0 = performance.now();
        await fetchWithTimeout(url, { cache: 'no-store', signal, timeoutMs: SPEEDTEST_TIMEOUT_MS });
        const t1 = performance.now();
        samples.push(t1 - t0);
      }
      const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
      const min = Math.min(...samples);
      const max = Math.max(...samples);
      return { avg, min, max };
    };

    try {
      const lines: string[] = [];

      lines.push(`<span style="color: ${currentTheme.cyan};">Cloudflare Speed Test</span>`);

      speedtestPhase.set('Measuring download...');
      const downloadSizes = [5 * 1024 * 1024, 10 * 1024 * 1024, 25 * 1024 * 1024];
      const downloadSamples: number[] = [];
      for (const size of downloadSizes) {
        const m = await measureDownload(size);
        downloadSamples.push(m.mbps);
      }
      const dAvg = downloadSamples.reduce((a, b) => a + b, 0) / downloadSamples.length;
      lines.push(`<span style="color: ${currentTheme.green};">Download:</span> ${dAvg.toFixed(1)} Mbps (avg of ${downloadSamples.length} samples)`);

      speedtestPhase.set('Measuring upload...');
      const uploadSizes = [64 * 1024, 256 * 1024, 1 * 1024 * 1024];
      const uploadSamples: number[] = [];
      let uploadErrors = 0;
      for (const size of uploadSizes) {
        try {
          const m = await measureUpload(size);
          uploadSamples.push(m.mbps);
        } catch (error) {
          if (wasCancelled(error, signal)) throw error;
          uploadErrors++;
          // continue collecting other samples
        }
      }
      if (uploadSamples.length > 0) {
        const uAvg = uploadSamples.reduce((a, b) => a + b, 0) / uploadSamples.length;
        const note = uploadErrors > 0 ? ` (some samples blocked)` : '';
        lines.push(`<span style="color: ${currentTheme.blue};">Upload:</span> ${uAvg.toFixed(1)} Mbps (avg of ${uploadSamples.length} samples)${note}`);
      } else {
        lines.push(`<span style="color: ${currentTheme.blue};">Upload:</span> unavailable due to browser/network restrictions`);
      }

      speedtestPhase.set('Measuring latency...');
      const lat = await measureLatency(10);
      lines.push(`<span style="color: ${currentTheme.red};">Ping:</span> avg ${lat.avg.toFixed(0)} ms, min ${lat.min.toFixed(0)} ms, max ${lat.max.toFixed(0)} ms`);

      speedtestPhase.set('');
      return `<div style="font-family: monospace; line-height: 1.4;">${lines.join('<br>')}</div>`;
    } catch (error) {
      speedtestPhase.set('');
      if (wasCancelled(error, signal)) return cancelledNotice('speedtest');
      playBeep();
      return errorLine(speedtestFailure(error));
    }
  }
}
