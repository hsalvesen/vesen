import { virtualFileSystem, currentPath, type VirtualFile, resolvePath } from '../virtualFileSystem';
import { history } from '../../stores/history';
import { commandHelp } from '../helpTexts';
import { playBeep } from '../beep';
import { fetchText, isNetError } from '../../services/net';
import { cancelledNotice, errorLine } from '../notice';
import { escapeHtml } from '../../output/escape';
import { transcriptColumns } from '../../platform/measure';

/**
 * Loads a file that public/ serves, such as /README.md. Each request has the default 8 s deadline
 * and the command's cancel. Only a missing file (an HTTP error) moves on to the next candidate path;
 * a timeout, a cancel or a failed connection would fail the same way for every path.
 */
async function loadRealFile(filePath: string, signal?: AbortSignal): Promise<string> {
  const possiblePaths = [
    filePath,
    filePath.startsWith('/') ? '.' + filePath : filePath,
    filePath.startsWith('/') ? filePath.substring(1) : filePath
  ];

  let lastError: unknown;
  for (const path of possiblePaths) {
    try {
      return await fetchText(path, { signal });
    } catch (error) {
      lastError = error;
      if (!isNetError(error) || error.kind !== 'http') break;
    }
  }
  throw lastError;
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

/**
 * Finds where echo's output redirect starts: the first `>` outside quotes that begins a word or
 * sits in a word without a `<` before it. So `echo hi > f` and `echo hi>f` redirect, while the
 * `>` of a tag such as `<b>x</b>` is text. Unbalanced quotes are ignored rather than swallowing
 * the rest of the line. The shell kernel's lexer replaces this.
 */
function findRedirect(text: string, respectQuotes = true): { index: number; append: boolean } | null {
  let quote: string | null = null;
  let wordHasAngle = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quote !== null) {
      if (c === quote) quote = null;
      continue;
    }
    if (/\s/.test(c)) {
      wordHasAngle = false;
    } else if (respectQuotes && (c === '"' || c === "'")) {
      quote = c;
    } else if (c === '<') {
      wordHasAngle = true;
    } else if (c === '>') {
      const startsWord = i === 0 || /\s/.test(text[i - 1]);
      if (startsWord || !wordHasAngle) return { index: i, append: text[i + 1] === '>' };
    }
  }
  return quote !== null && respectQuotes ? findRedirect(text, false) : null;
}

