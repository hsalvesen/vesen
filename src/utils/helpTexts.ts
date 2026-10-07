export const commandHelp = {
  // Network commands
  weather: `<span style="color: var(--theme-cyan); font-weight: bold;">weather</span> - Get weather information
<span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span> weather <span style="color: var(--theme-green);">[location]</span>
Displays current weather information for the specified location.
<span style="color: var(--theme-red); font-weight: bold;">Examples:</span>
  weather Gadigal
  weather Oslo
  weather Aotearoa`,
  stock: `<span style="color: var(--theme-cyan); font-weight: bold;">stock</span> - Get real-time stock data
<span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span> stock <span style="color: var(--theme-green);">[ticker]</span>
Fetches real-time stock price, daily change, and trend visualisation for the specified ticker symbol.

<span style="color: var(--theme-red); font-weight: bold;">Examples:</span>
stock AAPL
stock TEAM
stock GOOGL
stock MSFT`,
  qr: `<span style="color: var(--theme-cyan); font-weight: bold;">qr</span> - Generate a QR code from a URL or text
<span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span> qr <span style="color: var(--theme-green);">[url or text]</span>
<span style="color: var(--theme-red); font-weight: bold;">Examples:</span>
  qr https://github.com/hsalvesen/vesen
  qr https://example.com
  qr hello-world`,
};
