export const commandHelp = {
  // System info commands
  fastfetch: `<span style="color: var(--theme-cyan); font-weight: bold;">fastfetch</span> : Shows comprehensive system information with modern detection methods.<br><span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span> fastfetch<br><span style="color: var(--theme-green); font-weight: bold;">Features:</span> Uses User-Agent Client Hints for accurate macOS version detection, Apple Silicon chip identification, and real-time system metrics.`,

  // Network commands
  curl: `<span style="color: var(--theme-cyan); font-weight: bold;">curl</span> - Make HTTP requests
<span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span> curl <span style="color: var(--theme-green);">[URL]</span>
Makes an HTTP request to the specified URL and displays the response.

<span style="color: var(--theme-red); font-weight: bold;">Examples:</span>
  curl https://httpbin.org/get
  curl https://api.github.com/users/octocat
  curl https://jsonplaceholder.typicode.com/posts/1`,
  speedtest: `<span style="color: var(--theme-cyan); font-weight: bold;">speedtest</span> : Test internet connection speed<br><span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span> speedtest<br><span style="color: var(--theme-green); font-weight: bold;">Features:</span> Tests download/upload speeds and ping latency using Cloudflare infrastructure.`,
};
