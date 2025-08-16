import { theme } from '../../stores/theme';
import { get } from 'svelte/store';
import { virtualFileSystem, currentPath, type VirtualFile, resolvePath } from '../virtualFileSystem';
import { history, commandHistory } from '../../stores/history';
import { systemCommands } from './system';
import themes from '../../../themes.json';
import { commandHelp } from '../helpTexts';
import { createInitialFileSystem } from '../virtualFileSystem';

// Helper function to load real file content
async function loadRealFile(filePath: string): Promise<string> {
  try {
    // Try multiple possible paths for different environments
    const possiblePaths = [
      filePath,
      filePath.startsWith('/') ? '.' + filePath : filePath,
      filePath.startsWith('/') ? filePath.substring(1) : filePath
    ];
    
    for (const path of possiblePaths) {
      try {
        const response = await fetch(path);
        if (response.ok) {
          return await response.text();
        }
      } catch (e) {
        // Continue to next path
      }
    }
    
    throw new Error(`Failed to load file from any path: ${possiblePaths.join(', ')}`);
  } catch (error) {
    return `Error loading file: ${error}`;
  }
}

// Helper function to find similar files/directories with case-insensitive matching
function findSimilarFile(target: string, directory: VirtualFile): string | null {
  if (!directory.children) return null;
  
  const targetLower = target.toLowerCase();
  const children = Object.keys(directory.children);
  
  // First try exact case-insensitive match
  for (const child of children) {
    if (child.toLowerCase() === targetLower) {
      return child;
    }
  }
  
  // If no exact match, try partial matches (starts with)
  for (const child of children) {
    if (child.toLowerCase().startsWith(targetLower)) {
      return child;
    }
  }
  
  return null;
}

