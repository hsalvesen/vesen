import packageJson from '../../package.json';
import themes from '../../themes.json';
import { history, commandHistory } from '../stores/history';
import { systemCommands } from './commands/system';
import { fileSystemCommands } from './commands/fileSystem';
import { networkCommands } from './commands/network';
import { demoCommands, isDemoActive, processDemoCommand, stopDemoViaInterrupt } from './commands/demo';
import { theme } from '../stores/theme';
import { get } from 'svelte/store';
import { virtualFileSystem, currentPath, type VirtualFile, resolvePath } from './virtualFileSystem';
import { commandHelp, commandDescriptions } from './helpTexts';
import { playBeep } from './beep';
import { createInitialFileSystem } from './virtualFileSystem';

// Terminal-specific commands that don't fit in other modules
const terminalCommands = {
  help: (args: string[] = []) => {
    const commandList = Object.keys(commands);
    const target = args[0];
    if (target && commandList.includes(target)) {
      return getCommandHelp(target);
    }
    const categories: Record<string, string[]> = {
      'Getting Started': ['demo'],
      'Info': ['fastfetch', 'whoami'],
      'File System': ['ls', 'pwd', 'cd', 'cat', 'echo'],
      'File Operations': ['touch', 'rm', 'mkdir'],
      'Terminal': ['help', 'clear', 'reset', 'poweroff', 'history', 'sudo'],
      'Network': ['weather', 'curl', 'stock', 'speedtest'],
      'Customisation': ['theme'],
      'Project': ['repo', 'email', 'banner']
    };
    let output = '';
    output += `<div style="position: relative; border-left: 4px solid var(--theme-purple); padding: 8px 10px; border-radius: 4px; margin: 6px 0;">`;
    output += `<div style="position: absolute; inset: 0; background: var(--theme-purple); opacity: 0.08; border-radius: 4px;"></div>`;
    output += `<div style="position: relative; color: var(--theme-white);"><span style="color: var(--theme-cyan); font-weight: bold; font-family: monospace;">help &lt;command&gt;</span> or <span style="color: var(--theme-cyan); font-weight: bold; font-family: monospace;">&lt;command&gt; --help</span> for details</div>`;
    output += `</div>`;
    Object.entries(categories).forEach(([category, cmds]) => {
      const availableCommands = cmds.filter((cmd) => commandList.includes(cmd));
      if (!availableCommands.length) return;
      const line = availableCommands
        .map((cmd) => `<span style="color: var(--theme-green); font-weight: bold; font-family: monospace;">${cmd}</span>`)
        .join(`<span style="color: var(--theme-brightBlack);">, </span>`);
      output += `<div style="position: relative; padding: 6px 10px; border-radius: 4px; margin: 6px 0;">`;
      output += `<div style="position: absolute; inset: 0; background: var(--theme-yellow); opacity: 0.08; border-radius: 4px;"></div>`;
      output += `<div style="position: relative; color: var(--theme-yellow); font-weight: bold; display: inline-block; min-width: 160px;">${category}</div>`;
      output += `<div style="position: relative; display: inline; color: var(--theme-white);">${line}</div>`;
      output += `</div>`;
    });
    return output;
  },

  history: (args: string[]) => {
    const currentTheme = get(theme);
    const commandHistoryData: string[] = get(commandHistory);
    
    if (commandHistoryData.length === 0) {
      return 'No commands in history.';
    }
    
    // Calculate responsive width for history display
    const baseCharWidth = 8;
    const padding = 40;
    const availableWidth = Math.max(window.innerWidth - padding, 200);
    const terminalWidth = Math.floor(availableWidth / baseCharWidth);
    const minWidth = 30; // Minimum width for history
    const maxWidth = 100; // Maximum width for history
    const responsiveWidth = Math.min(maxWidth, Math.max(minWidth, terminalWidth));
    
    // Format history with line numbers and handle overflow
    const historyLines: string[] = [];
    
    commandHistoryData.forEach((cmd: string, index: number) => {
      const lineNumber = (index + 1).toString().padStart(4, ' ');
      // Use theme cyan for history numbers instead of brightBlack
      const prefix = `<span style="color: ${currentTheme.cyan};">${lineNumber}</span>  `;
      
      // Check if the line is too long and needs wrapping
      const totalLength = lineNumber.length + 2 + cmd.length; // +2 for spacing
      
      if (totalLength > responsiveWidth) {
        // Split long commands across multiple lines
        const commandMaxWidth = responsiveWidth - 6; // Account for line number and spacing
        const chunks: string[] = [];
        
        for (let i = 0; i < cmd.length; i += commandMaxWidth) {
          chunks.push(cmd.substring(i, i + commandMaxWidth));
        }
        
        // First line with line number
        historyLines.push(prefix + `<span style="color: ${currentTheme.white};">${chunks[0]}</span>`);
        
        // Continuation lines with proper indentation
        for (let i = 1; i < chunks.length; i++) {
          const indent = '      '; // 6 spaces to align with command text
          historyLines.push(`<span style="color: ${currentTheme.cyan};">${indent}</span><span style="color: ${currentTheme.white};">${chunks[i]}</span>`);
        }
      } else {
        // Command fits on one line
        historyLines.push(prefix + `<span style="color: ${currentTheme.white};">${cmd}</span>`);
      }
    });
    
    return historyLines.join('\n');
  },

  sudo: (args: string[]) => {
    if (args.length === 0) {
      return commandHelp.sudo;
    }
    
    // This shouldn't be reached in normal flow since Input.svelte handles sudo specially
    // But keeping as fallback
    window.open('https://www.youtube.com/watch?v=dQw4w9WgXcQ', '_blank');
    return '';
  },

  reset: () => {
    // Reset theme to default (petroica)
    const defaultTheme = themes.find((t) => t.name.toLowerCase() === 'petroica')!;
    theme.set(defaultTheme);
    
    // Reset current path to default
    currentPath.length = 0;
    currentPath.push('home', 'user');
    
    // Clear display history
    history.set([]);
    
    // Set command history to only contain banner
    commandHistory.set(['banner']);
    
    // Restore virtual file system to original state
    const initialFS = createInitialFileSystem();
    virtualFileSystem.children = initialFS.children;
    
    // Clear the terminal history and add the banner
    const bannerOutput = systemCommands.banner();
    history.set([{ command: 'banner', outputs: [bannerOutput] }]);
    
    // Return empty string since we're handling the output via history
    return '';
  }
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

  // Allow typing `exit` to cancel the demo
  // Allow typing `exit` to cancel the demo
  if (isDemoActive() && command === 'exit') {
    return stopDemoViaInterrupt();
  }

  // Check if demo is active and process demo-specific logic
  if (isDemoActive() && !hasHelpFlag) {
      const demoResponse = processDemoCommand(input.trim());
      if (demoResponse) {
          // If demo processed the command, also execute the actual command
          if (commands[command]) {
              const actualOutput = typeof commands[command] === 'function' 
                  ? commands[command](args.slice(1), abortController)
                  : commands[command];
              
              // Show actual command output first, then any demo feedback
              return Promise.resolve(actualOutput).then(output => {
                  return output + '\n\n' + demoResponse;
              });
          }
          return demoResponse;
      }
  }
  
  // Detect incorrectly concatenated help flags (e.g., 'pwd--help', 'help-h')
  const concatenatedHelp = command.match(/^([A-Za-z0-9]+)(--help|-h)$/i);
  if (concatenatedHelp) {
      const base = concatenatedHelp[1];
  
      // Try to suggest the closest valid command name
      const suggestedBase = commands[base] ? base : (findSimilarCommand(base) || base);
  
      // Beep and return only a suggestion, do NOT execute or print help
      playBeep();
      return `Did you mean <span style="color: var(--theme-cyan); font-weight: bold; font-family: monospace;">${suggestedBase} --help</span>?`;
  }

  if (hasHelpFlag) {
      return getCommandHelp(command);
  }
  
  // Execute the actual command if it exists (exact match)
  if (commands[command]) {
    // Pass abort controller to network commands and fastfetch
    if (['curl', 'weather', 'stock', 'fastfetch', 'speedtest'].includes(command) && abortController) {
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
  // function getCommandHelp(command: string): string
  function getCommandHelp(command: string): string {
    const raw = commandHelp[command];
    if (!raw) {
      return `No help available for command: ${command}`;
    }
  
    const normalized = raw.replace(/\n/g, '<br>');
    const lines = normalized.split('<br>');
  
    const usageIdx = lines.findIndex(l => /Usage:/i.test(l));
    const examplesIdx = lines.findIndex(l => /Examples:/i.test(l));
    const tipIdx = lines.findIndex(l => /Tip:/i.test(l));
  
    const explanationLines =
      usageIdx > 0 ? lines.slice(0, usageIdx) : (usageIdx === 0 ? [] : lines);
  
    const yellowStartIdx = Math.min(
      examplesIdx >= 0 ? examplesIdx : lines.length,
      tipIdx >= 0 ? tipIdx : lines.length
    );
  
  
    const usageLines =
      usageIdx >= 0 ? lines.slice(usageIdx, yellowStartIdx) : [];
  
    const examplesLines =
      examplesIdx >= 0
        ? lines.slice(examplesIdx + 1, tipIdx >= 0 ? tipIdx : lines.length)
        : [];
  
  
    const tipsLines =
      tipIdx >= 0 ? lines.slice(tipIdx + 1) : [];
  
    const stripLabel = (line: string, label: 'Usage' | 'Examples' | 'Tip') =>
      line
        .replace(new RegExp(`<span[^>]*>${label}:<\\/span>\\s*`, 'i'), '')
        .replace(new RegExp(`${label}:\\s*`, 'i'), '');
  
    let usageContent = '';
    if (usageLines.length) {
      const cleaned = usageLines.map(line => stripLabel(line, 'Usage'));
      usageContent = `<div style="color: var(--theme-white);">${cleaned.join('<br>')}</div>`;
      const cleaned = usageLines.map(line => stripLabel(line, 'Usage'));
      usageContent = `<div style="color: var(--theme-white);">${cleaned.join('<br>')}</div>`;
    }
  
  
    let examplesContent = '';
    if (examplesLines.length) {
    if (examplesLines.length) {
      examplesContent += `<div style="color: var(--theme-yellow); font-weight: bold; margin-bottom: 4px;">Examples:</div>`;
      examplesContent += `<div style="color: var(--theme-white);">${examplesLines.join('<br>')}</div>`;
      examplesContent += `<div style="color: var(--theme-white);">${examplesLines.join('<br>')}</div>`;
    }
  
  
    let tipsContent = '';
    if (tipsLines.length) {
      tipsContent += `<div style="color: var(--theme-yellow); font-weight: bold; margin-top: 8px;">Tip:</div>`;
    if (tipsLines.length) {
      tipsContent += `<div style="color: var(--theme-yellow); font-weight: bold; margin-top: 8px;">Tip:</div>`;
      tipsContent += `<div style="color: var(--theme-white);">${tipsLines.join('<br>') || ''}</div>`;
    }
  
    let output = '';
  
    // Cyan: explanation block
    if (explanationLines.length) {
      output += `<div style="position: relative; border-left: 4px solid var(--theme-cyan); padding: 8px 10px; border-radius: 4px; margin: 8px 0;">`;
      output += `<div style="position: absolute; inset: 0; background: var(--theme-cyan); opacity: 0.12; border-radius: 4px;"></div>`;
      output += `<div style="position: relative; color: var(--theme-white);">${explanationLines.join('<br>')}</div>`;
      output += `</div>`;
    }
  
    // Purple: usage block
    if (usageContent) {
      output += `<div style="position: relative; border-left: 4px solid var(--theme-purple); padding: 8px 10px; border-radius: 4px; margin: 8px 0;">`;
      output += `<div style="position: absolute; inset: 0; background: var(--theme-purple); opacity: 0.12; border-radius: 4px;"></div>`;
      output += `<div style="position: relative; color: var(--theme-purple); font-weight: bold; margin-bottom: 4px;">Usage:</div>`;
      output += `<div style="position: relative; color: var(--theme-white);">${usageContent}</div>`;
      output += `</div>`;
    }
  
    // Yellow: examples and tips in a single block
    if (examplesContent || tipsContent) {
      output += `<div style="position: relative; border-left: 4px solid var(--theme-yellow); padding: 8px 10px; border-radius: 4px; margin: 8px 0;">`;
      output += `<div style="position: absolute; inset: 0; background: var(--theme-yellow); opacity: 0.12; border-radius: 4px;"></div>`;
      output += `<div style="position: relative;">${examplesContent}${tipsContent}</div>`;
      output += `</div>`;
    }
  
    return output;
  }

  // Combine all commands
  // export const commands (composition object)
  export const commands: Record<string, (args: string[], abortController?: AbortController) => Promise<string> | string> = {
  ...systemCommands,
  ...fileSystemCommands,
  ...networkCommands,
  ...terminalCommands,
  ...demoCommands,
  ...projectCommands
  };
