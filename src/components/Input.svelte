<script lang="ts">
  import { onMount } from 'svelte';
  import { history, commandHistory } from '../stores/history';
  import { theme } from '../stores/theme';
  import { commands } from '../utils/commands';
  import { virtualFileSystem, currentPath } from '../utils/virtualFileSystem';
  import { processCommand } from '../utils/commands';
  import { track } from '../utils/tracking';
  import { get } from 'svelte/store';
  import themes from '../../themes.json';

  // Use $props() to declare props with $bindable()
  let { isPasswordMode = $bindable(), isProcessing = $bindable(false), loadingText = $bindable('') } = $props();

  let command = $state('');
  let historyIndex = $state(-1);
  let input: HTMLInputElement;
  let pendingSudoCommand = $state('');
  let passwordInput = $state('');
  
  // Abort controller for cancelling long-running commands
  let currentAbortController: AbortController | null = null;
  let currentCommandName = $state('');
  
  // Loading animation state - remove local loadingText since it's now a prop
  let loadingInterval: number | null = null;
  
  // Loading animation frames
  const loadingFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let frameIndex = 0;

  // Getter/setter for input binding
  let displayValue = {
    get value() {
      return isProcessing && !isPasswordMode ? loadingText : command;
    },
    set value(newValue: string) {
      if (!isProcessing || isPasswordMode) {
        command = newValue;
      }
    }
  };
  
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
    // Handle Ctrl+C globally (even when input is disabled)
    if (event.ctrlKey && event.key === 'c') {
      event.preventDefault();
      
      // Only interrupt if we're processing a command and it's one of the interruptible commands
      if (isProcessing && currentAbortController && ['curl', 'weather', 'stock', 'neofetch'].includes(currentCommandName)) {
         // Cancel the current operation
         currentAbortController.abort();
         
         // Don't add history entry here - let the command's AbortError handler do it
         // Just reset the state and let the command complete with its cancellation message
         currentAbortController = null;
         currentCommandName = '';
       } else if (!isProcessing) {
         // If not processing a command, navigate to next line
         if (command.trim()) {
           // Add current command to history without executing it
           $history = [...$history, { command, outputs: [''] }];
         } else {
           // Add empty line to history
           $history = [...$history, { command: '', outputs: [''] }];
         }
         // Clear the command and reset history index
         command = '';
         historyIndex = -1;
       }
      return;
    }
    
    // Handle Ctrl+L globally
    if (event.ctrlKey && event.key === 'l') {
      event.preventDefault();
      $history = [];
      return;
    }
    
    // For all other keys, only handle if input is not disabled/processing
    if (isProcessing && !isPasswordMode) {
      return;
    }
    
    if (event.key === 'Enter' && !isProcessing) {
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
      
      // Check if command is empty or only whitespace
      if (!command.trim()) {
        // Just add an empty entry to history to show a new prompt line
        $history = [...$history, { command: '', outputs: [''] }];
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

      // Store the current command before processing
      const currentCommand = command;
      
      // Set processing state to true but DON'T clear the command yet
      isProcessing = true;
      
      // Set up abort controller for interruptible commands
      if (['curl', 'weather', 'stock', 'neofetch'].includes(commandName)) {
        currentAbortController = new AbortController();
        currentCommandName = commandName;
      }
      
      // Disable the input during async operations
      if (input) {
        input.disabled = true;
      }

      try {
        // Use processCommand and wait for completion
        const output = await processCommand(currentCommand, currentAbortController);
  
        // Only skip display history for clear/reset when NOT showing help
        const hasHelpFlag = args.includes('--help') || args.includes('-h');
        const shouldSkipDisplayHistory = (commandName === 'clear' || commandName === 'reset') && !hasHelpFlag;
        
        // Always add to command navigation history (for arrow keys)
        $commandHistory = [...$commandHistory, currentCommand];
        
        // Only add to display history if not a clear/reset command
        if (!shouldSkipDisplayHistory) {
          $history = [...$history, { command: currentCommand, outputs: [output] }];
        }
      } catch (error) {
        // Handle any errors
        $history = [...$history, { command: currentCommand, outputs: [`Error: ${error}`] }];
      } finally {
        // Clear the command input only after processing is complete
        command = '';
        
        // Reset history index to start from the most recent command
        historyIndex = -1;
        
        // Clean up abort controller
        currentAbortController = null;
        currentCommandName = '';
        
        // Set processing state to false to show the prompt again
        isProcessing = false;
        
        // Re-enable the input after command completion
        if (input) {
          input.disabled = false;
          input.focus();
        }
      }
    } else if (isPasswordMode) {
      // Handle password input (hide characters)
      if (event.key === 'Backspace') {
        passwordInput = passwordInput.slice(0, -1);
      } else if (event.key.length === 1) {
        passwordInput += event.key;
      }
      event.preventDefault();
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
      } else if (commandName === 'theme' && parts.length === 2) {
        // Complete theme subcommands (ls, set)
        const themeSubcommands = ['ls', 'set'];
        const matchingSubcommands = themeSubcommands.filter(sub => sub.startsWith(currentArg.toLowerCase()));
        
        if (matchingSubcommands.length === 1) {
          command = `theme ${matchingSubcommands[0]} `;
        } else if (matchingSubcommands.length > 1) {
          // Find common prefix
          const commonPrefix = matchingSubcommands.reduce((prefix, sub) => {
            let i = 0;
            while (i < prefix.length && i < sub.length && prefix[i] === sub[i]) {
              i++;
            }
            return prefix.substring(0, i);
          });
          if (commonPrefix.length > currentArg.length) {
            command = `theme ${commonPrefix}`;
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
    }
  };

  // Effect to handle loading animation
  // Loading animation effect
  $effect(() => {
    if (isProcessing) {
      frameIndex = 0;
      loadingInterval = setInterval(() => {
        frameIndex = (frameIndex + 1) % loadingFrames.length;
        loadingText = `${loadingFrames[frameIndex]} Processing...`;
      }, 100);
    } else {
      if (loadingInterval) {
        clearInterval(loadingInterval);
        loadingInterval = null;
      }
      loadingText = '';
    }

    return () => {
      if (loadingInterval) {
        clearInterval(loadingInterval);
      }
    };
  });
</script>

<svelte:window
  onclick={(event) => {
    // Only focus if we're not selecting text and not clicking on selectable content
    if (!window.getSelection()?.toString() && event.target !== input) {
      input.focus();
    }
  }}
  onkeydown={handleKeyDown}
/>

<input
  bind:this={input}
  bind:value={command}
  class="bg-transparent outline-none flex-1 command-input"
  style="color: var(--theme-white); opacity: 1;"
  type={isPasswordMode ? 'password' : 'text'}
  placeholder={isPasswordMode ? '' : ''}
  autocomplete="off"
  spellcheck="false"
  autocapitalize="off"
  autocorrect="off"
  inputmode="text"
  disabled={isProcessing}
  readonly={isProcessing}
/>

<style>
  .command-input {
    font-family: 'Cascadia Code', monospace;
    font-size: 0.75rem; /* text-xs */
    letter-spacing: 0;
    font-feature-settings: normal;
    font-variant-ligatures: none;
    text-rendering: optimizeSpeed;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  @media (min-width: 640px) {
    .command-input {
      font-size: 0.875rem; /* sm:text-sm */
    }
  }

  @media (min-width: 768px) {
    .command-input {
      font-size: 1rem; /* md:text-base */
    }
  }

  input:disabled {
    color: var(--theme-white) !important;
    opacity: 1 !important;
    -webkit-text-fill-color: var(--theme-white) !important;
  }
  
  input:readonly {
    color: var(--theme-cyan) !important;
    -webkit-text-fill-color: var(--theme-cyan) !important;
  }
</style>