export const fileSystemCommands = {
  pwd: () => {
    return '/' + currentPath.join('/');
  },
  
  ls: (args: string[]) => {
    const currentTheme = get(theme);
    let targetPath: string[];
    
    // Check for -a flag to show hidden files
    const showHidden = args.includes('-a') || args.includes('--all');
    
    // Filter out flags to get the actual path argument
    const pathArgs = args.filter(arg => !arg.startsWith('-'));
    
    if (pathArgs.length === 0) {
      targetPath = currentPath;
    } else {
      targetPath = resolvePath(pathArgs[0]);
    }
    
    let current = virtualFileSystem;
    for (const segment of targetPath) {
      if (current.children && current.children[segment]) {
        current = current.children[segment];
      } else {
        const pathStr = pathArgs.length === 0 ? '.' : pathArgs[0];
        return `ls: cannot access '${pathStr}': No such file or directory`;
      }
    }
    
    if (current.type !== 'directory') {
      const pathStr = pathArgs.length === 0 ? '.' : pathArgs[0];
      return `ls: cannot access '${pathStr}': Not a directory`;
    }
    
    if (!current.children) {
      return '';
    }
    
    // Filter out hidden files unless -a flag is used
    const items = Object.values(current.children)
      .filter((item: VirtualFile) => showHidden || !item.name.startsWith('.'))
      .map((item: VirtualFile) => {
        const color = item.type === 'directory' ? currentTheme.brightBlue : currentTheme.white;
        const suffix = item.type === 'directory' ? '/' : '';
        return `<span style="color: ${color}; font-weight: ${item.type === 'directory' ? 'bold' : 'normal'};">${item.name}${suffix}</span>`;
      });
    
    // Improved mobile-responsive terminal width calculation
    const baseCharWidth = 8; // Approximate character width in pixels
    const padding = 40; // Account for terminal padding
    const availableWidth = Math.max(window.innerWidth - padding, 200); // Minimum 200px
    const terminalWidth = Math.floor(availableWidth / baseCharWidth);
    const minWidth = 20; // Minimum characters per line
    const maxWidth = 120; // Maximum characters per line
    const responsiveWidth = Math.min(maxWidth, Math.max(minWidth, terminalWidth));
    
    // Group items into lines based on responsive width
    const lines: string[] = [];
    let currentLine: string[] = [];
    let currentLineLength = 0;
    
    for (const item of items) {
      // Estimate item length (removing HTML tags for calculation)
      const itemText = item.replace(/<[^>]*>/g, '');
      const itemLength = itemText.length + 2; // +2 for spacing
      
      // If adding this item would exceed the line width, start a new line
      if (currentLineLength + itemLength > responsiveWidth && currentLine.length > 0) {
        lines.push(currentLine.join('  '));
        currentLine = [item];
        currentLineLength = itemLength;
      } else {
        currentLine.push(item);
        currentLineLength += itemLength;
      }
    }
    
    // Add the last line if it has items
    if (currentLine.length > 0) {
      lines.push(currentLine.join('  '));
    }
    
    return lines.join('\n');
  },
  
  cat: async (args: string[]) => {
    if (args.length === 0) {
      return commandHelp.cat;
    }
    
    const targetPath = resolvePath(args[0]);
    
    let current = virtualFileSystem;
    for (let i = 0; i < targetPath.length; i++) {
      const segment = targetPath[i];
      if (current.children && current.children[segment]) {
        current = current.children[segment];
      } else {
        // Check for case sensitivity issue
        if (current.children) {
          const similarFile = findSimilarFile(segment, current);
          if (similarFile) {
            const currentTheme = get(theme);
            return `cat: ${args[0]}: No such file or directory. Did you mean <span style="color: var(--theme-cyan); font-weight: bold;">${similarFile}</span>?`;
          }
        }
        return `cat: ${args[0]}: No such file or directory`;
      }
    }
    
    if (current.type !== 'file') {
      return `cat: ${args[0]}: Is a directory`;
    }
    
    let content = '';
    
    // Handle files with filePath property
    if (current.filePath) {
      try {
        content = await loadRealFile(current.filePath);
      } catch (error) {
        return `cat: ${args[0]}: Error reading file`;
      }
    } else {
      content = current.content || '';
    }
    
    // Convert newlines to HTML line breaks for proper display in web terminal
    return content.replace(/\n/g, '<br>');
  },
  
  cd: (args: string[]) => {
    if (args.length === 0) {
      // Go to home directory
      currentPath.length = 0;
      currentPath.push('home', 'user');
      return '';
    }
    
    const targetPath = resolvePath(args[0]);
    
    let current = virtualFileSystem;
    for (let i = 0; i < targetPath.length; i++) {
      const segment = targetPath[i];
      if (current.children && current.children[segment]) {
        current = current.children[segment];
      } else {
        // Check for case sensitivity issue
        if (current.children) {
          const similarDir = findSimilarFile(segment, current);
          if (similarDir && current.children[similarDir].type === 'directory') {
            const currentTheme = get(theme);
            return `cd: ${args[0]}: No such file or directory. Did you mean <span style="color: var(--theme-cyan); font-weight: bold;">${similarDir}</span>?`;
          }
        }
        return `cd: ${args[0]}: No such file or directory`;
      }
    }
    
    if (current.type !== 'directory') {
      return `cd: ${args[0]}: Not a directory`;
    }
    
    // Update current path
    currentPath.length = 0;
    currentPath.push(...targetPath);
    return '';
  },
  
  rm: (args: string[]) => {
    if (args.length === 0) {
      return commandHelp.rm;
    }
    
    let recursive = false;
    let targetFile = args[0];
    
    // Check for recursive flag
    if (args[0] === '-r' || args[0] === '--recursive') {
      if (args.length < 2) {
        return 'rm: missing operand after \'-r\'';
      }
      recursive = true;
      targetFile = args[1];
    }
    
    const targetPath = resolvePath(targetFile);
    const fileName = targetPath[targetPath.length - 1];
    const parentPath = targetPath.slice(0, -1);
    
    // Navigate to parent directory
    let parent = virtualFileSystem;
    for (const segment of parentPath) {
      if (parent.children && parent.children[segment]) {
        parent = parent.children[segment];
      } else {
        return `rm: cannot remove '${targetFile}': No such file or directory`;
      }
    }
    
    if (!parent.children || !parent.children[fileName]) {
      return `rm: cannot remove '${targetFile}': No such file or directory`;
    }
    
    const target = parent.children[fileName];
    
    if (target.type === 'directory' && !recursive) {
      return `rm: cannot remove '${targetFile}': Is a directory (use -r to remove directories)`;
    }
    
    // Delete the file or directory
    delete parent.children[fileName];
    
    return `rm: removed '${targetFile}'`;
  },
  
  touch: (args: string[]) => {
    if (args.length === 0) {
      return commandHelp.touch;
    }
    
    const targetPath = resolvePath(args[0]);
    const fileName = targetPath[targetPath.length - 1];
    const parentPath = targetPath.slice(0, -1);
    
    // Navigate to parent directory
    let parent = virtualFileSystem;
    for (const segment of parentPath) {
      if (parent.children && parent.children[segment]) {
        parent = parent.children[segment];
      } else {
        return `touch: cannot touch '${args[0]}': No such file or directory`;
      }
    }
    
    if (!parent.children) {
      return `touch: cannot touch '${args[0]}': Parent is not a directory`;
    }
    
    // Check if file already exists
    if (parent.children[fileName]) {
      if (parent.children[fileName].type === 'directory') {
        return `touch: cannot touch '${args[0]}': Is a directory`;
      }
      return `touch: '${args[0]}' timestamp updated`;
    }
    
    // Create new empty file
    parent.children[fileName] = {
      name: fileName,
      type: 'file',
      content: ''
    };
    
    return `touch: created '${args[0]}'`;
  },
  
  mkdir: (args: string[]) => {
    if (args.length === 0) {
      return commandHelp.mkdir;
    }

    const targetPath = resolvePath(args[0]);
    const dirName = targetPath[targetPath.length - 1];
    const parentPath = targetPath.slice(0, -1);

    // Navigate to parent directory
    let parent = virtualFileSystem;
    for (const segment of parentPath) {
      if (parent.children && parent.children[segment]) {
        parent = parent.children[segment];
      } else {
        return `mkdir: cannot create directory '${args[0]}': No such file or directory`;
      }
    }

    if (!parent.children) {
      return `mkdir: cannot create directory '${args[0]}': Parent is not a directory`;
    }

    // Check if directory already exists
    if (parent.children[dirName]) {
      return `mkdir: cannot create directory '${args[0]}': File exists`;
    }

    // Create new directory
    parent.children[dirName] = {
      name: dirName,
      type: 'directory',
      children: {}
    };

    return `mkdir: created directory '${args[0]}'`;
  },

  clear: () => {
    history.set([]);  // Only clear display history
    // commandHistory remains intact for navigation
    return '';
  },
  
  echo: (args: string[]) => {
    if (args.length === 0) {
      return commandHelp.echo;
    }
    
    // Join args first, then parse for redirection operators
    const fullCommand = args.join(' ');
    
    // Check for redirection operators
    let isAppend = false;
    let redirectIndex = -1;
    
    // Look for >> first (append)
    if (fullCommand.includes('>>')) {
      isAppend = true;
      redirectIndex = fullCommand.indexOf('>>');
    } else if (fullCommand.includes('>')) {
      // Look for > (overwrite)
      redirectIndex = fullCommand.indexOf('>');
    }
    
    if (redirectIndex !== -1) {
      // Handle file redirection
      const beforeRedirect = fullCommand.substring(0, redirectIndex).trim();
      const afterRedirect = fullCommand.substring(redirectIndex + (isAppend ? 2 : 1)).trim();
      
      if (!afterRedirect) {
        return `echo: syntax error: missing filename after ${isAppend ? '>>' : '>'}`;
      }
      
      // Extract filename (first word after redirection)
      const filename = afterRedirect.split(' ')[0];
      let content = beforeRedirect;
      
      // Remove surrounding quotes from content
      if ((content.startsWith('"') && content.endsWith('"')) || 
          (content.startsWith("'") && content.endsWith("'"))) {
        content = content.slice(1, -1);
      }
      
      // Process escape sequences
      content = content.replace(/\\n/g, '\n')
                    .replace(/\\t/g, '\t')
                    .replace(/\\r/g, '\r')
                    .replace(/\\\\/g, '\\');
      
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
  
      // Create, overwrite, or append to the file
      if (isAppend && parent.children[fileName] && parent.children[fileName].type === 'file') {
        // Append to existing file
        const existingContent = parent.children[fileName].content || '';
        parent.children[fileName].content = existingContent + (existingContent ? '\n' : '') + content;
      } else {
        // Create or overwrite the file
        parent.children[fileName] = {
          name: fileName,
          type: 'file',
          content: content
        };
      }
  
      const currentTheme = get(theme);
      const action = isAppend ? 'appended to' : 'written to';
      return `<span style="color: ${currentTheme.green};">Content ${action} '${filename}'</span>`;
    }
  
    // Regular echo behavior - remove surrounding quotes and process escape sequences
    let output = args.join(' ');
    if ((output.startsWith('"') && output.endsWith('"')) || 
        (output.startsWith("'") && output.endsWith("'"))) {
      output = output.slice(1, -1);
    }
    
    // Process escape sequences for regular echo output
    output = output.replace(/\\n/g, '<br>')
                .replace(/\\t/g, '&nbsp;&nbsp;&nbsp;&nbsp;')
                .replace(/\\r/g, '')
                .replace(/\\\\/g, '\\');
    
    return output;
  },

  reset: () => {
    // Reset theme to default (pinkrobin)
    const defaultTheme = themes.find((t) => t.name.toLowerCase() === 'pinkrobin')!;
    theme.set(defaultTheme);
    
    // Reset current path to default
    currentPath.length = 0;
    currentPath.push('home', 'user');
    
    // Clear display history but preserve command navigation history
    history.set([])
    
    // Restore virtual file system to original state
    const initialFS = createInitialFileSystem();
    virtualFileSystem.children = initialFS.children;
    
    // Clear the terminal history and add the banner
    const bannerOutput = systemCommands.banner();
    history.set([{ command: 'banner', outputs: [bannerOutput] }]);
    
    // Return empty string since we're handling the output via history
    return '';
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
  
  exit: (args: string[]) => {
    const currentTheme = get(theme);
    
    // Check for help flag
    const hasHelpFlag = args.includes('--help') || args.includes('-h');
    
    if (hasHelpFlag) {
      return `<span style="color: ${currentTheme.cyan}; font-weight: bold;">exit</span> - End terminal session<br><span style="color: ${currentTheme.yellow}; font-weight: bold;">Usage:</span> exit<br><br><span style="color: ${currentTheme.cyan}; font-weight: bold;">Description:</span> Attempts to close the window, then triggers shutdown sequence.`;
    }
    
    // Disable all inputs immediately to prevent further commands
    // Hide the entire input section (prompt + input) immediately
    const inputContainers = document.querySelectorAll('.flex.flex-row.items-center.gap-1');
    inputContainers.forEach(container => {
      const containerElement = container as HTMLElement;
      // Check if this container has both Ps1 and Input components
      if (containerElement.querySelector('h1') && containerElement.querySelector('input')) {
        containerElement.style.display = 'none';
      }
    });
    
    // Also disable inputs as backup
    const inputs = document.querySelectorAll('input');
    inputs.forEach(input => {
      (input as HTMLInputElement).disabled = true;
    });
    
    // Function to trigger shutdown sequence
    const triggerShutdown = () => {
      setTimeout(() => {
        document.body.style.transition = 'all 2s ease-out';
        document.body.style.opacity = '0';
        document.body.style.transform = 'scale(0.8)';
        
        setTimeout(() => {
          document.body.innerHTML = `
            <div style="
              display: flex;
              justify-content: center;
              align-items: center;
              height: 100vh;
              background: #000;
              color: #fff;
              font-family: 'Cascadia Code', monospace;
              font-size: 24px;
              text-align: center;
            ">
              <div>
                <div style="margin-bottom: 20px;">🔌</div>
                <div>System Shutdown Complete</div>
                <div style="font-size: 14px; margin-top: 10px; opacity: 0.7;">It is now safe to close this tab</div>
              </div>
            </div>
          `;
        }, 2000);
      }, 1000);
    };
    
    // Try to close the window (only works if opened by JavaScript)
    window.close();
    
    // Check if window is still open after a brief delay (fallback to shutdown)
    setTimeout(() => {
      try {
        // If we can still access the document, the window didn't close
        if (document && document.body) {
          triggerShutdown();
        }
      } catch (e) {
        // Window was closed successfully, do nothing
      }
    }, 100);
    
    // Return immediate feedback
    return `<span style="color: ${currentTheme.yellow};">Terminating session...</span>`;
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
      const prefix = `<span style="color: ${currentTheme.brightBlack};">${lineNumber}</span>  `;
      
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
          historyLines.push(`<span style="color: ${currentTheme.brightBlack};">${indent}</span><span style="color: ${currentTheme.white};">${chunks[i]}</span>`);
        }
      } else {
        // Command fits on one line
        historyLines.push(prefix + `<span style="color: ${currentTheme.white};">${cmd}</span>`);
      }
    });
    
    return historyLines.join('\n');
  }
};