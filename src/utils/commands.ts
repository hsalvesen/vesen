import packageJson from '../../package.json';
import themes from '../../themes.json';
import { history } from '../stores/history';
import { systemCommands } from './commands/system';
import { fileSystemCommands } from './commands/fileSystem';
import { networkCommands } from './commands/network';
import { theme } from '../stores/theme';
import { get } from 'svelte/store';
import { virtualFileSystem, currentPath, type VirtualFile, resolvePath } from './virtualFileSystem';

const hostname = window.location.hostname;

// Terminal-specific commands that don't fit in other modules
const terminalCommands = {
  help: () => {
    const currentTheme = get(theme);
    const commandList = Object.keys(commands);
    
    // Group commands by category for better organisation
    const categories: Record<string, string[]> = {
      'System Info': ['neofetch', 'hostname', 'whoami', 'date'],
      'File System': ['ls', 'pwd', 'cd', 'cat', 'touch', 'rm', 'mkdir'],
      'Terminal': ['help', 'clear', 'reset', 'echo', 'exit'],
      'Network': ['weather', 'curl'],
      'Customisation': ['theme'],
      'Project': ['repo', 'email', 'banner']
    };
    
    let output = `<span style="color: var(--theme-cyan); font-weight: bold;">Available Commands:</span>\n\n`;
    
    // Simple three-column layout using CSS columns
    output += '<div style="column-count: 3; column-gap: 50px; column-fill: balance; break-inside: avoid;">';
    
    // Process each category
    Object.entries(categories).forEach(([category, cmds]) => {
      const availableCommands = cmds.filter(cmd => commandList.includes(cmd));
      if (availableCommands.length === 0) return;
      
      // Category section with break-inside avoid
      output += `<div style="break-inside: avoid; margin-bottom: 20px;">`;
      
      // Category header
      output += `<div style="color: var(--theme-yellow); font-weight: bold; margin-bottom: 8px;">${category}:</div>`;
      
      // Commands in this category
      for (const cmd of availableCommands) {
        const description = getCommandDescription(cmd);
        output += `<div style="margin: 3px 0; display: flex; align-items: flex-start;">`;
        output += `<span style="color: var(--theme-green); font-weight: bold; min-width: 80px; margin-right: 12px; flex-shrink: 0;">${cmd}</span>`;
        output += `<span style="color: var(--theme-white); flex: 1; word-break: break-word;">${description}</span>`;
        output += '</div>';
      }
      
      output += '</div>';
    });
    
    output += '</div>';
    
    // Add responsive media query for smaller screens
    output += `<style>
      @media (max-width: 1000px) {
        div[style*="column-count: 3"] {
          column-count: 2 !important;
          column-gap: 40px !important;
        }
      }
      @media (max-width: 650px) {
        div[style*="column-count: 3"] {
          column-count: 1 !important;
        }
      }
    </style>`;
    
    output += `\n<span style="color: var(--theme-cyan);">Type [command] --help for detailed usage information</span>`;
    
    function getCommandDescription(cmd: string): string {
      const descriptions: Record<string, string> = {
        'help': 'Show commands',
        'clear': 'Clear screen',
        'echo': 'Write text',
        'exit': 'Close terminal',
        'ls': 'List files',
        'pwd': 'Show current path',
        'cd': 'Change directory',
        'cat': 'Show file contents',
        'touch': 'Create file',
        'rm': 'Remove file',
        'mkdir': 'Make directory',
        'reset': 'Reset terminal',
        'neofetch': 'Fetch system info',
        'hostname': 'Show hostname',
        'whoami': 'Developer info',
        'date': 'Show date',
        'weather': 'Get weather forecast',
        'curl': 'HTTP request',
        'theme': 'Change theme',
        'repo': 'Open repository',
        'email': 'Open mail client',
        'banner': 'Show banner'
      };
      return descriptions[cmd] || '';
    }
    
    return output;
  },

};

