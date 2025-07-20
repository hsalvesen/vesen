<script lang="ts">
  import { onMount } from 'svelte';
  import { history, commandHistory } from '../stores/history';
  import { theme } from '../stores/theme';
  import { commands, virtualFileSystem, currentPath, processCommand } from '../utils/commands';
  import { track } from '../utils/tracking';
  import themes from '../../themes.json';

  let command = $state('');
  let historyIndex = $state(-1);
  let input: HTMLInputElement;
  let { isPasswordMode = $bindable(false) } = $props();
  let pendingSudoCommand = $state('');
  let passwordInput = $state('');

  // Helper function to resolve file paths for completion
  const getCompletions = (input: string, isFilePath: boolean = false): string[] => {
    if (!isFilePath) {
      // Command completion
      return Object.keys(commands).filter(cmd => cmd.startsWith(input));
    }

    // File path completion using actual virtual file system
    let searchPath = [...currentPath];
    let searchTerm = input;
    
    // Handle absolute paths
    if (input.startsWith('/')) {
      searchPath = [];
      searchTerm = input.substring(1);
    }
    
    // Handle relative paths with directories
    if (input.includes('/')) {
      const parts = input.split('/');
      searchTerm = parts.pop() || '';
      const pathParts = parts.filter(p => p !== '');
      
      if (input.startsWith('/')) {
        searchPath = pathParts;
      } else {
        searchPath = [...currentPath, ...pathParts];
      }
    }
    
    // Navigate to the search directory
    let current = virtualFileSystem;
    for (const segment of searchPath) {
      if (current && current.children && current.children[segment]) {
        current = current.children[segment];
      } else {
        return [];
      }
    }
    
    // Get completions from current directory
    if (current && current.children) {
      return Object.keys(current.children)
        .filter(name => name.startsWith(searchTerm))
        .map(name => {
          const child = current.children![name];
          const fullPath = input.substring(0, input.lastIndexOf('/') + 1) + name;
          // Add trailing slash for directories
          if (child && child.type === 'directory') {
            return fullPath + '/';
          }
          return fullPath;
        });
    }
    
    return [];
  };

  onMount(() => {
    input.focus();

    if ($history.length === 0) {
      const command = commands['banner'] as () => string;

      if (command) {
        const output = command();

        $history = [...$history, { command: 'banner', outputs: [output] }];
      }
    }
  });


  $effect(() => {
    if (input) {
      // Scroll the main container to bottom after any history changes
      const mainContainer = document.querySelector('main');
      if (mainContainer) {
        setTimeout(() => {
          mainContainer.scrollTop = mainContainer.scrollHeight;
        }, 0);
      }
      
      // Also ensure input is visible
      input.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  });

  // Add a new effect that triggers specifically on history changes
  $effect(() => {
    // This effect runs whenever $history changes
    $history;
    
    // Scroll to bottom after DOM updates
    setTimeout(() => {
      const mainContainer = document.querySelector('main');
      if (mainContainer) {
        mainContainer.scrollTo({
          top: mainContainer.scrollHeight,
          behavior: 'smooth'
        });
      }
    }, 10);
  });

  const handleKeyDown = async (event: KeyboardEvent) => {
    if (event.key === 'Enter') {
      if (isPasswordMode) {
        // Handle password submission
        isPasswordMode = false;
        passwordInput = '';
        
        // Add the password prompt to history
        $history = [...$history, { 
          command: `sudo ${pendingSudoCommand}`, 
          outputs: ['Password:'] 
        }];
        
        // Open rickroll
        window.open('https://www.youtube.com/watch?v=dQw4w9WgXcQ', '_blank');
        
        pendingSudoCommand = '';
        command = '';
        return;
      }
      
      const [commandName, ...args] = command.split(' ');
  
      if (import.meta.env.VITE_TRACKING_ENABLED === 'true') {
        track(commandName, ...args);
      }
  
      // Special handling for sudo
      if (commandName === 'sudo' && args.length > 0) {
        // Check if it's a help request first
        const hasHelpFlag = args.includes('--help') || args.includes('-h');
        if (hasHelpFlag) {
          // Let it fall through to normal command processing for help
        } else {
          pendingSudoCommand = args.join(' ');
          isPasswordMode = true;
          
          $history = [...$history, { 
            command, 
            outputs: []
          }];
          
          command = '';
          passwordInput = '';
          return;
        }
      }
  
      // Use processCommand instead of calling commands directly
      const output = await processCommand(command);
  
      // Only skip display history for clear/reset when NOT showing help
      const hasHelpFlag = args.includes('--help') || args.includes('-h');
      const shouldSkipDisplayHistory = (commandName === 'clear' || commandName === 'reset') && !hasHelpFlag;
      
      // Always add to command navigation history (for arrow keys)
      $commandHistory = [...$commandHistory, command];
      
      // Only add to display history if not a clear/reset command
      if (!shouldSkipDisplayHistory) {
        $history = [...$history, { command, outputs: [output] }];
      }

      command = '';
    } else if (isPasswordMode) {
      // Handle password input (hide characters)
      if (event.key === 'Backspace') {
        passwordInput = passwordInput.slice(0, -1);
      } else if (event.key.length === 1) {
        passwordInput += event.key;
      }
      event.preventDefault();
    // Around line 190-200, find the arrow key handling and update:
    } else if (event.key === 'ArrowUp') {
    if (historyIndex < $commandHistory.length - 1) {
    historyIndex++;
    command = $commandHistory[$commandHistory.length - 1 - historyIndex];
    }
    event.preventDefault();
    } else if (event.key === 'ArrowDown') {
    if (historyIndex > -1) {
    historyIndex--;
    command = historyIndex >= 0 
      ? $commandHistory[$commandHistory.length - 1 - historyIndex] 
      : '';
    }
    event.preventDefault();
    } else if (event.key === 'Tab') {
      event.preventDefault();

      const parts = command.split(' ');
      const commandName = parts[0];
      const currentArg = parts[parts.length - 1] || '';
      
      // Commands that expect file paths as arguments
      const fileCommands = ['cd', 'cat', 'rm', 'touch', 'nano'];
      
      if (parts.length === 1) {
        // Complete command name
        const completions = getCompletions(commandName, false);
        if (completions.length === 1) {
          command = completions[0] + ' ';
        } else if (completions.length > 1) {
          // Find common prefix
          const commonPrefix = completions.reduce((prefix, cmd) => {
            let i = 0;
            while (i < prefix.length && i < cmd.length && prefix[i] === cmd[i]) {
              i++;
            }
            return prefix.substring(0, i);
          });
          if (commonPrefix.length > commandName.length) {
            command = commonPrefix;
          }
        }
      } else if (commandName === 'theme' && parts.length === 3 && parts[1] === 'set') {
        // Complete theme names for 'theme set' command
        const themeNames = themes.map(t => t.name.toLowerCase());
        const matchingThemes = themeNames.filter(name => name.startsWith(currentArg.toLowerCase()));
        
        if (matchingThemes.length === 1) {
          // Find the original case theme name
          const originalTheme = themes.find(t => t.name.toLowerCase() === matchingThemes[0]);
          if (originalTheme) {
            parts[parts.length - 1] = originalTheme.name;
            command = parts.join(' ');
          }
        } else if (matchingThemes.length > 1) {
          // Find common prefix
          const commonPrefix = matchingThemes.reduce((prefix, name) => {
            let i = 0;
            while (i < prefix.length && i < name.length && prefix[i] === name[i]) {
              i++;
            }
            return prefix.substring(0, i);
          });
          if (commonPrefix.length > currentArg.length) {
            parts[parts.length - 1] = commonPrefix;
            command = parts.join(' ');
          }
        }
      } else if (fileCommands.includes(commandName)) {
        // Complete file path
        const completions = getCompletions(currentArg, true);
        if (completions.length === 1) {
          parts[parts.length - 1] = completions[0];
          command = parts.join(' ');
        } else if (completions.length > 1) {
          // Find common prefix for file paths
          const commonPrefix = completions.reduce((prefix, path) => {
            let i = 0;
            while (i < prefix.length && i < path.length && prefix[i] === path[i]) {
              i++;
            }
            return prefix.substring(0, i);
          });
          if (commonPrefix.length > currentArg.length) {
            parts[parts.length - 1] = commonPrefix;
            command = parts.join(' ');
          }
        }
      }
    } else if (event.ctrlKey && event.key === 'l') {
      event.preventDefault();

      $history = [];
    }
  };
</script>

<svelte:window
  onclick={(event) => {
    // Only focus if we're not selecting text and not clicking on selectable content
    if (!window.getSelection()?.toString() && event.target !== input) {
      input.focus();
    }
  }}
/>

<input
  bind:this={input}
  bind:value={command}
  onkeydown={handleKeyDown}
  class="bg-transparent outline-none flex-1 font-mono"
  style="color: var(--theme-white);"
  type={isPasswordMode ? 'password' : 'text'}
  placeholder={isPasswordMode ? '' : ''}
  autocomplete="off"
  spellcheck="false"
/>

