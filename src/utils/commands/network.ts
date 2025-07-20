import { theme } from '../../stores/theme';
import { get } from 'svelte/store';
import { history } from '../../stores/history';
import { commandHelp } from '../helpTexts';

export const networkCommands = {
  weather: async (args: string[]) => {
    const city = args.join('+');

    if (!city) {
      return commandHelp.weather;
    }

    const currentTheme = get(theme);

    // Create loading animation
    const loadingFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    let frameIndex = 0;
    
    // Return the loading message immediately
    const loadingMessage = `<span style="color: var(--theme-cyan);">Fetching weather data for ${city.replace(/\+/g, ' ')}... ${loadingFrames[0]}</span>`;
    
    // Use setTimeout to update the loading animation and fetch weather
    setTimeout(async () => {
      // Get current history to find the last entry (our loading message)
      const currentHistory = get(history);
      const lastEntryIndex = currentHistory.length - 1;
      
      if (lastEntryIndex >= 0) {
        // Animate the loading spinner by updating the history store
        const interval = setInterval(() => {
          frameIndex = (frameIndex + 1) % loadingFrames.length;
          const updatedLoadingMessage = `<span style="color: var(--theme-cyan);">Fetching weather data for ${city.replace(/\+/g, ' ')}... ${loadingFrames[frameIndex]}</span>`;
          
          // Update the history store - this will trigger the scroll effect
          history.update(hist => {
            const newHist = [...hist];
            if (newHist[lastEntryIndex] && newHist[lastEntryIndex].outputs.length > 0) {
              newHist[lastEntryIndex].outputs[newHist[lastEntryIndex].outputs.length - 1] = updatedLoadingMessage;
            }
            return newHist;
          });
        }, 100);
        
        try {
          const weather = await fetch(`https://wttr.in/${city}?ATm`);
          let result = await weather.text();
          
          // Clear the loading animation
          clearInterval(interval);
          
          // Check if the response indicates an unknown location
          if (result.includes('404 UNKNOWN LOCATION') || result.includes('ERROR') || result.includes('Unknown location')) {
            const errorMessage = `<span style="color: var(--theme-red); font-weight: bold;">Weather data not available for "${city.replace(/\+/g, ' ')}"</span>\n<span style="color: var(--theme-yellow);">Please check the city name and try again.</span>\n<span style="color: var(--theme-cyan);">Example: weather Oslo</span>`;
            
            // Update history store with error message
            history.update(hist => {
              const newHist = [...hist];
              if (newHist[lastEntryIndex] && newHist[lastEntryIndex].outputs.length > 0) {
                newHist[lastEntryIndex].outputs[newHist[lastEntryIndex].outputs.length - 1] = errorMessage;
              }
              return newHist;
            });
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
          
          // Update the history store with final weather result
          history.update(hist => {
            const newHist = [...hist];
            if (newHist[lastEntryIndex] && newHist[lastEntryIndex].outputs.length > 0) {
              newHist[lastEntryIndex].outputs[newHist[lastEntryIndex].outputs.length - 1] = result;
            }
            return newHist;
          });
          
        } catch (error) {
          // Clear the loading animation on error
          clearInterval(interval);
          const errorMessage = `<span style="color: var(--theme-red);">Error fetching weather data for ${city.replace(/\+/g, ' ')}: ${error}</span>`;
          
          // Update history store with error message
          history.update(hist => {
            const newHist = [...hist];
            if (newHist[lastEntryIndex] && newHist[lastEntryIndex].outputs.length > 0) {
              newHist[lastEntryIndex].outputs[newHist[lastEntryIndex].outputs.length - 1] = errorMessage;
            }
            return newHist;
          });
        }
      }
    }, 100);

    // Return the initial loading message
    return loadingMessage;
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
  
    // Create loading animation
    const loadingFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    let frameIndex = 0;
    
    // Return the loading message immediately
    const loadingMessage = `<span style="color: ${currentTheme.cyan};">Fetching ${url}... ${loadingFrames[0]}</span>`;
    
    // Helper function to escape HTML
    const escapeHtml = (text: string): string => {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    };
    
    // Use setTimeout to update the loading animation and fetch data
    setTimeout(async () => {
      // Get current history to update the last entry
      const currentHistory = get(history);
      const lastEntry = currentHistory[currentHistory.length - 1];
      
      if (lastEntry) {
        // Declare interval variable with correct browser type
        let interval: number;
        
        // Animate the loading spinner by updating history
        interval = setInterval(() => {
          frameIndex = (frameIndex + 1) % loadingFrames.length;
          const updatedHistory = [...currentHistory];
          updatedHistory[updatedHistory.length - 1] = {
            ...lastEntry,
            outputs: [`<span style="color: ${currentTheme.cyan};">Fetching ${url}... ${loadingFrames[frameIndex]}</span>`]
          };
          history.set(updatedHistory);
        }, 100);
        
        try {
          // Use a CORS proxy for better compatibility
          const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
          const response = await fetch(proxyUrl);
          
          // Clear the loading animation
          clearInterval(interval);
          
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }
          
          const result = await response.json();
          
          if (result.status && result.status.http_code !== 200) {
            const errorOutput = `<span style="color: ${currentTheme.red};">curl: HTTP ${result.status.http_code} - ${result.status.error || 'Request failed'}</span>`;
            const updatedHistory = [...get(history)];
            updatedHistory[updatedHistory.length - 1] = {
              ...lastEntry,
              outputs: [errorOutput]
            };
            history.set(updatedHistory);
            return;
          }
          
          const data = result.contents;
          
          // Escape HTML to prevent it from breaking the terminal formatting
          const escapedData = escapeHtml(data);
          
          // Limit output length to prevent overwhelming the terminal
          let finalOutput;
          if (escapedData.length > 5000) {
            finalOutput = escapedData.substring(0, 5000) + `\n\n<span style="color: ${currentTheme.yellow};">... (output truncated, showing first 5000 characters)</span>`;
          } else {
            finalOutput = escapedData || `<span style="color: ${currentTheme.yellow};">curl: Empty response from ${url}</span>`;
          }
          
          // Update the history with the final result
          const updatedHistory = [...get(history)];
          updatedHistory[updatedHistory.length - 1] = {
            ...lastEntry,
            outputs: [`<pre style="white-space: pre-wrap; word-wrap: break-word;">${finalOutput}</pre>`]
          };
          history.set(updatedHistory);
          
        } catch (error: unknown) {
          // Clear the loading animation on error
          clearInterval(interval);
          const errorMessage = error instanceof Error ? error.message : String(error);
          const errorOutput = `<span style="color: ${currentTheme.red};">curl: Failed to fetch ${url}\nError: ${errorMessage}</span>`;
          
          const updatedHistory = [...get(history)];
          updatedHistory[updatedHistory.length - 1] = {
            ...lastEntry,
            outputs: [errorOutput]
          };
          history.set(updatedHistory);
        }
      }
    }, 100);
  
    // Return the initial loading message
    return loadingMessage;
  },
  
  stock: async (args: string[]) => {
    if (args.length === 0) {
      return commandHelp.stock;
    }

    const ticker = args[0].toUpperCase();
    const currentTheme = get(theme);

    // Create loading animation
    const loadingFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    let frameIndex = 0;
    
    // Return the loading message immediately
    const loadingMessage = `<span style="color: var(--theme-cyan);">Fetching stock data for ${ticker}... ${loadingFrames[0]}</span>`;
    
    // Use setTimeout to update the loading animation and fetch stock data
    setTimeout(async () => {
      // Find the current output element
      const historyElements = document.querySelectorAll('.whitespace-pre');
      const currentElement = historyElements[historyElements.length - 1];
      
      if (currentElement) {
        // Animate the loading spinner
        const interval = setInterval(() => {
          frameIndex = (frameIndex + 1) % loadingFrames.length;
          currentElement.innerHTML = `<span style="color: var(--theme-cyan);">Fetching stock data for ${ticker}... ${loadingFrames[frameIndex]}</span>`;
          
          // Trigger scroll after each loading frame update - FIXED
          setTimeout(() => {
            const mainContainer = document.querySelector('main');
            if (mainContainer) {
              mainContainer.scrollTo({
                top: mainContainer.scrollHeight,
                behavior: 'smooth'
              });
            }
          }, 10);
        }, 100);
        
        try {
          // Using Yahoo Finance API via proxy
          const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}`)}`;
          const response = await fetch(proxyUrl);
          const data = await response.json();
          
          // Clear the loading animation
          clearInterval(interval);
          
          // Parse Yahoo Finance response
          const yahooData = JSON.parse(data.contents);
          
          if (yahooData.chart.error || !yahooData.chart.result || yahooData.chart.result.length === 0) {
            currentElement.innerHTML = `<span style="color: var(--theme-red); font-weight: bold;">No data found for ticker: ${ticker}</span>\n<span style="color: var(--theme-yellow);">Please verify the ticker symbol is correct.</span>`;
            return;
          }
          
          const yahooResult = yahooData.chart.result[0];
          const meta = yahooResult.meta;
          const quote = yahooResult.indicators.quote[0];
          
          // Extract stock data with proper null checks
          const symbol = meta.symbol;
          const companyName = meta.longName || meta.shortName || symbol; // Get company name
          const price = meta.regularMarketPrice || 0;
          const previousClose = meta.previousClose || 0;
          const change = price - previousClose;
          const changePercent = previousClose > 0 ? ((change / previousClose) * 100) : 0;
          const volume = meta.regularMarketVolume || 0;
          const high = meta.regularMarketDayHigh || price;
          const low = meta.regularMarketDayLow || price;
          const open = meta.regularMarketOpen || price;
          
          // Ensure we have valid numbers (fix NaN issue)
          if (isNaN(price) || isNaN(low) || isNaN(high)) {
            currentElement.innerHTML = `<span style="color: var(--theme-red); font-weight: bold;">Invalid data received for ticker: ${ticker}</span>\n<span style="color: var(--theme-yellow);">Please try again later.</span>`;
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
            
            // Helper function to format price labels with consistent width
            const formatPriceLabel = (label: string, price: number): string => {
              const priceStr = price.toFixed(2);
              return `${label}─${priceStr.padStart(8, ' ')}`; // Fixed width of 8 characters for price
            };
            
            // Normalize values to 0-20 scale for chart height
            const chartHeight = 8;
            const normalize = (value: number) => Math.round(((value - low) / range) * chartHeight);
            
            const openPos = normalize(open);
            const closePos = normalize(close);
            const highPos = normalize(high);
            const lowPos = normalize(low);
            
            let chart = '';
            
            // Build chart from top to bottom
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
                // Show vertical line for the trading range
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
          
          // Format the output with side-by-side layout
          let output = `<span style="color: var(--theme-bright-cyan); font-weight: bold; font-size: 1em;">${symbol}</span>`;
          if (companyName && companyName !== symbol) {
            output += ` <span style="color: var(--theme-white); font-size: 1em;">- ${companyName}</span>`;
          }
          output += `\n`;
          output += `<span style="color: var(--theme-white); font-size: 1.1em;">$${price.toFixed(2)}</span> `;
          output += `<span style="color: ${changeColor}; font-weight: bold;">${arrow} ${change >= 0 ? '+' : ''}${change.toFixed(2)} (${changePercent.toFixed(2)}%)</span>\n\n`;
          
          // Create a side-by-side layout using CSS flexbox
          output += `<div style="display: flex; gap: 15px; align-items: flex-start;">\n`;
          
          // Left column: Price details and trends
          output += `<div style="flex: 0 0 380px;">`;
          output += `<span style="color: var(--theme-yellow);">Day Range:</span> `;
          output += `<span style="color: var(--theme-green);">$${low.toFixed(2)}</span> `;
          output += `<span style="color: var(--theme-white);">${miniChart}</span> `;
          output += `<span style="color: var(--theme-red);">$${high.toFixed(2)}</span>\n\n`;
          
          output += `<span style="color: var(--theme-cyan);">Open:</span> <span style="color: var(--theme-white);">$${open.toFixed(2)}</span>\n`;
          output += `<span style="color: var(--theme-cyan);">Previous Close:</span> <span style="color: var(--theme-white);">$${previousClose.toFixed(2)}</span>\n`;
          output += `<span style="color: var(--theme-cyan);">Volume:</span> <span style="color: var(--theme-white);">${volume.toLocaleString()}</span>\n\n`;
          
          // Trend indicators
          const trendFromOpen = price - open;
          const trendFromPrevious = change;
          
          output += `<span style="color: var(--theme-purple);">Trends:</span>\n`;
          output += `From Open: <span style="color: ${trendFromOpen >= 0 ? 'var(--theme-green)' : 'var(--theme-red)'};">$${trendFromOpen.toFixed(2)} (${open > 0 ? ((trendFromOpen/open)*100).toFixed(2) : '0.00'}%)</span>\n`;
          output += `From Previous: <span style="color: ${trendFromPrevious >= 0 ? 'var(--theme-green)' : 'var(--theme-red)'};">$${trendFromPrevious.toFixed(2)} (${changePercent.toFixed(2)}%)</span>\n`;
          output += `</div>\n`;
          
          // Right column: OHLC Chart
          output += `<div style="flex: 1; padding-left: 10%;">`;
          output += `<span style="color: var(--theme-purple); font-weight: bold;">OHLC Chart:</span>\n`;
          output += `<pre style="font-family: monospace; line-height: 1.2; margin: 0;">${ohlcChart}</pre>`;
          output += `</div>\n`;
          
          output += `</div>\n`;
          
          // Update the element with the final result
          currentElement.innerHTML = output;
          
          // Force scroll to bottom after content update - FIXED
          setTimeout(() => {
            const mainContainer = document.querySelector('main');
            if (mainContainer) {
              mainContainer.scrollTo({
                top: mainContainer.scrollHeight,
                behavior: 'smooth'
              });
            }
          }, 50);
          
        } catch (error) {
          // Clear the loading animation on error
          clearInterval(interval);
          currentElement.innerHTML = `<span style="color: var(--theme-red);">Error fetching stock data for ${ticker}: ${error}</span>`;
          
          // Force scroll to bottom after error update - FIXED
          setTimeout(() => {
            const mainContainer = document.querySelector('main');
            if (mainContainer) {
              mainContainer.scrollTo({
                top: mainContainer.scrollHeight,
                behavior: 'smooth'
              });
            }
          }, 50);
        }
      }
    }, 100);

    // Return the initial loading message
    return loadingMessage;
  }
};