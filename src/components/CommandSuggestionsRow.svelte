<script lang="ts">
  import { commands } from '../utils/commands';
  import { getCommandSuggestions } from '../utils/commandSuggestions';

  let { command = '', isProcessing = false, isPasswordMode = false } = $props();

  const commandNames = Object.keys(commands);
  let suggestions = $state([] as string[]);

  $effect(() => {
    if (isProcessing || isPasswordMode) {
      suggestions = [];
      return;
    }
    suggestions = getCommandSuggestions(command, commandNames);
  });

  const suggestionText = () => `\nSuggestions:\t\t${suggestions.join('\t\t')}`;
</script>

{#if !isProcessing && !isPasswordMode && suggestions.length > 0}
    <div></div>
    <div class="command-suggestions">{suggestionText()}</div>
{/if}

<style>
  .command-suggestions {
    font-family: monospace;
    color: var(--theme-bright-black);
    opacity: 1;
    white-space: pre-wrap;
    tab-size: 4;
    line-height: 1.25;
  }
</style>