export const fileSystemCommands = {
  pwd: () => {
    return escapeHtml('/' + currentPath.join('/'));
  },
  
  ls: (args: string[]) => {
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
        playBeep();
        const pathStr = pathArgs.length === 0 ? '.' : pathArgs[0];
        return errorLine(`ls: cannot access '${pathStr}': No such file or directory`);
      }
    }
    
    if (current.type !== 'directory') {
      const pathStr = pathArgs.length === 0 ? '.' : pathArgs[0];
      return errorLine(`ls: cannot access '${pathStr}': Not a directory`);
    }
    
    if (!current.children) {
      return '';
    }
    
    // Filter out hidden files unless -a flag is used. Names are text: a file may be called <b>.
    const items = Object.values(current.children)
      .filter((item: VirtualFile) => showHidden || !item.name.startsWith('.'))
      .map((item: VirtualFile) => {
        // Directories in the link role, files in strong text: roles, so a listing follows the theme.
        const isDirectory = item.type === 'directory';
        const suffix = isDirectory ? '/' : '';
        return {
          html: isDirectory
            ? `<span style="color: var(--role-link); font-weight: bold;">${escapeHtml(item.name)}${suffix}</span>`
            : `<span class="out-strong">${escapeHtml(item.name)}</span>`,
          width: item.name.length + suffix.length,
        };
      });
    
    // The transcript's width in cells
    const terminalWidth = transcriptColumns(window);
    const minWidth = 20; // Minimum characters per line
    const maxWidth = 120; // Maximum characters per line
    const responsiveWidth = Math.min(maxWidth, Math.max(minWidth, terminalWidth));
    
    // Group items into lines based on responsive width
    const lines: string[] = [];
    let currentLine: string[] = [];
    let currentLineLength = 0;
    
    for (const item of items) {
      const itemLength = item.width + 2; // +2 for spacing
      
      // If adding this item would exceed the line width, start a new line
      if (currentLineLength + itemLength > responsiveWidth && currentLine.length > 0) {
        lines.push(currentLine.join('  '));
        currentLine = [item.html];
        currentLineLength = itemLength;
      } else {
        currentLine.push(item.html);
        currentLineLength += itemLength;
      }
    }
    
    // Add the last line if it has items
    if (currentLine.length > 0) {
      lines.push(currentLine.join('  '));
    }
    
    return lines.join('\n');
  },
  
  cat: async (args: string[], signal?: AbortSignal) => {
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
            playBeep();
            return errorLine(`cat: ${args[0]}: No such file or directory`, `Did you mean ${similarFile}?`);
          }
        }
        playBeep();
        return errorLine(`cat: ${args[0]}: No such file or directory`);
      }
    }
    
    if (current.type !== 'file') {
      return errorLine(`cat: ${args[0]}: Is a directory`);
    }
    
    let content = '';
    // Only the owner's styled documents are markup; any other file shows exactly as written.
    const isOwnerHtml = current.format === 'html' && Boolean(current.filePath);
    
    // Handle files with filePath property
    if (current.filePath) {
      try {
        content = await loadRealFile(current.filePath, signal);
      } catch (error) {
        if (signal?.aborted || (isNetError(error) && error.kind === 'abort')) return cancelledNotice('cat');
        playBeep();
        const reason = isNetError(error) ? error.message : 'the file could not be read';
        return errorLine(`cat: ${args[0]}: ${reason}`);
      }
    } else {
      content = current.content || '';
    }
    
    // Convert newlines to HTML line breaks for proper display in web terminal
    return (isOwnerHtml ? content : escapeHtml(content)).replace(/\n/g, '<br>');
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
            playBeep();
            return errorLine(`cd: ${args[0]}: No such file or directory`, `Did you mean ${similarDir}?`);
          }
        }
        playBeep();
        return errorLine(`cd: ${args[0]}: No such file or directory`);
      }
    }
    
    if (current.type !== 'directory') {
      return errorLine(`cd: ${args[0]}: Not a directory`);
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
        playBeep();
        return errorLine(`rm: cannot remove '${targetFile}': No such file or directory`);
      }
    }
    
    if (!parent.children || !parent.children[fileName]) {
      playBeep();
      return errorLine(`rm: cannot remove '${targetFile}': No such file or directory`);
    }
    
    const target = parent.children[fileName];
    
    if (target.type === 'directory' && !recursive) {
      return errorLine(`rm: cannot remove '${targetFile}': Is a directory (use -r to remove directories)`);
    }
    
    // Delete the file or directory
    delete parent.children[fileName];
    
    return `rm: removed '${escapeHtml(targetFile)}'`;
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
        playBeep();
        return errorLine(`touch: cannot touch '${args[0]}': No such file or directory`);
      }
    }
    
    if (!parent.children) {
      return errorLine(`touch: cannot touch '${args[0]}': Parent is not a directory`);
    }
    
    // Check if file already exists
    if (parent.children[fileName]) {
      if (parent.children[fileName].type === 'directory') {
        return errorLine(`touch: cannot touch '${args[0]}': Is a directory`);
      }
      return `touch: '${escapeHtml(args[0])}' timestamp updated`;
    }
    
    // Create new empty file
    parent.children[fileName] = {
      name: fileName,
      type: 'file',
      content: ''
    };
    
    return `touch: created '${escapeHtml(args[0])}'`;
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
        playBeep();
        return errorLine(`mkdir: cannot create directory '${args[0]}': No such file or directory`);
      }
    }

    if (!parent.children) {
      return errorLine(`mkdir: cannot create directory '${args[0]}': Parent is not a directory`);
    }

    // Check if directory already exists
    if (parent.children[dirName]) {
      return errorLine(`mkdir: cannot create directory '${args[0]}': File exists`);
    }

    // Create new directory
    parent.children[dirName] = {
      name: dirName,
      type: 'directory',
      children: {}
    };

    return `mkdir: created directory '${escapeHtml(args[0])}'`;
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
    const redirect = findRedirect(fullCommand);
    
    if (redirect !== null) {
      const isAppend = redirect.append;
      const redirectIndex = redirect.index;
      // Handle file redirection
      const beforeRedirect = fullCommand.substring(0, redirectIndex).trim();
      const afterRedirect = fullCommand.substring(redirectIndex + (isAppend ? 2 : 1)).trim();
      
      if (!afterRedirect) {
        return errorLine(`echo: syntax error: missing filename after ${isAppend ? '>>' : '>'}`);
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
          return errorLine(`echo: cannot create '${filename}': No such file or directory`);
        }
      }
  
      if (!parent.children) {
        return errorLine(`echo: cannot create '${filename}': Parent is not a directory`);
      }
  
      // Check if target exists and is a directory
      if (parent.children[fileName] && parent.children[fileName].type === 'directory') {
        return errorLine(`echo: cannot write to '${filename}': Is a directory`);
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
  
      const action = isAppend ? 'appended to' : 'written to';
      return `<span style="color: var(--role-ok);">Content ${action} '${escapeHtml(filename)}'</span>`;
    }
  
    // Regular echo behavior - remove surrounding quotes and process escape sequences
    let output = args.join(' ');
    if ((output.startsWith('"') && output.endsWith('"')) || 
        (output.startsWith("'") && output.endsWith("'"))) {
      output = output.slice(1, -1);
    }
    
    // Process escape sequences for regular echo output. The text is escaped first, so tags
    // typed at the prompt print as typed and only these sequences become markup.
    output = escapeHtml(output).replace(/\\n/g, '<br>')
                .replace(/\\t/g, '&nbsp;&nbsp;&nbsp;&nbsp;')
                .replace(/\\r/g, '')
                .replace(/\\\\/g, '\\');
    
    return output;
  },

  poweroff: (args: string[]) => {

    // Check for help flag
    const hasHelpFlag = args.includes('--help') || args.includes('-h');
    
    if (hasHelpFlag) {
      return `<span style="color: var(--theme-cyan); font-weight: bold;">poweroff</span> - End terminal session<br><span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span> poweroff<br><br><span style="color: var(--theme-cyan); font-weight: bold;">Description:</span> Attempts to close the window, then triggers shutdown sequence.`;
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
    return `<span style="color: var(--role-warn);">Terminating session...</span>`;
  }
  
};