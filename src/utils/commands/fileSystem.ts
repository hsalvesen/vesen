import { theme } from '../../stores/theme';
import { get } from 'svelte/store';
import { virtualFileSystem, currentPath, type VirtualFile, resolvePath } from '../virtualFileSystem';

// Helper function to load real file content
async function loadRealFile(filePath: string): Promise<string> {
  try {
    // For files in the data folder, construct the correct path
    const response = await fetch(filePath);
    if (!response.ok) {
      throw new Error(`Failed to load file: ${response.statusText}`);
    }
    return await response.text();
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
    let targetPath = currentPath;
    
    if (args.length > 0) {
      targetPath = resolvePath(args[0]);
    }
    
    let current = virtualFileSystem;
    for (const segment of targetPath) {
      if (current.children && current.children[segment]) {
        current = current.children[segment];
      } else {
        return `ls: cannot access '${args[0] || '.'}': No such file or directory`;
      }
    }
    
    if (current.type !== 'directory') {
      return `ls: cannot access '${args[0]}': Not a directory`;
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
      return 'Usage: cat [filename]\nExamples:\n  cat experience.txt       - display experience file\n  cat documents/readme.md  - display readme from documents folder\nTip: Use "ls" to see available files in the current directory';
    }
    
    // Special handling for experience.txt - load from data folder
    if (args[0] === 'experience.txt') {
      try {
        return await loadRealFile('/src/data/experience.txt');
      } catch (error) {
        return `cat: experience.txt: Error reading file - ${error}`;
      }
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
      return 'Usage: cd [directory]\nExamples:\n  cd documents    - go to documents folder\n  cd ..          - go up one directory\n  cd /home/user  - go to absolute path\n  cd             - go to home directory\nTip: Use "ls" to see available directories';
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
      return 'Usage: rm [options] [filename/directory]\nOptions:\n  -r, --recursive  remove directories and their contents recursively\nExamples:\n  rm has.txt       - remove a file\n  rm -r documents  - remove directory and all contents\nWarning: This will permanently delete files/directories from this session';
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
      return 'Usage: touch [filename]\nExample: touch newfile.txt\nCreates an empty file or updates timestamp if file exists';
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
      return 'Usage: mkdir [directory_name]\nExample: mkdir new_folder\nCreates a new directory in the current location';
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

  reset: () => {
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
    
    const currentTheme = get(theme);
    return `<span style="color: ${currentTheme.green}; font-weight: bold;">Virtual file system reset to default state</span>\n<span style="color: ${currentTheme.cyan};">Current directory: /home/user</span>\n<span style="color: ${currentTheme.yellow};">All created/modified files have been restored</span>`;
  }
};