import packageJson from '../../package.json';
import themes from '../../themes.json';
import { history } from '../stores/history';
import { systemCommands } from './commands/system';
import { fileSystemCommands } from './commands/fileSystem';
import { networkCommands } from './commands/network';
import { theme } from '../stores/theme';
import { get } from 'svelte/store';
import { virtualFileSystem, currentPath, type VirtualFile, resolvePath } from './virtualFileSystem';
import { commandHelp, commandDescriptions } from './helpTexts';
import { playBeep } from './beep';

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
      'Network': ['weather', 'curl', 'stock'],
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
        const description = commandDescriptions[cmd] || '';
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
        result += `\n<span style="color: var(--theme-cyan);">You can preview all these themes here: ${packageJson.repository.url}/tree/main/docs/themes</span>`;
        
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
    const currentTheme = get(theme);
    window.open('https://github.com/hsalvesen/vesen');
    return `<span style="color: ${currentTheme.cyan};">Opening Vesen repository...</span>`;
  },
  
  email: () => {
    const now = new Date();
    const timestamp = now.toLocaleString('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
    
    const subject = `Terminal Contact - ${timestamp}`;
    const encodedSubject = encodeURIComponent(subject);
    
    window.open(`mailto:has@salvesen.app?subject=${encodedSubject}`);
    return 'Opening email client...';
  }
};

// Add a separate function to handle --help flags
// Helper function to find case-insensitive command matches
function findSimilarCommand(inputCommand: string): string | null {
  const commandList = Object.keys(commands);
  
  // First try exact case-insensitive match
  const exactMatch = commandList.find(cmd => cmd.toLowerCase() === inputCommand.toLowerCase());
  if (exactMatch) {
    return exactMatch;
  }
  
  // Then try partial matches (starts with)
  const partialMatch = commandList.find(cmd => 
    cmd.toLowerCase().startsWith(inputCommand.toLowerCase()) ||
    inputCommand.toLowerCase().startsWith(cmd.toLowerCase())
  );
  
  return partialMatch || null;
}

export function processCommand(input: string, abortController?: AbortController | null): string | Promise<string> {
  const args = input.trim().split(/\s+/);
  const command = args[0];
  const hasHelpFlag = args.includes('--help') || args.includes('-h');
  
  if (hasHelpFlag) {
    return getCommandHelp(command);
  }
  
  // Execute the actual command if it exists (exact match)
  if (commands[command]) {
    // Pass abort controller to network commands
    if (['curl', 'weather', 'stock'].includes(command) && abortController) {
      return commands[command](args.slice(1), abortController);
    }
    return commands[command](args.slice(1));
  }
  
  // Try to find a similar command with different case
  const similarCommand = findSimilarCommand(command);
  if (similarCommand) {
    // Play beep sound for unrecognized command
    playBeep();
    const currentTheme = get(theme);
    return `Command '${command}' not found. Did you mean <span style="color: var(--theme-cyan); font-weight: bold;">${similarCommand}</span>? Type 'help' to see available commands.`;
  }
  
  // Play beep sound for unrecognized command
  playBeep();
  return `Command '${command}' not found. Type 'help' to see available commands.`;
}

// Re-export virtualFileSystem and currentPath from the dedicated module
export { virtualFileSystem, currentPath } from './virtualFileSystem';

  // Helper function to provide detailed help for each command
  function getCommandHelp(command: string): string {
    const helpText = commandHelp[command];
    if (!helpText) {
      return `No help available for command: ${command}`;
    }
    
    // Add colour tip at the end
    return helpText + `<br><span style="color: var(--theme-yellow);">Tip: Use 'help' to see all available commands</span>`;
  }

  // Combine all commands
  export const commands: Record<string, (args: string[], abortController?: AbortController) => Promise<string> | string> = {
    ...systemCommands,
    ...fileSystemCommands,
    ...networkCommands,
    ...terminalCommands,
    ...projectCommands
  };
