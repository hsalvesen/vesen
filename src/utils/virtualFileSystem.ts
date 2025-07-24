// Virtual file system interface
export interface VirtualFile {
  name: string;
  type: 'file' | 'directory';
  content?: string;
  filePath?: string; // Path to real file
  children?: { [key: string]: VirtualFile };
}

// Virtual file system structure
// Helper function to get real system information
function getSystemInfo() {
  const navigator = window.navigator;
  const screen = window.screen;
  
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    language: navigator.language,
    cookieEnabled: navigator.cookieEnabled,
    onLine: navigator.onLine,
    screenWidth: screen.width,
    screenHeight: screen.height,
    colorDepth: screen.colorDepth,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    memory: (navigator as any).deviceMemory || 'unknown',
    cores: navigator.hardwareConcurrency || 'unknown'
  };
}

// Generate realistic content based on actual system
function generateSystemContent() {
  const sysInfo = getSystemInfo();
  const currentTime = new Date();
  
  return {
    cpuinfo: `processor\t: 0\nvendor_id\t: ${sysInfo.platform.includes('Intel') ? 'GenuineIntel' : 'AuthenticAMD'}\ncpu cores\t: ${sysInfo.cores}\nmodel name\t: ${sysInfo.platform}`,
    
    meminfo: `MemTotal:        ${sysInfo.memory !== 'unknown' ? sysInfo.memory * 1024 * 1024 : '8192000'} kB\nMemFree:         ${Math.floor(Math.random() * 4096000) + 2048000} kB\nMemAvailable:    ${Math.floor(Math.random() * 6144000) + 4096000} kB`,
    
    version: `Linux version 5.15.0-vesen (vesen@${window.location.hostname}) (gcc version 11.2.0) #1 SMP PREEMPT ${currentTime.toDateString()}`,
    
    osRelease: `NAME="Vesen Linux"\nVERSION="v1.0.0"\nID=vesen\nVERSION_ID="v1.0.0"\nPRETTY_NAME="Vesen Linux v1.0.0"\nHOME_URL="${window.location.origin}"\nBUILD_ID="${currentTime.getTime()}"`,
    
    hosts: `127.0.0.1\tlocalhost\n127.0.1.1\t${window.location.hostname}\n::1\t\tlocalhost ip6-localhost ip6-loopback`,
    
    syslog: `${currentTime.toISOString().slice(0, 19).replace('T', ' ')} ${window.location.hostname} kernel: [    0.000000] Linux version 5.15.0\n${currentTime.toISOString().slice(0, 19).replace('T', ' ')} ${window.location.hostname} systemd[1]: Started System Logging Service\n${currentTime.toISOString().slice(0, 19).replace('T', ' ')} ${window.location.hostname} NetworkManager[542]: <info> NetworkManager starting`,
    
    passwd: `root:x:0:0:root:/root:/bin/bash\nuser:x:1000:1000:User:/home/user:/bin/bash\nnobody:x:65534:65534:nobody:/nonexistent:/usr/sbin/nologin\nguest:x:1001:1001:Guest User:/home/guest:/bin/bash`
  };
}

