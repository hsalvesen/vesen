export const commandHelp = {
  // System commands
  help: `<span style="color: var(--theme-cyan); font-weight: bold;">help</span> : <span style="word-wrap: break-word; overflow-wrap: break-word;">Shows a list of all available commands organised by category.</span><br><span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span> help`,
  clear: `<span style="color: var(--theme-cyan); font-weight: bold;">clear</span> : <span style="word-wrap: break-word; overflow-wrap: break-word;">Clears all previous output from the terminal screen.</span><br><span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span> clear`,
  echo: `<span style="color: var(--theme-cyan); font-weight: bold;">echo</span> : Display text or write to file<br><span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span><br>&nbsp;&nbsp;echo <span style="color: var(--theme-green);">[text]</span><br>&nbsp;&nbsp;echo <span style="color: var(--theme-green);">[text]</span> > <span style="color: var(--theme-green);">[filename]</span><br>&nbsp;&nbsp;echo <span style="color: var(--theme-green);">[text]</span> >> <span style="color: var(--theme-green);">[filename]</span><br><span style="color: var(--theme-red); font-weight: bold;">Examples:</span><br>&nbsp;&nbsp;echo "Hello World"<br>&nbsp;&nbsp;echo "Content" > file.txt<br>&nbsp;&nbsp;echo "More content" >> file.txt`,
  poweroff: `<span style="color: var(--theme-cyan); font-weight: bold;">poweroff</span> : <span style="word-wrap: break-word; overflow-wrap: break-word;">Closes the terminal session. Attempts to close window, then triggers shutdown sequence.</span><br><span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span> poweroff`,
  history: `<span style="color: var(--theme-cyan); font-weight: bold;">history</span> : <span style="word-wrap: break-word; overflow-wrap: break-word;">Displays a numbered list of previously executed commands.</span><br><span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span> history<br><span style="color: var(--theme-magenta); font-weight: bold;">Note:</span> <span style="word-wrap: break-word; overflow-wrap: break-word;">Command history resets when the browser is reloaded or the session is restarted.</span>`,
  
  // File system commands
  ls: `<span style="color: var(--theme-cyan); font-weight: bold;">ls</span> : Lists files and directories in the current or specified directory.<br><span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span> ls <span style="color: var(--theme-green);">[directory]</span><br><span style="color: var(--theme-red); font-weight: bold;">Examples:</span><br>&nbsp;&nbsp;ls<br>&nbsp;&nbsp;ls documents<br>&nbsp;&nbsp;ls /home/user`,
  pwd: `<span style="color: var(--theme-cyan); font-weight: bold;">pwd</span> : Displays the current directory path.<br><span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span> pwd`,
  cd: `<span style="color: var(--theme-cyan); font-weight: bold;">cd</span> : Changes the current working directory.<br><span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span> cd <span style="color: var(--theme-green);">[directory]</span><br><span style="color: var(--theme-red); font-weight: bold;">Examples:</span><br>&nbsp;&nbsp;cd documents<br>&nbsp;&nbsp;cd ..<br>&nbsp;&nbsp;cd ~<br>&nbsp;&nbsp;cd /home/user`,
  cat: `<span style="color: var(--theme-cyan); font-weight: bold;">cat</span> : Displays the contents of the specified file.<br><span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span> cat <span style="color: var(--theme-green);">[filename]</span><br><span style="color: var(--theme-red); font-weight: bold;">Examples:</span><br>&nbsp;&nbsp;cat experience.md<br>&nbsp;&nbsp;cat documents/README.md`,
  touch: `<span style="color: var(--theme-cyan); font-weight: bold;">touch</span> : Creates a new empty file with the specified name.<br><span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span> touch <span style="color: var(--theme-green);">[filename]</span><br><span style="color: var(--theme-red); font-weight: bold;">Examples:</span><br>&nbsp;&nbsp;touch newfile.txt<br>&nbsp;&nbsp;touch documents/notes.md<br>&nbsp;&nbsp;touch script.js`,
  rm: `<span style="color: var(--theme-cyan); font-weight: bold;">rm</span> : Removes the specified file or directory.<br><span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span> rm <span style="color: var(--theme-green);">[options] [filename/directory]</span><br><span style="color: var(--theme-green); font-weight: bold;">Options:</span><br>&nbsp;&nbsp;-r, --recursive  remove directories and their contents recursively<br><span style="color: var(--theme-red); font-weight: bold;">Examples:</span><br>&nbsp;&nbsp;rm has.txt<br>&nbsp;&nbsp;rm -r documents<br>&nbsp;&nbsp;rm script.js`,
  mkdir: `<span style="color: var(--theme-cyan); font-weight: bold;">mkdir</span> : Creates a new directory with the specified name.<br><span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span> mkdir <span style="color: var(--theme-green);">[directory_name]</span><br><span style="color: var(--theme-red); font-weight: bold;">Examples:</span><br>&nbsp;&nbsp;mkdir new_folder<br>&nbsp;&nbsp;mkdir projects/myapp<br>&nbsp;&nbsp;mkdir temp`,

  // System info commands
  reset: `<span style="color: var(--theme-cyan); font-weight: bold;">reset</span> : <span style="word-wrap: break-word; overflow-wrap: break-word;">Resets the terminal to its initial state, clearing history and resetting theme.</span><br><span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span> reset`,
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
  // Project commands
  theme: `<span style="color: var(--theme-cyan); font-weight: bold;">theme</span> - Change terminal theme
<span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span> theme <span style="color: var(--theme-green);">[args]</span>.
  <span style="color: var(--theme-green);">args:</span>
    ls: list all available themes
    set: set theme to [theme]

<span style="color: var(--theme-red); font-weight: bold;">Examples:</span>
  theme ls
  theme set swamphen`,
  repo: `<span style="color: var(--theme-cyan); font-weight: bold;">repo</span> : Opens the project's GitHub repository in a new tab.<br><span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span> repo`,
  email: `<span style="color: var(--theme-cyan); font-weight: bold;">email</span> : Opens the default email client to send an email to the developer.<br><span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span> email`,
  banner: `<span style="color: var(--theme-cyan); font-weight: bold;">banner</span> : Shows the terminal welcome banner with ASCII art and version information.<br><span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span> banner`,
  speedtest: `<span style="color: var(--theme-cyan); font-weight: bold;">speedtest</span> : Test internet connection speed<br><span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span> speedtest<br><span style="color: var(--theme-green); font-weight: bold;">Features:</span> Tests download/upload speeds and ping latency using Cloudflare infrastructure.`,
};

// Short descriptions for the help command
export const commandDescriptions = {
  'help': 'Show commands',
  'clear': 'Clear screen',
  'echo': 'Write text',
  'poweroff': 'Shut down terminal',
  'history': 'Show command history',
  'ls': 'List files',
  'pwd': 'Show current path',
  'cd': 'Change directory',
  'cat': 'Show file contents',
  'touch': 'Create file',
  'rm': 'Remove file',
  'mkdir': 'Make directory',
  'reset': 'Reset terminal',
  'fastfetch': 'System info',
  'whoami': 'Developer info',
  'sudo': 'Elevate privileges',
  'weather': 'Weather forecast',
  'curl': 'HTTP request',
  'stock': 'Stock data',
  'theme': 'Change theme',
  'repo': 'Open repository',
  'email': 'Open mail client',
  'banner': 'Show banner',
  'speedtest': 'Internet speed test',
};
