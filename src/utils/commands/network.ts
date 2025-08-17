import { theme } from '../../stores/theme';
import { get } from 'svelte/store';
import { history } from '../../stores/history';
import { commandHelp } from '../helpTexts';
import { playBeep } from '../beep';

export const networkCommands = {
  weather: async (args: string[]) => {
    const city = args.join('+');

    if (!city) {
      return commandHelp.weather;
    }

    const currentTheme = get(theme);

    // Return a Promise that resolves only when the operation is complete
    return new Promise<string>((resolve, reject) => {
      // Perform the actual API call without any history manipulation
      (async () => {
        try {
          const weather = await fetch(`https://wttr.in/${city}?ATm`);
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
          result = filteredLines.join('\n');
          
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
          playBeep();
          const errorMessage = `<span style="color: var(--theme-red);">Error fetching weather data for ${city.replace(/\+/g, ' ')}: ${error}</span>`;
          resolve(errorMessage);
        }
      })();
    });
  },
  
  curl: async (args: string[]) => {
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
      const response = await fetch(proxyUrl);
      
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
            
            const output = `<pre style="color: ${currentTheme.foreground}; white-space: pre-wrap; word-wrap: break-word;">${data}</pre>`;
            resolve(output);
            return;
            
          } catch (error) {
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
  
  stock: async (args: string[]) => {
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
          const response = await fetch(proxyUrl);
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
          
          // Create OHLC ASCII chart
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
          let output = `<span style="color: var(--theme-bright-cyan); font-weight: bold; font-size: 1em;">${symbol}</span>`;
          if (companyName && companyName !== symbol) {
            output += ` <span style="color: var(--theme-white); font-size: 1em;">- ${companyName}</span>`;
          }
          output += `\n`;
          output += `<span style="color: var(--theme-white); font-size: 1.1em;">$${price.toFixed(2)}</span> `;
          output += `<span style="color: ${changeColor}; font-weight: bold;">${arrow} ${change >= 0 ? '+' : ''}${change.toFixed(2)} (${changePercent.toFixed(2)}%)</span>\n\n`;
          
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
          
          output += `</div>\n`;
          
          resolve(output);
          
        } catch (error) {
          playBeep();
          const errorMessage = `<span style="color: var(--theme-red);">Error fetching stock data for ${ticker}: ${error}</span>`;
          resolve(errorMessage);
        }
      })();
    });
  }
};