import { theme } from '../../stores/theme';
import { get } from 'svelte/store';

export const networkCommands = {
  weather: async (args: string[]) => {
    const city = args.join('+');

    if (!city) {
      return `<span style="color: var(--theme-cyan); font-weight: bold;">weather</span> - Get weather information
<span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span> weather <span style="color: var(--theme-green);">[location]</span>
Displays current weather information for the specified location.
<span style="color: var(--theme-red); font-weight: bold;">Examples:</span>
  weather Gadigal
  weather Oslo
  weather Aotearoa`;
    }

    const currentTheme = get(theme);

    // Create loading animation
    const loadingFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    let frameIndex = 0;
    
    // Return the loading message immediately
    const loadingMessage = `<span style="color: var(--theme-cyan);">Fetching weather data for ${city.replace(/\+/g, ' ')}... ${loadingFrames[0]}</span>`;
    
    // Use setTimeout to update the loading animation and fetch weather
    setTimeout(async () => {
      // Find the current output element (the one that just displayed the loading message)
      const historyElements = document.querySelectorAll('.whitespace-pre');
      const currentElement = historyElements[historyElements.length - 1];
      
      if (currentElement) {
        // Animate the loading spinner
        const interval = setInterval(() => {
          frameIndex = (frameIndex + 1) % loadingFrames.length;
          currentElement.innerHTML = `<span style="color: var(--theme-cyan);">Fetching weather data for ${city.replace(/\+/g, ' ')}... ${loadingFrames[frameIndex]}</span>`;
          
          // Trigger scroll after each loading frame update
          const input = document.getElementById('command-input');
          if (input) {
            input.scrollIntoView({ behavior: 'smooth', block: 'end' });
          }
        }, 100);
        
        try {
          const weather = await fetch(`https://wttr.in/${city}?ATm`);
          let result = await weather.text();
          
          // Clear the loading animation
          clearInterval(interval);
          
          // Check if the response indicates an unknown location
          if (result.includes('404 UNKNOWN LOCATION') || result.includes('ERROR') || result.includes('Unknown location')) {
            currentElement.innerHTML = `<span style="color: var(--theme-red); font-weight: bold;">Weather data not available for "${city.replace(/\+/g, ' ')}"</span>\n<span style="color: var(--theme-yellow);">Please check the city name and try again.</span>\n<span style="color: var(--theme-cyan);">Example: weather Oslo</span>`;
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
            // Color temperature values (numbers followed by °)
            .replace(/(\d+°[CF]?)/g, `<span style="color: var(--theme-bright-red); font-weight: bold;">$1</span>`)
            // Color wind speed values (numbers followed by km/h, mph, etc.)
            .replace(/(\d+\s*(?:km\/h|mph|m\/s|kts))/g, `<span style="color: var(--theme-bright-blue); font-weight: bold;">$1</span>`)
            // Color humidity and pressure values (numbers followed by %)
            .replace(/(\d+%)/g, `<span style="color: var(--theme-cyan);">$1</span>`)
            // Color precipitation values (numbers followed by mm)
            .replace(/(\d+(?:\.\d+)?\s*mm)/g, `<span style="color: var(--theme-bright-cyan);">$1</span>`)
            // Color visibility values
            .replace(/(\d+(?:\.\d+)?\s*km)/g, `<span style="color: var(--theme-green);">$1</span>`)
            // Color weather condition words (sunny, cloudy, etc.)
            .replace(/\b(sunny|clear|cloudy|overcast|rainy|snowy|foggy|misty|thunderstorm|drizzle|partly cloudy|mostly cloudy)\b/gi, 
              `<span style="color: var(--theme-yellow); font-weight: bold;">$1</span>`)
            // Color direction indicators (N, S, E, W, NE, etc.)
            .replace(/\b([NSEW]{1,3})\b/g, `<span style="color: var(--theme-purple);">$1</span>`)
            // Color the ASCII art weather symbols with bright colors
            .replace(/([☀☁⛅⛈🌧🌦🌩❄⛄🌫])/g, `<span style="color: var(--theme-bright-yellow);">$1</span>`)
            // Color location names (first line typically contains the location)
            .replace(/^(.+)$/m, `<span style="color: var(--theme-bright-green); font-weight: bold;">$1</span>`);
          
          // Update the element with the final weather result
          currentElement.innerHTML = result;
          
          // Force scroll to bottom after content update
          setTimeout(() => {
            const input = document.getElementById('command-input');
            if (input) {
              input.scrollIntoView({ behavior: 'smooth', block: 'end' });
            }
          }, 50);
          
        } catch (error) {
          // Clear the loading animation on error
          clearInterval(interval);
          currentElement.innerHTML = `<span style="color: var(--theme-red);">Error fetching weather data for ${city.replace(/\+/g, ' ')}: ${error}</span>`;
          
          // Force scroll to bottom after error update
          setTimeout(() => {
            const input = document.getElementById('command-input');
            if (input) {
              input.scrollIntoView({ behavior: 'smooth', block: 'end' });
            }
          }, 50);
        }
      }
    }, 100);

    // Return the initial loading message
    return loadingMessage;
  },
  
  curl: async (args: string[]) => {
    if (args.length === 0) {
      return `<span style="color: var(--theme-cyan); font-weight: bold;">curl</span> - Make HTTP requests
<span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span> curl <span style="color: var(--theme-green);">[URL]</span>
Makes an HTTP request to the specified URL and displays the response.

<span style="color: var(--theme-red); font-weight: bold;">Examples:</span>
  curl https://httpbin.org/get
  curl https://api.github.com/users/octocat
  curl https://jsonplaceholder.typicode.com/posts/1`;
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
      // Find the current output element
      const historyElements = document.querySelectorAll('.whitespace-pre');
      const currentElement = historyElements[historyElements.length - 1];
      
      if (currentElement) {
        // Declare interval variable with correct browser type
        let interval: number;
        
        // Animate the loading spinner
        interval = setInterval(() => {
          frameIndex = (frameIndex + 1) % loadingFrames.length;
          currentElement.innerHTML = `<span style="color: ${currentTheme.cyan};">Fetching ${url}... ${loadingFrames[frameIndex]}</span>`;
          
          // Trigger scroll after each loading frame update
          const input = document.getElementById('command-input');
          if (input) {
            input.scrollIntoView({ behavior: 'smooth', block: 'end' });
          }
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
            currentElement.innerHTML = `<span style="color: ${currentTheme.red};">curl: HTTP ${result.status.http_code} - ${result.status.error || 'Request failed'}</span>`;
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
          
          // Update the element with the final result
          currentElement.innerHTML = `<pre style="white-space: pre-wrap; word-wrap: break-word;">${finalOutput}</pre>`;
          
          // Force scroll to bottom after content update
          setTimeout(() => {
            const input = document.getElementById('command-input');
            if (input) {
              input.scrollIntoView({ behavior: 'smooth', block: 'end' });
            }
          }, 50);
          
        } catch (error: unknown) {
          // Clear the loading animation on error
          clearInterval(interval);
          const errorMessage = error instanceof Error ? error.message : String(error);
          currentElement.innerHTML = `<span style="color: ${currentTheme.red};">curl: Failed to fetch ${url}\nError: ${errorMessage}</span>`;
          
          // Force scroll to bottom after error update
          setTimeout(() => {
            const input = document.getElementById('command-input');
            if (input) {
              input.scrollIntoView({ behavior: 'smooth', block: 'end' });
            }
          }, 50);
        }
      }
    }, 100);
  
    // Return the initial loading message
    return loadingMessage;
  }
};