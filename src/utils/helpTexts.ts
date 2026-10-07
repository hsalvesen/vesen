export const commandHelp = {
  // System info commands
  fastfetch: `<span style="color: var(--theme-cyan); font-weight: bold;">fastfetch</span> : Shows comprehensive system information with modern detection methods.<br><span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span> fastfetch<br><span style="color: var(--theme-green); font-weight: bold;">Features:</span> Uses User-Agent Client Hints for accurate macOS version detection, Apple Silicon chip identification, and real-time system metrics.`,

  // Network commands
  weather: `<span style="color: var(--theme-cyan); font-weight: bold;">weather</span> - Get weather information
<span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span> weather <span style="color: var(--theme-green);">[location]</span>
Displays current weather information for the specified location.
<span style="color: var(--theme-red); font-weight: bold;">Examples:</span>
  weather Gadigal
  weather Oslo
  weather Aotearoa`,
  curl: `<span style="color: var(--theme-cyan); font-weight: bold;">curl</span> - Make HTTP requests
<span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span> curl <span style="color: var(--theme-green);">[URL]</span>
Makes an HTTP request to the specified URL and displays the response.

<span style="color: var(--theme-red); font-weight: bold;">Examples:</span>
  curl https://httpbin.org/get
  curl https://api.github.com/users/octocat
  curl https://jsonplaceholder.typicode.com/posts/1`,
  stock: `<span style="color: var(--theme-cyan); font-weight: bold;">stock</span> - Get real-time stock data
<span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span> stock <span style="color: var(--theme-green);">[ticker]</span>
Fetches real-time stock price, daily change, and trend visualisation for the specified ticker symbol.

<span style="color: var(--theme-red); font-weight: bold;">Examples:</span>
stock AAPL
stock TEAM
stock GOOGL
stock MSFT`,
  speedtest: `<span style="color: var(--theme-cyan); font-weight: bold;">speedtest</span> : Test internet connection speed<br><span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span> speedtest<br><span style="color: var(--theme-green); font-weight: bold;">Features:</span> Tests download/upload speeds and ping latency using Cloudflare infrastructure.`,
};
