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
    
    let output = `<span style="color: ${currentTheme.cyan}; font-weight: bold;">Available Commands:</span>\n\n`;
    
    // Simple three-column layout using CSS columns
    output += '<div style="column-count: 3; column-gap: 50px; column-fill: balance; break-inside: avoid;">';
    
    // Process each category
    Object.entries(categories).forEach(([category, cmds]) => {
      const availableCommands = cmds.filter(cmd => commandList.includes(cmd));
      if (availableCommands.length === 0) return;
      
      // Category section with break-inside avoid
      output += `<div style="break-inside: avoid; margin-bottom: 20px;">`;
      
      // Category header
      output += `<div style="color: ${currentTheme.yellow}; font-weight: bold; margin-bottom: 8px;">${category}:</div>`;
      
      // Commands in this category
      for (const cmd of availableCommands) {
        const description = getCommandDescription(cmd);
        output += `<div style="margin: 3px 0; display: flex; align-items: flex-start;">`;
        output += `<span style="color: ${currentTheme.green}; font-weight: bold; min-width: 80px; margin-right: 12px; flex-shrink: 0;">${cmd}</span>`;
        output += `<span style="color: ${currentTheme.white}; flex: 1; word-break: break-word;">${description}</span>`;
        output += '</div>';
      }
      
      output += '</div>';
    });
    
    output += '</div>';
    
    // Add responsive media query for smaller screens
    output += `
    <style>
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
    </style>
    `;
    
    output += `\n<span style="color: ${currentTheme.cyan};">Type [command] --help for detailed usage information</span>`;
    
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
      theme set panda
    `;
    if (args.length === 0) {
      return usage;
    }

    switch (args[0]) {
      case 'ls': {
        let result = themes.map((t) => t.name.toLowerCase()).join(', ');
        result += `\nYou can preview all these themes here: ${packageJson.repository.url}/tree/main/docs/themes`;

        return result;
      }

      case 'set': {
        if (args.length !== 2) {
          return usage;
        }

        const selectedTheme = args[1];
        const t = themes.find((t) => t.name.toLowerCase() === selectedTheme);

        if (!t) {
          return `Theme '${selectedTheme}' not found. Try 'theme ls' to see all available themes.`;
        }

        theme.set(t);

        return `Theme set to ${selectedTheme}`;
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
  const currentTheme = get(theme);
  
  const helpTexts: Record<string, string> = {
    'help': `<span style="color: ${currentTheme.cyan}; font-weight: bold;">help</span> - Display available commands\n\nUsage: help\n\nShows a list of all available commands organised by category.`,
    'clear': `<span style="color: ${currentTheme.cyan}; font-weight: bold;">clear</span> - Clear the terminal screen\n\nUsage: clear\n\nClears all previous output from the terminal screen.`,
    'echo': `<span style="color: ${currentTheme.cyan}; font-weight: bold;">echo</span> - Display text or write to file\n\nUsage: \n  echo [text]\n  echo [text] > [filename]\n  echo [text] >> [filename]\n\nExamples:\n  echo "Hello World"\n  echo "Content" > file.txt\n  echo "More content" >> file.txt`,
    'ls': `<span style="color: ${currentTheme.cyan}; font-weight: bold;">ls</span> - List directory contents\n\nUsage: ls [directory]\n\nLists files and directories in the current or specified directory.`,
    'pwd': `<span style="color: ${currentTheme.cyan}; font-weight: bold;">pwd</span> - Print working directory\n\nUsage: pwd\n\nDisplays the current directory path.`,
    'cd': `<span style="color: ${currentTheme.cyan}; font-weight: bold;">cd</span> - Change directory\n\nUsage: cd [directory]\n\nChanges the current working directory.\n\nExamples:\n  cd /home\n  cd ..\n  cd ~`,
    'cat': `<span style="color: ${currentTheme.cyan}; font-weight: bold;">cat</span> - Display file contents\n\nUsage: cat [filename]\n\nDisplays the contents of the specified file.`,
    'touch': `<span style="color: ${currentTheme.cyan}; font-weight: bold;">touch</span> - Create new file\n\nUsage: touch [filename]\n\nCreates a new empty file with the specified name.`,
    'rm': `<span style="color: ${currentTheme.cyan}; font-weight: bold;">rm</span> - Remove files or directories\n\nUsage: rm [filename/directory]\n\nRemoves the specified file or directory.`,
    'mkdir': `<span style="color: ${currentTheme.cyan}; font-weight: bold;">mkdir</span> - Create directory\n\nUsage: mkdir [directory_name]\n\nCreates a new directory with the specified name.`,
    'reset': `<span style="color: ${currentTheme.cyan}; font-weight: bold;">reset</span> - Reset session\n\nUsage: reset\n\nResets the terminal to its initial state, clearing history and resetting theme.`,
    'neofetch': `<span style="color: ${currentTheme.cyan}; font-weight: bold;">neofetch</span> - Display system information\n\nUsage: neofetch\n\nShows detailed system information in a formatted display.`,
    'weather': `<span style="color: ${currentTheme.cyan}; font-weight: bold;">weather</span> - Get weather information\n\nUsage: weather [location]\n\nDisplays current weather information for the specified location.`,
    'curl': `<span style="color: ${currentTheme.cyan}; font-weight: bold;">curl</span> - Make HTTP requests\n\nUsage: curl [URL]\n\nMakes an HTTP request to the specified URL and displays the response.`,
    'theme': `<span style="color: ${currentTheme.cyan}; font-weight: bold;">theme</span> - Change terminal theme\n\nUsage: \n  theme\n  theme [theme_name]\n\nWithout arguments, shows available themes. With a theme name, changes to that theme.`,
    'repo': `<span style="color: ${currentTheme.cyan}; font-weight: bold;">repo</span> - Open project repository\n\nUsage: repo\n\nOpens the project's GitHub repository in a new tab.`,
    'email': `<span style="color: ${currentTheme.cyan}; font-weight: bold;">email</span> - Contact developer\n\nUsage: email\n\nOpens the default email client to send an email to the developer.`,
    'banner': `<span style="color: ${currentTheme.cyan}; font-weight: bold;">banner</span> - Display welcome banner\n\nUsage: banner\n\nShows the terminal welcome banner with ASCII art and version information.`,
    'exit': `<span style="color: ${currentTheme.cyan}; font-weight: bold;">exit</span> - Close terminal\n\nUsage: exit\n\nCloses the terminal session.`
  };
  
  return helpTexts[command] || `No help available for command '${command}'. Type 'help' to see available commands.`;
}

// Combine all commands
export const commands: Record<string, (args: string[]) => Promise<string> | string> = {
  ...systemCommands,
  ...fileSystemCommands,
  ...networkCommands,
  ...terminalCommands,
  ...projectCommands
};
