import { legacyFs, currentDirectory } from '../virtualFileSystem';
import { commandHelp } from '../helpTexts';
import { playBeep } from '../beep';
import { errorLine } from '../notice';
import { escapeHtml } from '../../output/escape';
import { transcriptColumns } from '../../platform/measure';
import { rmRefusal, strerror } from '../../vfs/errors';
import { VfsError, type VfsCode } from '../../vfs/types';

// The legacy file commands, reading and writing through the VFS (src/vfs/vfs.ts) so they share
// its permissions, symbolic links, /proc and persistence. Their output is unchanged until each
// is ported to a spec in src/commands/files.

const HOME = '/home/guest';

/** A path typed at the prompt, as an absolute path. */
function absolute(path: string): string {
  return legacyFs().resolve(path, currentDirectory(), HOME);
}

/** The code of a VFS error; anything else is rethrown. */
function codeOf(error: unknown): VfsCode {
  if (error instanceof VfsError) return error.code;
  throw error;
}

/** The folder a path is in, as an absolute path. */
function parentOf(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut <= 0 ? '/' : path.slice(0, cut);
}

// Helper function to find similar files/directories with case-insensitive matching
function findSimilarFile(target: string, directory: string, want: 'any' | 'directory' = 'any'): string | null {
  const fs = legacyFs();
  let children: string[];
  try {
    children = fs.readdir(directory, { all: true });
  } catch {
    return null;
  }
  const isWanted = (name: string): boolean => {
    if (want === 'any') return true;
    try {
      return fs.stat(`${directory === '/' ? '' : directory}/${name}`).type === 'directory';
    } catch {
      return false;
    }
  };
  const targetLower = target.toLowerCase();

  // First try exact case-insensitive match
  for (const child of children) {
    if (child.toLowerCase() === targetLower && isWanted(child)) {
      return child;
    }
  }

  // If no exact match, try partial matches (starts with)
  for (const child of children) {
    if (child.toLowerCase().startsWith(targetLower) && isWanted(child)) {
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
  ls: (args: string[]) => {
    const fs = legacyFs();

    // Check for -a flag to show hidden files
    const showHidden = args.includes('-a') || args.includes('--all');

    // Filter out flags to get the actual path argument
    const pathArgs = args.filter(arg => !arg.startsWith('-'));
    const pathStr = pathArgs.length === 0 ? '.' : pathArgs[0];
    const target = absolute(pathStr);

    let names: string[];
    try {
      if (fs.stat(target).type !== 'directory') {
        return errorLine(`ls: cannot access '${pathStr}': Not a directory`);
      }
      names = fs.readdir(target, { all: showHidden });
    } catch (error) {
      const code = codeOf(error);
      playBeep();
      if (code === 'EACCES') return errorLine(`ls: cannot open directory '${pathStr}': Permission denied`);
      return errorLine(`ls: cannot access '${pathStr}': ${strerror(code)}`);
    }

    const isDirectory = (name: string): boolean => {
      try {
        return fs.stat(`${target === '/' ? '' : target}/${name}`).type === 'directory';
      } catch {
        return false;
      }
    };

    // Names are text: a file may be called <b>.
    const items = names.map((name) => {
      // Directories in the link role, files in strong text: roles, so a listing follows the theme.
      const directory = isDirectory(name);
      const suffix = directory ? '/' : '';
      return {
        html: directory
          ? `<span style="color: var(--role-link); font-weight: bold;">${escapeHtml(name)}${suffix}</span>`
          : `<span class="out-strong">${escapeHtml(name)}</span>`,
        width: name.length + suffix.length,
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
  
  // On a terminal the owner's styled documents are drawn by the legacy adapter from the VFS's
  // styled lines (src/commands/legacy.ts); this prints any file as the text it holds.
  cat: (args: string[]) => {
    if (args.length === 0) {
      return commandHelp.cat;
    }

    let content: string;
    const target = absolute(args[0]);
    try {
      content = legacyFs().readFile(target);
    } catch (error) {
      const code = codeOf(error);
      playBeep();
      if (code === 'ENOENT') {
        // Check for case sensitivity issue
        const similarFile = findSimilarFile(target.slice(target.lastIndexOf('/') + 1), parentOf(target));
        if (similarFile) return errorLine(`cat: ${args[0]}: No such file or directory`, `Did you mean ${similarFile}?`);
      }
      return errorLine(`cat: ${args[0]}: ${strerror(code)}`);
    }

    // Convert newlines to HTML line breaks for proper display in web terminal
    return escapeHtml(content).replace(/\n/g, '<br>');
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
    
    const fs = legacyFs();
    const target = absolute(targetFile);

    // `.`, `..` and `/` are refused before anything is touched (F020).
    const refusal = rmRefusal(targetFile, target, recursive);
    if (refusal !== null) {
      playBeep();
      return refusal.map((line) => errorLine(line)).join('\n');
    }

    try {
      if (fs.lstat(target).type === 'directory' && !recursive) {
        return errorLine(`rm: cannot remove '${targetFile}': Is a directory (use -r to remove directories)`);
      }
      fs.rm(target, { recursive });
    } catch (error) {
      const code = codeOf(error);
      playBeep();
      return errorLine(`rm: cannot remove '${targetFile}': ${strerror(code)}`);
    }
    
    return `rm: removed '${escapeHtml(targetFile)}'`;
  },
  
  touch: (args: string[]) => {
    if (args.length === 0) {
      return commandHelp.touch;
    }

    const fs = legacyFs();
    const target = absolute(args[0]);
    let existed = false;
    try {
      if (fs.stat(target).type === 'directory') {
        return errorLine(`touch: cannot touch '${args[0]}': Is a directory`);
      }
      existed = true;
    } catch {
      // Not there yet, or not reachable: touch creates it, or says why it cannot.
    }

    try {
      fs.touch(target);
    } catch (error) {
      const code = codeOf(error);
      playBeep();
      return errorLine(`touch: cannot touch '${args[0]}': ${strerror(code)}`);
    }

    return existed ? `touch: '${escapeHtml(args[0])}' timestamp updated` : `touch: created '${escapeHtml(args[0])}'`;
  },
  
  mkdir: (args: string[]) => {
    if (args.length === 0) {
      return commandHelp.mkdir;
    }

    const fs = legacyFs();
    const target = absolute(args[0]);
    try {
      fs.mkdir(target);
    } catch (error) {
      const code = codeOf(error);
      if (code !== 'EEXIST') playBeep();
      return errorLine(`mkdir: cannot create directory '${args[0]}': ${strerror(code)}`);
    }

    return `mkdir: created directory '${escapeHtml(args[0])}'`;
  },

  // The shell runs clear as an effect on the screen (Tty.clear); the entry stays so it is listed.
  clear: () => '',
  
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
      
      // Create, overwrite, or append to the file, through the VFS.
      const fs = legacyFs();
      const target = absolute(filename);
      try {
        if (isAppend) {
          let existing = '';
          try {
            existing = fs.readFile(target);
          } catch (error) {
            if (codeOf(error) === 'EISDIR') throw error;
          }
          fs.writeFile(target, (existing ? '\n' : '') + content, { append: true });
        } else {
          fs.writeFile(target, content);
        }
      } catch (error) {
        const code = codeOf(error);
        if (code === 'EISDIR') return errorLine(`echo: cannot write to '${filename}': Is a directory`);
        return errorLine(`echo: cannot create '${filename}': ${strerror(code)}`);
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