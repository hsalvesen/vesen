import { theme } from '../../stores/theme';
import { get } from 'svelte/store';

export const networkCommands = {
  weather: async (args: string[]) => {
    const city = args.join('+');

    if (!city) {
      return 'Usage: weather [city]. Example: weather Brussels';
    }

    const currentTheme = get(theme);

    // Create loading animation
    const loadingFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    let frameIndex = 0;
    
    // Return the loading message immediately
    const loadingMessage = `<span style="color: ${currentTheme.cyan};">Fetching weather data for ${city.replace(/\+/g, ' ')}... ${loadingFrames[0]}</span>`;
    
    // Use setTimeout to update the loading animation and fetch weather
    setTimeout(async () => {
      // Find the current output element (the one that just displayed the loading message)
      const historyElements = document.querySelectorAll('.whitespace-pre');
      const currentElement = historyElements[historyElements.length - 1];
      
      if (currentElement) {
        // Animate the loading spinner
        const interval = setInterval(() => {
          frameIndex = (frameIndex + 1) % loadingFrames.length;
          currentElement.innerHTML = `<span style="color: ${currentTheme.cyan};">Fetching weather data for ${city.replace(/\+/g, ' ')}... ${loadingFrames[frameIndex]}</span>`;
          
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
            .replace(/(\d+°[CF]?)/g, `<span style="color: ${currentTheme.brightRed}; font-weight: bold;">$1</span>`)
            // Color wind speed values (numbers followed by km/h, mph, etc.)
            .replace(/(\d+\s*(?:km\/h|mph|m\/s|kts))/g, `<span style="color: ${currentTheme.brightBlue}; font-weight: bold;">$1</span>`)
            // Color humidity and pressure values (numbers followed by %)
            .replace(/(\d+%)/g, `<span style="color: ${currentTheme.cyan};">$1</span>`)
            // Color precipitation values (numbers followed by mm)
            .replace(/(\d+(?:\.\d+)?\s*mm)/g, `<span style="color: ${currentTheme.brightCyan};">$1</span>`)
            // Color visibility values
            .replace(/(\d+(?:\.\d+)?\s*km)/g, `<span style="color: ${currentTheme.green};">$1</span>`)
            // Color weather condition words (sunny, cloudy, etc.)
            .replace(/\b(sunny|clear|cloudy|overcast|rainy|snowy|foggy|misty|thunderstorm|drizzle|partly cloudy|mostly cloudy)\b/gi, 
              `<span style="color: ${currentTheme.yellow}; font-weight: bold;">$1</span>`)
            // Color direction indicators (N, S, E, W, NE, etc.)
            .replace(/\b([NSEW]{1,3})\b/g, `<span style="color: ${currentTheme.purple};">$1</span>`)
            // Color the ASCII art weather symbols with bright colors
            .replace(/([☀☁⛅⛈🌧🌦🌩❄⛄🌫])/g, `<span style="color: ${currentTheme.brightYellow};">$1</span>`)
            // Color location names (first line typically contains the location)
            .replace(/^(.+)$/m, `<span style="color: ${currentTheme.brightGreen}; font-weight: bold;">$1</span>`);
          
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
          currentElement.innerHTML = `<span style="color: ${currentTheme.red};">Error fetching weather data for ${city.replace(/\+/g, ' ')}: ${error}</span>`;
          
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
      return 'curl: no URL provided';
    }

    const url = args[0];

    try {
      const response = await fetch(url);
      const data = await response.text();

      return data;
    } catch (error) {
      return `curl: could not fetch URL ${url}. Details: ${error}`;
    }
  }
};