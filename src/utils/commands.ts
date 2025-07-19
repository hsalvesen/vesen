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
        'echo': 'Display text',
        'exit': 'Close terminal',
        'ls': 'List files',
        'pwd': 'Current path',
        'cd': 'Change dir',
        'cat': 'Show file',
        'touch': 'Create file',
        'rm': 'Remove file',
        'mkdir': 'Make dir',
        'reset': 'Reset terminal',
        'neofetch': 'System info',
        'hostname': 'Show hostname',
        'whoami': 'User info',
        'date': 'Show date',
        'weather': 'Get weather',
        'curl': 'HTTP request',
        'theme': 'Change theme',
        'repo': 'Open repo',
        'email': 'Open email',
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
    const usage = `Usage: theme [args].
    [args]:
      ls: list all available themes
      set: set theme to [theme]

    [Examples]:
      theme ls
      theme set swamphen
    `;
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
    'help': `<span style="color: var(--theme-cyan); font-weight: bold;">help</span> - Display available commands<br><span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span> help<br>Shows a list of all available commands organised by category.`,
    'clear': `<span style="color: var(--theme-cyan); font-weight: bold;">clear</span> - Clear the terminal screen<br><span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span> clear<br>Clears all previous output from the terminal screen.`,
    'echo': `<span style="color: var(--theme-cyan); font-weight: bold;">echo</span> - Display text or write to file<br><span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span><br>&nbsp;&nbsp;echo [text]<br>&nbsp;&nbsp;echo [text] > [filename]<br>&nbsp;&nbsp;echo [text] >> [filename]<br><span style="color: var(--theme-green); font-weight: bold;">Examples:</span><br>&nbsp;&nbsp;echo "Hello World"<br>&nbsp;&nbsp;echo "Content" > file.txt<br>&nbsp;&nbsp;echo "More content" >> file.txt`,
    'ls': `<span style="color: var(--theme-cyan); font-weight: bold;">ls</span> - List directory contents<br><span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span> ls [directory]<br>Lists files and directories in the current or specified directory.`,
    'pwd': `<span style="color: var(--theme-cyan); font-weight: bold;">pwd</span> - Print working directory<br><span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span> pwd<br>Displays the current directory path.`,
    'cd': `<span style="color: var(--theme-cyan); font-weight: bold;">cd</span> - Change directory<br><span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span> cd [directory]<br>Changes the current working directory.<br><span style="color: var(--theme-green); font-weight: bold;">Examples:</span><br>&nbsp;&nbsp;cd /home<br>&nbsp;&nbsp;cd ..<br>&nbsp;&nbsp;cd ~`,
    'cat': `<span style="color: var(--theme-cyan); font-weight: bold;">cat</span> - Display file contents<br><span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span> cat [filename]<br>Displays the contents of the specified file.`,
    'touch': `<span style="color: var(--theme-cyan); font-weight: bold;">touch</span> - Create new file<br><span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span> touch [filename]<br>Creates a new empty file with the specified name.`,
    'rm': `<span style="color: var(--theme-cyan); font-weight: bold;">rm</span> - Remove files or directories<br><span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span> rm [filename/directory]<br>Removes the specified file or directory.`,
    'mkdir': `<span style="color: var(--theme-cyan); font-weight: bold;">mkdir</span> - Create directory<br><span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span> mkdir [directory_name]<br>Creates a new directory with the specified name.`,
    'reset': `<span style="color: var(--theme-cyan); font-weight: bold;">reset</span> - Reset session<br><span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span> reset<br>Resets the terminal to its initial state, clearing history and resetting theme.`,
    'neofetch': `<span style="color: var(--theme-cyan); font-weight: bold;">neofetch</span> - Display system information<br><span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span> neofetch<br>Shows detailed system information in a formatted display.`,
    'weather': `<span style="color: var(--theme-cyan); font-weight: bold;">weather</span> - Get weather information<br><span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span> weather [location]<br>Displays current weather information for the specified location.`,
    'curl': `<span style="color: var(--theme-cyan); font-weight: bold;">curl</span> - Make HTTP requests<br><span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span> curl [URL]<br>Makes an HTTP request to the specified URL and displays the response.`,
    'theme': `<span style="color: var(--theme-cyan); font-weight: bold;">theme</span> - Change terminal theme<br><span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span><br>&nbsp;&nbsp;theme<br>&nbsp;&nbsp;theme [theme_name]<br>Without arguments, shows available themes. With a theme name, changes to that theme.`,
    'repo': `<span style="color: var(--theme-cyan); font-weight: bold;">repo</span> - Open project repository<br><span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span> repo<br>Opens the project's GitHub repository in a new tab.`,
    'email': `<span style="color: var(--theme-cyan); font-weight: bold;">email</span> - Contact developer<br><span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span> email<br>Opens the default email client to send an email to the developer.`,
    'banner': `<span style="color: var(--theme-cyan); font-weight: bold;">banner</span> - Display welcome banner<br><span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span> banner<br>Shows the terminal welcome banner with ASCII art and version information.`,
    'exit': `<span style="color: var(--theme-cyan); font-weight: bold;">exit</span> - Close terminal<br><span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span> exit<br>Closes the terminal session.`
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