// Project-specific commands
const projectCommands = {
  theme: (args: string[]) => {
    const usage = `<span style="color: var(--theme-cyan); font-weight: bold;">theme</span> - Change terminal theme
<span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span> theme <span style="color: var(--theme-green);">[args]</span>.
  <span style="color: var(--theme-green);">args:</span>
    ls: list all available themes
    set: set theme to [theme]

<span style="color: var(--theme-red); font-weight: bold;">Examples:</span>
  theme ls
  theme set swampHen`;
    if (args.length === 0) {
      return usage;
    }

    switch (args[0]) {
      case 'ls': {
        const currentTheme = get(theme);
        const themeList = themes.map((t) => {
          const themeName = t.name;
          const isCurrentTheme = t.name === currentTheme.name;
          
          if (isCurrentTheme) {
            return `<span style="color: var(--theme-bright-cyan); font-weight: bold;">${themeName}</span>`;
          } else {
            return `<span style="color: var(--theme-white);">${themeName}</span>`;
          }
        }).join(', ');
        
        let result = themeList;
        result += `\nYou can preview all these themes here: ${packageJson.repository.url}/tree/main/docs/themes`;
        
        return result;
      }

      case 'set': {
        if (args.length !== 2) {
          return usage;
        }

        const selectedTheme = args[1];
        const t = themes.find((t) => t.name.toLowerCase() === selectedTheme.toLowerCase());
    
        if (!t) {
          return `Theme '${selectedTheme}' not found. Try 'theme ls' to see all available themes.`;
        }
    
        theme.set(t);
    
        return `Theme set to ${t.name}`;
      }

      default: {
        return usage;
      }
    }
  },
  repo: () => {
    window.open('https://github.com/hsalvesen/vesen');
    return 'Opening repository...';
  },
  
  email: () => {
    window.open('mailto:has@salvesen.app');
    return 'Opening email client...';
  }
};

// Add a separate function to handle --help flags
export function processCommand(input: string): string | Promise<string> {
  const args = input.trim().split(/\s+/);
  const command = args[0];
  const hasHelpFlag = args.includes('--help') || args.includes('-h');
  
  if (hasHelpFlag) {
    return getCommandHelp(command);
  }
  
  // Execute the actual command if it exists
  if (commands[command]) {
    return commands[command](args.slice(1)); // Pass string[] not string
  }
  
  return `Command '${command}' not found. Type 'help' to see available commands.`;
}

// Re-export virtualFileSystem and currentPath from the dedicated module
export { virtualFileSystem, currentPath } from './virtualFileSystem';

