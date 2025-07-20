import { experienceContent } from './experienceContent';
import { readmeContent } from './experienceContent';

// Virtual file system interface
export interface VirtualFile {
  name: string;
  type: 'file' | 'directory';
  content?: string;
  filePath?: string; // Path to real file
  children?: { [key: string]: VirtualFile };
}

// Virtual file system structure
export const virtualFileSystem: VirtualFile = {
  name: 'root',
  type: 'directory',
  children: {
    'home': {
      name: 'home',
      type: 'directory',
      children: {
        'user': {
          name: 'user',
          type: 'directory',
          children: {
            'README.md': {
              name: 'README.md',
              type: 'file',
              content: readmeContent  
            },
            'experience.md': {
              name: 'experience.md',
              type: 'file',
              content: experienceContent
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
                      content: 'Vesen Terminal\n\nA web-based terminal built with Svelte and TypeScript.\n\nRepository: https://github.com/hsalvesen/vesen'
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
  }
};

// Current directory state
export let currentPath: string[] = ['home', 'user'];

// Helper function to get current directory
export function getCurrentDirectory(): VirtualFile | null {
  let current = virtualFileSystem;
  for (const segment of currentPath) {
    if (current.children && current.children[segment]) {
      current = current.children[segment];
    } else {
      return null;
    }
  }
  return current;
}

// Helper function to resolve path
export function resolvePath(path: string): string[] {
  if (path === '~') {
    // Home directory shortcut
    return ['home', 'user'];
  } else if (path.startsWith('~/')) {
    // Home directory relative path
    const relativePath = path.substring(2);
    const segments = relativePath.split('/').filter(p => p !== '');
    return ['home', 'user', ...segments];
  } else if (path.startsWith('/')) {
    // Absolute path
    return path.split('/').filter(p => p !== '');
  } else {
    // Relative path
    const newPath = [...currentPath];
    const segments = path.split('/').filter(p => p !== '');
    
    for (const segment of segments) {
      if (segment === '..') {
        if (newPath.length > 0) {
          newPath.pop();
        }
      } else if (segment !== '.') {
        newPath.push(segment);
      }
    }
    
    return newPath;
  }
}
