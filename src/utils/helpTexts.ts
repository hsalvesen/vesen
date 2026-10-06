export const commandHelp = {
  // System commands
  poweroff: `<span style="color: var(--theme-cyan); font-weight: bold;">poweroff</span> : <span style="word-wrap: break-word; overflow-wrap: break-word;">Closes the terminal session. Attempts to close window, then triggers shutdown sequence.</span><br><span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span> poweroff`,

  // System info commands
  whoami: `<span style="color: var(--theme-cyan); font-weight: bold;">whoami</span> : Displays developer.<br><span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span> whoami`,
  fastfetch: `<span style="color: var(--theme-cyan); font-weight: bold;">fastfetch</span> : Shows comprehensive system information with modern detection methods.<br><span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span> fastfetch<br><span style="color: var(--theme-green); font-weight: bold;">Features:</span> Uses User-Agent Client Hints for accurate macOS version detection, Apple Silicon chip identification, and real-time system metrics.`,
  sudo: `<span style="color: var(--theme-cyan); font-weight: bold;">sudo</span> : Executes commands with elevated privileges (simulated).<br><span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span> sudo <span style="color: var(--theme-green);">[command]</span><br><span style="color: var(--theme-red); font-weight: bold;">Note:</span> In this web terminal, sudo is simulated and provides educational content.`,

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
  repo: `<span style="color: var(--theme-cyan); font-weight: bold;">repo</span> : Opens the project's GitHub repository in a new tab.<br><span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span> repo`,
  email: `<span style="color: var(--theme-cyan); font-weight: bold;">email</span> : Opens the default email client to send an email to the developer.<br><span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span> email`,
  speedtest: `<span style="color: var(--theme-cyan); font-weight: bold;">speedtest</span> : Test internet connection speed<br><span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span> speedtest<br><span style="color: var(--theme-green); font-weight: bold;">Features:</span> Tests download/upload speeds and ping latency using Cloudflare infrastructure.`,
  qr: `<span style="color: var(--theme-cyan); font-weight: bold;">qr</span> - Generate a QR code from a URL or text
<span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span> qr <span style="color: var(--theme-green);">[url or text]</span>
<span style="color: var(--theme-red); font-weight: bold;">Examples:</span>
  qr https://github.com/hsalvesen/vesen
  qr https://example.com
  qr hello-world`,
};