// Helper function to provide detailed help for each command
function getCommandHelp(command: string): string {
  const helpTexts: Record<string, string> = {
    'help': `<span style="color: var(--theme-cyan); font-weight: bold;">help</span> : Shows a list of all available commands organised by category.<br><span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span> help`,
    'clear': `<span style="color: var(--theme-cyan); font-weight: bold;">clear</span> : Clears all previous output from the terminal screen.<br><span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span> clear`,
    'echo': `<span style="color: var(--theme-cyan); font-weight: bold;">echo</span> : Display text or write to file<br><span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span><br>&nbsp;&nbsp;echo <span style="color: var(--theme-green);">[text]</span><br>&nbsp;&nbsp;echo <span style="color: var(--theme-green);">[text]</span> > <span style="color: var(--theme-green);">[filename]</span><br>&nbsp;&nbsp;echo <span style="color: var(--theme-green);">[text]</span> >> <span style="color: var(--theme-green);">[filename]</span><br><span style="color: var(--theme-red); font-weight: bold;">Examples:</span><br>&nbsp;&nbsp;echo "Hello World"<br>&nbsp;&nbsp;echo "Content" > file.txt<br>&nbsp;&nbsp;echo "More content" >> file.txt`,
    'ls': `<span style="color: var(--theme-cyan); font-weight: bold;">ls</span> : Lists files and directories in the current or specified directory.<br><span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span> ls <span style="color: var(--theme-green);">[directory]</span><br><span style="color: var(--theme-red); font-weight: bold;">Examples:</span><br>&nbsp;&nbsp;ls<br>&nbsp;&nbsp;ls documents<br>&nbsp;&nbsp;ls /home/user`,
    'pwd': `<span style="color: var(--theme-cyan); font-weight: bold;">pwd</span> : Displays the current directory path.<br><span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span> pwd`,
    'cd': `<span style="color: var(--theme-cyan); font-weight: bold;">cd</span> : Changes the current working directory.<br><span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span> cd <span style="color: var(--theme-green);">[directory]</span><br><span style="color: var(--theme-red); font-weight: bold;">Examples:</span><br>&nbsp;&nbsp;cd documents<br>&nbsp;&nbsp;cd ..<br>&nbsp;&nbsp;cd ~<br>&nbsp;&nbsp;cd /home/user`,
    'cat': `<span style="color: var(--theme-cyan); font-weight: bold;">cat</span> : Displays the contents of the specified file.<br><span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span> cat <span style="color: var(--theme-green);">[filename]</span><br><span style="color: var(--theme-red); font-weight: bold;">Examples:</span><br>&nbsp;&nbsp;cat experience.md<br>&nbsp;&nbsp;cat documents/readme.md<br>&nbsp;&nbsp;cat has.txt`,
    'touch': `<span style="color: var(--theme-cyan); font-weight: bold;">touch</span> : Creates a new empty file with the specified name.<br><span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span> touch <span style="color: var(--theme-green);">[filename]</span><br><span style="color: var(--theme-red); font-weight: bold;">Examples:</span><br>&nbsp;&nbsp;touch newfile.txt<br>&nbsp;&nbsp;touch documents/notes.md<br>&nbsp;&nbsp;touch script.js`,
    'rm': `<span style="color: var(--theme-cyan); font-weight: bold;">rm</span> : Removes the specified file or directory.<br><span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span> rm <span style="color: var(--theme-green);">[options] [filename/directory]</span><br><span style="color: var(--theme-green); font-weight: bold;">Options:</span><br>&nbsp;&nbsp;-r, --recursive  remove directories and their contents recursively<br><span style="color: var(--theme-red); font-weight: bold;">Examples:</span><br>&nbsp;&nbsp;rm has.txt<br>&nbsp;&nbsp;rm -r documents<br>&nbsp;&nbsp;rm script.js`,
    'mkdir': `<span style="color: var(--theme-cyan); font-weight: bold;">mkdir</span> : Creates a new directory with the specified name.<br><span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span> mkdir <span style="color: var(--theme-green);">[directory_name]</span><br><span style="color: var(--theme-red); font-weight: bold;">Examples:</span><br>&nbsp;&nbsp;mkdir new_folder<br>&nbsp;&nbsp;mkdir projects/myapp<br>&nbsp;&nbsp;mkdir temp`,
    'reset': `<span style="color: var(--theme-cyan); font-weight: bold;">reset</span> : Resets the terminal to its initial state, clearing history and resetting theme.<br><span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span> reset`,
    'hostname': `<span style="color: var(--theme-cyan); font-weight: bold;">hostname</span> : Shows the current hostname of the system.<br><span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span> hostname`,
    'whoami': `<span style="color: var(--theme-cyan); font-weight: bold;">whoami</span> : Displays developer.<br><span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span> whoami`,
    'date': `<span style="color: var(--theme-cyan); font-weight: bold;">date</span> : Shows the current date and time in local format.<br><span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span> date`,
    'neofetch': `<span style="color: var(--theme-cyan); font-weight: bold;">neofetch</span> : Shows detailed system information in a formatted display.<br><span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span> neofetch`,
    'weather': `<span style="color: var(--theme-cyan); font-weight: bold;">weather</span> : Displays current weather information for the specified location.<br><span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span> weather <span style="color: var(--theme-green);">[location]</span><br><span style="color: var(--theme-red); font-weight: bold;">Examples:</span><br>&nbsp;&nbsp;weather Gadigal<br>&nbsp;&nbsp;weather Oslo<br>&nbsp;&nbsp;weather Aotearoa`,
    'curl': `<span style="color: var(--theme-cyan); font-weight: bold;">curl</span> : Makes an HTTP request to the specified URL and displays the response.<br><span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span> curl <span style="color: var(--theme-green);">[URL]</span><br><span style="color: var(--theme-red); font-weight: bold;">Examples:</span><br>&nbsp;&nbsp;curl https://httpbin.org/get<br>&nbsp;&nbsp;curl https://api.github.com/users/octocat<br>&nbsp;&nbsp;curl https://jsonplaceholder.typicode.com/posts/1`,
    'theme': `<span style="color: var(--theme-cyan); font-weight: bold;">theme</span> : Change terminal theme<br><span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span> theme <span style="color: var(--theme-green);">[args]</span>.<br>&nbsp;&nbsp;<span style="color: var(--theme-green);">args:</span><br>&nbsp;&nbsp;&nbsp;&nbsp;ls: list all available themes<br>&nbsp;&nbsp;&nbsp;&nbsp;set: set theme to [theme]<br><span style="color: var(--theme-red); font-weight: bold;">Examples:</span><br>&nbsp;&nbsp;theme ls<br>&nbsp;&nbsp;theme set swampHen`,
    'repo': `<span style="color: var(--theme-cyan); font-weight: bold;">repo</span> : Opens the project's GitHub repository in a new tab.<br><span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span> repo`,
    'email': `<span style="color: var(--theme-cyan); font-weight: bold;">email</span> : Opens the default email client to send an email to the developer.<br><span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span> email`,
    'banner': `<span style="color: var(--theme-cyan); font-weight: bold;">banner</span> : Shows the terminal welcome banner with ASCII art and version information.<br><span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span> banner`,
    'exit': `<span style="color: var(--theme-cyan); font-weight: bold;">exit</span> : Closes the terminal session.<br><span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span> exit`
  };
  
  const helpText = helpTexts[command];
  if (!helpText) {
    return `No help available for command: ${command}`;
  }
  
  // Add colored tip at the end
  return helpText + `<br><span style="color: var(--theme-magenta); Tip: Use 'help' to see all available commands</span>`;
}

// Combine all commands
export const commands: Record<string, (args: string[]) => Promise<string> | string> = {
  ...systemCommands,
  ...fileSystemCommands,
  ...networkCommands,
  ...terminalCommands,
  ...projectCommands
};