// Add this function to create the initial file system structure
export function createInitialFileSystem(): VirtualFile {
  return {
    name: 'root',
    type: 'directory',
    children: {
      'bin': {
        name: 'bin',
        type: 'directory',
        children: {
          'bash': {
            name: 'bash',
            type: 'file',
            content: 'GNU bash, version 5.1.16(1)-release (x86_64-pc-linux-gnu)'
          },
          'ls': {
            name: 'ls',
            type: 'file',
            content: 'coreutils 8.32'
          },
          'cat': {
            name: 'cat',
            type: 'file',
            content: 'coreutils 8.32'
          }
        }
      },
      'usr': {
        name: 'usr',
        type: 'directory',
        children: {
          'bin': {
            name: 'bin',
            type: 'directory',
            children: {}
          }
        }
      },
      'var': {
        name: 'var',
        type: 'directory',
        children: {
          'log': {
            name: 'log',
            type: 'directory',
            children: {
              'syslog': {
                name: 'syslog',
                type: 'file',
                content: generateSystemContent().syslog
              }
            }
          }
        }
      },
      'tmp': {
        name: 'tmp',
        type: 'directory',
        children: {}
      },
      'opt': {
        name: 'opt',
        type: 'directory',
        children: {}
      },
      'lib': {
        name: 'lib',
        type: 'directory',
        children: {}
      },
      'boot': {
        name: 'boot',
        type: 'directory',
        children: {}
      },
      'dev': {
        name: 'dev',
        type: 'directory',
        children: {}
      },
      'proc': {
        name: 'proc',
        type: 'directory',
        children: {
          'cpuinfo': {
            name: 'cpuinfo',
            type: 'file',
            content: generateSystemContent().cpuinfo
          },
          'meminfo': {
            name: 'meminfo',
            type: 'file',
            content: generateSystemContent().meminfo
          },
          'version': {
            name: 'version',
            type: 'file',
            content: generateSystemContent().version
          }
        }
      },
      'sys': {
        name: 'sys',
        type: 'directory',
        children: {}
      },
      'mnt': {
        name: 'mnt',
        type: 'directory',
        children: {}
      },
      'media': {
        name: 'media',
        type: 'directory',
        children: {}
      },
      'root': {
        name: 'root',
        type: 'directory',
        children: {}
      },
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
                filePath: '/README.md' 
              },
              'history.txt': {
                name: 'history.txt',
                type: 'file',
                filePath: '/history.txt'   
              },
              // Essential User Directories
              'documents': {
                name: 'documents',
                type: 'directory',
                children: {
                  'linux.txt': {
                    name: 'linux.txt',
                    type: 'file',
                    filePath: '/linux.txt'
                  }
                }
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
              },
              'portfolio': {
                name: 'portfolio',
                type: 'directory',
                children: {
                  'index.html': {
                    name: 'index.html',
                    type: 'file',
                    content: '<!DOCTYPE html>\n<html>\n<head><title>Portfolio</title></head>\n<body><h1>My Portfolio</h1></body>\n</html>'
                  }
                }
              },
              'learning': {
                name: 'learning',
                type: 'directory',
                children: {
                  'javascript-basics.js': {
                    name: 'javascript-basics.js',
                    type: 'file',
                    content: '// JavaScript learning examples\nconsole.log("Hello, World!");\n\nfunction greet(name) {\n  return `Hello, ${name}!`;\n}'
                  }
                }
              }
            }
          },
          'desktop': {
            name: 'desktop',
            type: 'directory',
            children: {
              'shortcuts.txt': {
                name: 'shortcuts.txt',
                type: 'file',
                content: 'Desktop shortcuts and quick access files'
              }
            }
          },
          'downloads': {
            name: 'downloads',
            type: 'directory',
            children: {
              'software.tar.gz': {
                name: 'software.tar.gz',
                type: 'file',
                content: 'Compressed archive file'
              },
              'README-download.txt': {
                name: 'README-download.txt',
                type: 'file',
                content: 'Downloaded files and packages'
              }
            }
          },
          'pictures': {
            name: 'pictures',
            type: 'directory',
            children: {
              'vacation.jpg': {
                name: 'vacation.jpg',
                type: 'file',
                content: 'JPEG image file'
              }
            }
          },
          'music': {
            name: 'music',
            type: 'directory',
            children: {
              'playlist.m3u': {
                name: 'playlist.m3u',
                type: 'file',
                content: '#EXTM3U\n#EXTINF:180,Song Title\nsong.mp3'
              }
            }
          },
          'videos': {
            name: 'videos',
            type: 'directory',
            children: {
              'tutorial.mp4': {
                name: 'tutorial.mp4',
                type: 'file',
                content: 'MP4 video file'
              }
            }
          },
          'public': {
            name: 'public',
            type: 'directory',
            children: {
              'shared-file.txt': {
                name: 'shared-file.txt',
                type: 'file',
                content: 'This file is shared with other users'
              }
            }
          },
          'templates': {
            name: 'templates',
            type: 'directory',
            children: {
              'document-template.txt': {
                name: 'document-template.txt',
                type: 'file',
                content: 'Template for creating new documents'
              }
            }
          },
          // Development-Specific Directories
          'bin': {
            name: 'bin',
            type: 'directory',
            children: {
              'my-script': {
                name: 'my-script',
                type: 'file',
                content: '#!/bin/bash\necho "Personal script executed"'
              },
              'deploy': {
                name: 'deploy',
                type: 'file',
                content: '#!/bin/bash\necho "Deploying application..."'
              }
            }
          },
          'src': {
            name: 'src',
            type: 'directory',
            children: {
              'main.c': {
                name: 'main.c',
                type: 'file',
                content: '#include <stdio.h>\n\nint main() {\n    printf("Hello, World!\\n");\n    return 0;\n}'
              }
            }
          },
          'scripts': {
            name: 'scripts',
            type: 'directory',
            children: {
              'backup.sh': {
                name: 'backup.sh',
                type: 'file',
                content: '#!/bin/bash\n# Backup script\necho "Creating backup..."\ntar -czf backup-$(date +%Y%m%d).tar.gz ~/documents'
              },
              'setup.py': {
                name: 'setup.py',
                type: 'file',
                content: '#!/usr/bin/env python3\n# Setup script\nprint("Setting up environment...")'
              }
            }
          },
          'config': {
            name: 'config',
            type: 'directory',
            children: {
              'app.conf': {
                name: 'app.conf',
                type: 'file',
                content: '# Application configuration\ntheme=dark\nlanguage=en\ndebug=false'
              }
            }
          },
          // Hidden Files (dotfiles)
          '.bashrc': {
            name: '.bashrc',
            type: 'file',
            content: '# ~/.bashrc: executed by bash(1) for non-login shells\n\n# User specific aliases and functions\nalias ll="ls -la"\nalias la="ls -A"\nalias l="ls -CF"\n\n# Add ~/bin to PATH\nexport PATH="$HOME/bin:$PATH"\n\n# Custom prompt\nexport PS1="\\u@\\h:\\w$ "'
          },
          '.profile': {
            name: '.profile',
            type: 'file',
            content: '# ~/.profile: executed by the command interpreter for login shells\n\n# Set PATH to include user\'s private bin if it exists\nif [ -d "$HOME/bin" ] ; then\n    PATH="$HOME/bin:$PATH"\nfi\n\n# Set default editor\nexport EDITOR=vim'
          },
          '.vimrc': {
            name: '.vimrc',
            type: 'file',
            content: '" ~/.vimrc: Vim configuration\n\nset number\nset tabstop=4\nset shiftwidth=4\nset expandtab\nset autoindent\nset hlsearch\nset incsearch\n\nsyntax on\ncolorscheme default'
          },
          '.gitconfig': {
            name: '.gitconfig',
            type: 'file',
            content: '[user]\n\tname = User\n\temail = user@example.com\n\n[core]\n\teditor = vim\n\n[alias]\n\tst = status\n\tco = checkout\n\tbr = branch\n\tci = commit'
          },
          '.ssh': {
            name: '.ssh',
            type: 'directory',
            children: {
              'config': {
                name: 'config',
                type: 'file',
                content: '# SSH client configuration\n\nHost github.com\n    HostName github.com\n    User git\n    IdentityFile ~/.ssh/id_rsa'
              },
              'known_hosts': {
                name: 'known_hosts',
                type: 'file',
                content: '# SSH known hosts\ngithu.com ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQC7vbqajDjI+e\ntest-server.local ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIG4rT3vTt\ndev.localhost ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQDGhlOTsIXO\nmyserver.net ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQCvuydfeYbH'
              }
            }
          },
          '.local': {
            name: '.local',
            type: 'directory',
            children: {
              'share': {
                name: 'share',
                type: 'directory',
                children: {
                  'applications': {
                    name: 'applications',
                    type: 'directory',
                    children: {}
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
          'os-release': {
            name: 'os-release',
            type: 'file',
            content: generateSystemContent().osRelease
          },
          'hosts': {
            name: 'hosts',
            type: 'file',
            content: generateSystemContent().hosts
          },
          'passwd': {
            name: 'passwd',
            type: 'file',
            content: generateSystemContent().passwd
          },
          'config.conf': {
            name: 'config.conf',
            type: 'file',
            content: '# Virtual System Configuration\nterminal_theme=dynamic\nuser=guest\nhostname=www.vesen.app'
          }
        }
      }
    }
  };
}

// Update the main export to use this function
export const virtualFileSystem: VirtualFile = createInitialFileSystem();

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
