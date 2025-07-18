<script lang="ts">
  import { afterUpdate, onMount } from 'svelte';
  import { history } from '../stores/history';
  import { theme } from '../stores/theme';
  import { commands, virtualFileSystem, currentPath, processCommand } from '../utils/commands';
  import { track } from '../utils/tracking';
  import themes from '../../themes.json';

  let command = '';
  let historyIndex = -1;
  let input: HTMLInputElement;

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

  afterUpdate(() => {
    input.scrollIntoView({ behavior: 'smooth', block: 'end' });
  });

  const handleKeyDown = async (event: KeyboardEvent) => {
    if (event.key === 'Enter') {
      const [commandName, ...args] = command.split(' ');

      if (import.meta.env.VITE_TRACKING_ENABLED === 'true') {
        track(commandName, ...args);
      }

      // Use processCommand instead of calling commands directly
      const output = await processCommand(command);

      if (commandName !== 'clear' && commandName !== 'reset') {
        $history = [...$history, { command, outputs: [output] }];
      }

      command = '';
    } else if (event.key === 'ArrowUp') {
      if (historyIndex < $history.length - 1) {
        historyIndex++;

        command = $history[$history.length - 1 - historyIndex].command;
      }

      event.preventDefault();
    } else if (event.key === 'ArrowDown') {
      if (historyIndex > -1) {
        historyIndex--;
        command =
          historyIndex >= 0
            ? $history[$history.length - 1 - historyIndex].command
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
  on:click={(event) => {
    // Only focus if we're not selecting text and not clicking on selectable content
    if (!window.getSelection()?.toString() && event.target !== input) {
      input.focus();
    }
  }}
/>

<div class="flex w-full">
  <p class="visible md:hidden">❯</p>

  <input
    id="command-input"
    name="command-input"
    aria-label="Command input"
    class="w-full px-2 bg-transparent outline-none"
    type="text"
    autocomplete="off"
    style={`color: ${$theme.foreground}`}
    bind:value={command}
    on:keydown={handleKeyDown}
    bind:this={input}
  />
</div>
