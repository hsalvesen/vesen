import packageJson from '../../package.json';
import themes from '../../themes.json';
import { history } from '../stores/history';
import { systemCommands } from './commands/system';
import { fileSystemCommands } from './commands/fileSystem';
import { networkCommands } from './commands/network';
import { theme } from '../stores/theme';
import { get } from 'svelte/store';
// Add this import to fix the virtualFileSystem reference
import { virtualFileSystem, currentPath, type VirtualFile, resolvePath } from './virtualFileSystem';

const hostname = window.location.hostname;

// Terminal-specific commands that don't fit in other modules
const terminalCommands = {
  help: () => {
    const currentTheme = get(theme);
    const commandList = Object.keys(commands);
    
    // Group commands by category for better organization
    const categories: Record<string, string[]> = {
      'System Info': ['neofetch', 'hostname', 'whoami', 'date'],
      'File System': ['ls', 'pwd', 'cd', 'cat', 'touch', 'rm'],
      'Terminal': ['help', 'clear', 'reset', 'echo', 'exit'],
      'Network': ['weather', 'curl'],
      'Customisation': ['theme'],
      'Project': ['repo', 'email', 'banner']
    };
    
    let output = `<div style="color: ${currentTheme.cyan}; font-weight: bold; margin-bottom: 15px;">Available Commands:</div>`;
    
    // Create five-column layout with manual distribution for better balance
    output += `<div style="display: flex; gap: 15px;">`;
    
    // Manually distribute categories for better balance across five columns
    const columnDistribution = [
      ['System Info'],              // Column 1
      ['File System'],              // Column 2
      ['Terminal'],                 // Column 3
      ['Network', 'Customisation'], // Column 4
      ['Project']                   // Column 5
    ];
    
    // Generate five columns with manual distribution
    columnDistribution.forEach(columnCategories => {
      output += `<div style="flex: 1; min-height: 100px;">`;
      
      columnCategories.forEach(categoryName => {
        if (categories[categoryName]) {
          const availableCommands = categories[categoryName].filter(cmd => commandList.includes(cmd));
          if (availableCommands.length > 0) {
            output += `<div style="margin-bottom: 12px;">`;
            output += `<span style="color: ${currentTheme.yellow}; font-weight: bold;">${categoryName}:</span><br>`;
            
            availableCommands.forEach(cmd => {
              output += `  <span style="color: ${currentTheme.white};">${cmd}</span><br>`;
            });
            output += `</div>`;
          }
        }
      });
      output += `</div>`;
    });
    
    output += `</div>`;
    
    return output;
  },
  
  clear: () => {
    history.set([]);
    return '';
  },
  
  echo: (args: string[]) => {
    if (args.length === 0) {
      return 'Usage: echo [text] [> filename]\nExamples:\n  echo "Hello World"           - display text\n  echo "Content" > file.txt    - write text to file\n  echo "Line 1" > myfile.txt   - create/overwrite file\n  echo > empty.txt             - create empty file\nTip: Use quotes for text with spaces';
    }
    
    // Check for redirection operator >
    const redirectIndex = args.indexOf('>');
    
    if (redirectIndex !== -1) {
      // Handle file redirection
      if (redirectIndex === args.length - 1) {
        return 'echo: syntax error: missing filename after >';
      }
      
      let content = args.slice(0, redirectIndex).join(' ');
      const filename = args[redirectIndex + 1];
      
      // Remove surrounding quotes from content
      if ((content.startsWith('"') && content.endsWith('"')) || 
          (content.startsWith("'") && content.endsWith("'"))) {
        content = content.slice(1, -1);
      }
      
      // Resolve the target file path
      const targetPath = resolvePath(filename);
      const fileName = targetPath[targetPath.length - 1];
      const parentPath = targetPath.slice(0, -1);
  
      // Navigate to parent directory
      let parent = virtualFileSystem;
      for (const segment of parentPath) {
        if (parent.children && parent.children[segment]) {
          parent = parent.children[segment];
        } else {
          return `echo: cannot create '${filename}': No such file or directory`;
        }
      }
  
      if (!parent.children) {
        return `echo: cannot create '${filename}': Parent is not a directory`;
      }
  
      // Check if target exists and is a directory
      if (parent.children[fileName] && parent.children[fileName].type === 'directory') {
        return `echo: cannot write to '${filename}': Is a directory`;
      }
  
      // Create or overwrite the file
      parent.children[fileName] = {
        name: fileName,
        type: 'file',
        content: content
      };
  
      const currentTheme = get(theme);
      return `<span style="color: ${currentTheme.green};">Content written to '${filename}'</span>`;
    }
  
    // Regular echo behavior - remove surrounding quotes
    let output = args.join(' ');
    if ((output.startsWith('"') && output.endsWith('"')) || 
        (output.startsWith("'") && output.endsWith("'"))) {
      output = output.slice(1, -1);
    }
    
    return output;
  },
  
  exit: () => {
    window.close();
    return 'Goodbye!';
  },
  
  sudo: (args: string[]) => {
    return `Permission denied: unable to run the command '${args[0]}' as root.`;
  }
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

// Combine all commands
export const commands: Record<string, (args: string[]) => Promise<string> | string> = {
  ...systemCommands,
  ...fileSystemCommands,
  ...networkCommands,
  ...terminalCommands,
  ...projectCommands
};

// Re-export virtualFileSystem and currentPath from the dedicated module
export { virtualFileSystem, currentPath } from './virtualFileSystem';