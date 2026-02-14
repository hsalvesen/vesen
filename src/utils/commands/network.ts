import { theme } from '../../stores/theme';
import { get } from 'svelte/store';
import { history } from '../../stores/history';
import { commandHelp } from '../helpTexts';
import { playBeep } from '../beep';
import { shouldUseStackedLayout, getAvailableWidth, isMobileDevice } from '../mobile';

export const networkCommands = {
  weather: async (args: string[], abortController?: AbortController) => {
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

    const currentTheme = get(theme);

    // Return a Promise that resolves only when the operation is complete
    return new Promise<string>((resolve, reject) => {
      // Perform the actual API call without any history manipulation
      (async () => {
        try {
          const weather = await fetch(`https://wttr.in/${city}?ATm`, {
            signal: abortController?.signal
          });
          let result = await weather.text();

          // Check if the response indicates an unknown location
          if (result.includes('404 UNKNOWN LOCATION') || result.includes('ERROR') || result.includes('Unknown location')) {
            playBeep();
            const errorMessage = `<span style="color: var(--theme-red); font-weight: bold;">Weather data not available for "${city.replace(/\+/g, ' ')}"</span>\n<span style="color: var(--theme-yellow);">Please check the city name and try again.</span>\n<span style="color: var(--theme-cyan);">Example: weather Oslo</span>`;

            resolve(errorMessage);
            return;
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
          result = result
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
          
          resolve(result);
          
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') {
            resolve(`<div style="position: relative; border-left: 4px solid var(--theme-yellow); padding: 8px 10px; border-radius: 4px; margin: 6px 0; margin-bottom: 20px;"><div style="position: absolute; inset: 0; background: var(--theme-yellow); opacity: 0.08; border-radius: 4px;"></div><div style="position: relative;"><span style="color: var(--theme-white);">Weather request cancelled</span></div></div>`);
            return;
          }
          playBeep();
          const errorMessage = `<span style="color: var(--theme-red);">Error fetching weather data for ${city.replace(/\+/g, ' ')}: ${error}</span>`;
          resolve(errorMessage);
        }
      })();
    });
  },
  
  curl: async (args: string[], abortController?: AbortController) => {
    if (args.length === 0) {
      return commandHelp.curl;
    }
  
    let url = args[0];
  
    // Add protocol if missing
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }
  
    const currentTheme = get(theme);
  
    // Helper function to escape HTML
    const escapeHtml = (text: string): string => {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    };

    // List of CORS proxy services to try in order
    const proxies = [
      `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
      `https://corsproxy.io/?${encodeURIComponent(url)}`,
      `https://cors-anywhere.herokuapp.com/${url}`,
      `https://thingproxy.freeboard.io/fetch/${url}`
    ];

    // Helper function to try a single proxy
    const tryProxy = async (proxyUrl: string, isThingProxy: boolean = false): Promise<string> => {
      const response = await fetch(proxyUrl, {
        signal: abortController?.signal
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      let data: string;
      
      if (isThingProxy) {
        // ThingProxy returns raw content
        data = await response.text();
      } else if (proxyUrl.includes('corsproxy.io')) {
        // CorsProxy.io returns raw content
        data = await response.text();
      } else {
        // AllOrigins returns JSON with contents field
        const result = await response.json();
        
        if (result.status && result.status.http_code !== 200) {
          throw new Error(`HTTP ${result.status.http_code} - ${result.status.error || 'Request failed'}`);
        }
        
        data = result.contents || '';
      }
      
      return data;
    };
  
    // Return a Promise that resolves only when the operation is complete
    return new Promise<string>((resolve, reject) => {
      // Perform the actual API call without any history manipulation
      (async () => {
        let lastError: any = null;
        
        // Try each proxy in sequence
        for (let i = 0; i < proxies.length; i++) {
          try {
            const proxyUrl = proxies[i];
            const isThingProxy = proxyUrl.includes('thingproxy.freeboard.io');
            
            let data = await tryProxy(proxyUrl, isThingProxy);
            
            // Truncate if too long (more than 10000 characters)
            if (data.length > 10000) {
              data = data.substring(0, 10000) + '\n\n[Output truncated - content too long]';
            }
            
            // Escape HTML to prevent XSS
            data = escapeHtml(data);
            
            // Use mobile-responsive styling
            const isMobileLayout = shouldUseStackedLayout(600);
            const maxWidth = isMobileLayout ? getAvailableWidth() : 'none';
            
            const output = `<pre style="color: ${currentTheme.foreground}; white-space: pre-wrap; word-wrap: break-word; word-break: break-word; max-width: ${maxWidth}px; overflow-wrap: break-word;">${data}</pre>`;
            resolve(output);
            return;
            
          } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') {
              resolve(`<div style="position: relative; border-left: 4px solid var(--theme-yellow); padding: 8px 10px; border-radius: 4px; margin: 6px 0; margin-bottom: 20px;"><div style="position: absolute; inset: 0; background: var(--theme-yellow); opacity: 0.08; border-radius: 4px;"></div><div style="position: relative;"><span style="color: var(--theme-white);">Request cancelled</span></div></div>`);
              return;
            }
            lastError = error;
            // Continue to next proxy if this one fails
            continue;
          }
        }
        
        // All proxies failed
        playBeep();
        const errorOutput = `<span style="color: ${currentTheme.red};">curl: All proxy services failed. Last error: ${lastError}</span><br><span style="color: ${currentTheme.yellow};">Try again later or check if the URL is accessible.</span>`;
        resolve(errorOutput);
      })();
    });
  },
  
  stock: async (args: string[], abortController?: AbortController) => {
    if (args.length === 0) {
      return commandHelp.stock;
    }

    const ticker = args[0].toUpperCase();
    const currentTheme = get(theme);

    // Return a Promise that resolves only when the operation is complete
    return new Promise<string>((resolve, reject) => {
      // Perform the actual API call without any history manipulation
      (async () => {
        try {
          // Using Yahoo Finance API via proxy
          const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}`)}`;
          const response = await fetch(proxyUrl, {
            signal: abortController?.signal
          });
          const data = await response.json();
          
          // Parse Yahoo Finance response
          const yahooData = JSON.parse(data.contents);
          
          if (yahooData.chart.error || !yahooData.chart.result || yahooData.chart.result.length === 0) {
            playBeep();
            const errorMessage = `<span style="color: var(--theme-red); font-weight: bold;">No data found for ticker: ${ticker}</span>\n<span style="color: var(--theme-yellow);">Please verify the ticker symbol is correct.</span>`;
            resolve(errorMessage);
            return;
          }
          
          const yahooResult = yahooData.chart.result[0];
          const meta = yahooResult.meta;
          const quote = yahooResult.indicators.quote[0];
          
          // Extract stock data with proper null checks
          const symbol = meta.symbol;
          const companyName = meta.longName || meta.shortName || symbol;
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
            const errorMessage = `<span style="color: var(--theme-red); font-weight: bold;">Invalid data received for ticker: ${ticker}</span>\n<span style="color: var(--theme-yellow);">Please try again later.</span>`;
            resolve(errorMessage);
            return;
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
          
          resolve(output);
          
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') {
            resolve(`<div style="position: relative; border-left: 4px solid var(--theme-yellow); padding: 8px 10px; border-radius: 4px; margin: 6px 0; margin-bottom: 20px;"><div style="position: absolute; inset: 0; background: var(--theme-yellow); opacity: 0.08; border-radius: 4px;"></div><div style="position: relative;"><span style="color: var(--theme-white);">Stock request cancelled</span></div></div>`);
            return;
          }
          playBeep();
          const errorMessage = `<span style="color: var(--theme-red);">Error fetching stock data for ${ticker}: ${error}</span>`;
          resolve(errorMessage);
        }
      })();
    });
  },
  speedtest: async (args: string[], abortController?: AbortController) => {
    const currentTheme = get(theme);
    const { speedtestPhase } = await import('../../stores/history');

    const escapeHtml = (text: string): string => {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    };

    const downUrl = 'https://speed.cloudflare.com/__down';
    const upUrl = 'https://speed.cloudflare.com/__up';

    const measureDownload = async (bytes: number) => {
      const url = `${downUrl}?bytes=${bytes}&ts=${Date.now()}`;
      const t0 = performance.now();
      const res = await fetch(url, { cache: 'no-store', signal: abortController?.signal });
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
        await fetch(upUrl, {
          method: 'POST',
          body: fd,
          mode: 'no-cors',
          cache: 'no-store',
          signal: abortController?.signal,
          referrerPolicy: 'no-referrer'
        });
      } catch {
        const beaconResult = await measureUploadBeacon(bytes);
        return beaconResult;
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
        await fetch(url, { cache: 'no-store', signal: abortController?.signal });
        const t1 = performance.now();
        samples.push(t1 - t0);
      }
      const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
      const min = Math.min(...samples);
      const max = Math.max(...samples);
      return { avg, min, max };
    };

    return new Promise<string>((resolve) => {
      (async () => {
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
            } catch {
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

          const isMobile = window.innerWidth < 768;
          const content = isMobile ? lines.join('<br>') : lines.join('<br>');

          speedtestPhase.set('');
          resolve(`<div style="font-family: monospace; line-height: 1.4;">${content}</div>`);
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') {
            speedtestPhase.set('');
            resolve(`<div style="position: relative; border-left: 4px solid var(--theme-yellow); padding: 8px 10px; border-radius: 4px; margin: 6px 0; margin-bottom: 20px;"><div style="position: absolute; inset: 0; background: var(--theme-yellow); opacity: 0.08; border-radius: 4px;"></div><div style="position: relative;"><span style="color: var(--theme-white);">Speed test cancelled</span></div></div>`);
            return;
          }
          playBeep();
          speedtestPhase.set('');
          resolve(`<span style="color: ${currentTheme.red};">Speed test failed: ${escapeHtml(String(error))}</span>`);
        }
      })();
    });
  }
}
