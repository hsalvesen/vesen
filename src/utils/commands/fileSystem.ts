import { theme } from '../../stores/theme';
import { get } from 'svelte/store';
import { virtualFileSystem, currentPath, type VirtualFile, resolvePath } from '../virtualFileSystem';
import { history } from '../../stores/history';
import { systemCommands } from './system';
import themes from '../../../themes.json';
import packageJson from '../../../package.json';
import { commandHelp } from '../helpTexts';

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

export const fileSystemCommands = {
  pwd: () => {
    return '/' + currentPath.join('/');
  },
  
  ls: (args: string[]) => {
    const currentTheme = get(theme);
    let targetPath: string[];
    
    if (args.length === 0) {
      targetPath = currentPath;
    } else {
      targetPath = resolvePath(args[0]);
    }
    
    let current = virtualFileSystem;
    for (const segment of targetPath) {
      if (current.children && current.children[segment]) {
        current = current.children[segment];
      } else {
        const pathStr = args.length === 0 ? '.' : args[0];
        return `ls: cannot access '${pathStr}': No such file or directory`;
      }
    }
    
    if (current.type !== 'directory') {
      const pathStr = args.length === 0 ? '.' : args[0];
      return `ls: cannot access '${pathStr}': Not a directory`;
    }
    
    if (!current.children) {
      return '';
    }
    
    const items = Object.values(current.children).map((item: VirtualFile) => {
      const color = item.type === 'directory' ? currentTheme.brightBlue : currentTheme.white;
      const suffix = item.type === 'directory' ? '/' : '';
      return `<span style="color: ${color}; font-weight: ${item.type === 'directory' ? 'bold' : 'normal'};">${item.name}${suffix}</span>`;
    });
    
    return items.join('  ');
  },
  
  cat: async (args: string[]) => {
    if (args.length === 0) {
      return commandHelp.cat;
    }
    
    const targetPath = resolvePath(args[0]);
    
    let current = virtualFileSystem;
    for (const segment of targetPath) {
      if (current.children && current.children[segment]) {
        current = current.children[segment];
      } else {
        return `cat: ${args[0]}: No such file or directory`;
      }
    }
    
    if (current.type !== 'file') {
      return `cat: ${args[0]}: Is a directory`;
    }
    
    return current.content || '';
  },
  
  cd: (args: string[]) => {
    if (args.length === 0) {
      return commandHelp.cd;
    }
    
    const targetPath = resolvePath(args[0]);
    
    let current = virtualFileSystem;
    for (const segment of targetPath) {
      if (current.children && current.children[segment]) {
        current = current.children[segment];
      } else {
        return `cd: no such file or directory: ${args[0]}`;
      }
    }
    
    if (current.type !== 'directory') {
      return `cd: not a directory: ${args[0]}`;
    }
    
    // Update the current path in the virtualFileSystem module
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
    history.set([]);
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
  
    // Regular echo behavior - remove surrounding quotes
    let output = args.join(' ');
    if ((output.startsWith('"') && output.endsWith('"')) || 
        (output.startsWith("'") && output.endsWith("'"))) {
      output = output.slice(1, -1);
    }
    
    return output;
  },

  reset: () => {
    // Reset theme to default (pinkrobin)
    const defaultTheme = themes.find((t) => t.name.toLowerCase() === 'pinkrobin')!;
    theme.set(defaultTheme);
    
    // Reset current path to default
    currentPath.length = 0;
    currentPath.push('home', 'user');
    
    // Restore virtual file system to original state
    virtualFileSystem.children = {
      'home': {
        name: 'home',
        type: 'directory',
        children: {
          'user': {
            name: 'user',
            type: 'directory',
            children: {
              'has.txt': {
                name: 'has.txt',
                type: 'file',
                content: 'Hello! This is Has Salvesen\'s personal file.\n\nWelcome to my terminal!\n\nFeel free to explore the virtual file system.'
              },
              'experience.md': {
                name: 'experience.md',
                type: 'file',
                filePath: '/src/data/experience.md'
              },
              'documents': {
                name: 'documents',
                type: 'directory',
                children: {
                  'readme.md': {
                    name: 'readme.md',
                    type: 'file',
                    content: '# Welcome to the Virtual File System\n\nThis is a simulated file system within the terminal.\n\nAvailable commands:\n- ls: list directory contents\n- pwd: show current directory\n- cd: change directory\n- cat: display file contents'
                  }
                }
              },
              'projects': {
                name: 'projects',
                type: 'directory',
                children: {
                  'vesen': {
                    name: 'vesen',
                    type: 'directory',
                    children: {
                      'info.txt': {
                        name: 'info.txt',
                        type: 'file',
                        content: 'VESEN Terminal\n\nA web-based terminal built with Svelte and TypeScript.\n\nRepository: https://github.com/hsalvesen/vesen'
                      }
                    }
                  }
                }
              }
            }
          }
        }
      },
      'etc': {
        name: 'etc',
        type: 'directory',
        children: {
          'config.conf': {
            name: 'config.conf',
            type: 'file',
            content: '# Virtual System Configuration\nterminal_theme=dynamic\nuser=guest\nhostname=salvesen.app'
          }
        }
      }
    };
    
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
  
  exit: () => {
    window.close();
    return 'Goodbye!';
  }
};