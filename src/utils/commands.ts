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

// Terminal-specific commands that don't fit in other modules
const terminalCommands = {
  help: (args: string[]) => {
    const currentTheme = get(theme);
    const commandList = Object.keys(commands);
    
    // If specific category requested
    if (args.length > 0) {
      const requestedCategory = args[0].toLowerCase();
      const categoryMap: Record<string, string[]> = {
        'info': ['neofetch', 'whoami'],
        'fs': ['ls', 'pwd', 'cd', 'cat', 'echo'],
        'file': ['touch', 'rm', 'mkdir'],
        'terminal': ['help', 'clear', 'reset', 'exit', 'history', 'sudo'],
        'net': ['weather', 'curl', 'stock'],
        'theme': ['theme'],
        'project': ['repo', 'email', 'banner']
      };
      
      const categoryNames: Record<string, string> = {
        'info': 'System Information',
        'fs': 'File System Navigation',
        'file': 'File Operations',
        'terminal': 'Terminal Control',
        'net': 'Network Commands',
        'theme': 'Customisation',
        'project': 'Project Commands'
      };
      
      if (categoryMap[requestedCategory]) {
        const cmds = categoryMap[requestedCategory];
        const categoryName = categoryNames[requestedCategory];
        
        let output = `<span style="color: var(--theme-cyan); font-weight: bold;">${categoryName} Commands:</span>\n\n`;
        
        for (const cmd of cmds) {
          if (commandList.includes(cmd)) {
            const description = commandDescriptions[cmd] || '';
            output += `<div style="margin: 8px 0;">`;
            output += `<span style="color: var(--theme-green); font-weight: bold;">${cmd}</span> - `;
            output += `<span style="color: var(--theme-white);">${description}</span>`;
            output += '</div>';
          }
        }
        
        output += `\n<span style="color: var(--theme-yellow);">Use 'help' to see all categories or '[command] --help' for detailed usage</span>`;
        return output;
      } else {
        return `<span style="color: var(--theme-red);">Unknown category: ${requestedCategory}</span>\n<span style="color: var(--theme-yellow);">Available categories: info, fs, file, terminal, net, theme, project</span>`;
      }
    }
    
    // Default help - show categories overview
    let output = `<span style="color: var(--theme-cyan); font-weight: bold;">Vesen Terminal - Command Categories</span>\n\n`;
    
    const categoryOverview = [
      { name: 'info', desc: 'System information (neofetch, whoami)', color: 'var(--theme-bright-green)' },
      { name: 'fs', desc: 'Navigate files and directories', color: 'var(--theme-bright-blue)' },
      { name: 'file', desc: 'Create, modify, and delete files', color: 'var(--theme-bright-yellow)' },
      { name: 'terminal', desc: 'Terminal control and utilities', color: 'var(--theme-bright-purple)' },
      { name: 'net', desc: 'Network requests and data', color: 'var(--theme-bright-cyan)' },
      { name: 'theme', desc: 'Customise terminal appearance', color: 'var(--theme-bright-red)' },
      { name: 'project', desc: 'Project links and information', color: 'var(--theme-green)' }
    ];
    
    categoryOverview.forEach(cat => {
      output += `<div style="margin: 10px 0;">`;
      output += `<span style="color: ${cat.color}; font-weight: bold;">help ${cat.name}</span> - `;
      output += `<span style="color: var(--theme-white);">${cat.desc}</span>`;
      output += '</div>';
    });
    
    output += `\n<span style="color: var(--theme-cyan);">Examples:</span>`;
    output += `\n<span style="color: var(--theme-yellow);">  help fs</span> - Show file system commands`;
    output += `\n<span style="color: var(--theme-yellow);">  help net</span> - Show network commands`;
    output += `\n<span style="color: var(--theme-yellow);">  ls --help</span> - Detailed help for specific command`;
    
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
  theme set swamphen`;
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
    // Pass abort controller to network commands and neofetch
    if (['curl', 'weather', 'stock', 'neofetch'].includes(command) && abortController) {
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
