<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { commands } from '../utils/commands';
  import { getCommandSuggestions } from '../utils/commandSuggestions';

  let { command = '', isProcessing = false, isPasswordMode = false } = $props();

  const dispatch = createEventDispatcher<{ show: void; hide: void; update: void }>();

  const commandNames = Object.keys(commands);
  let suggestions = $state([] as string[]);
  let wasVisible = $state(false);
  let lastSuggestionsKey = $state('');

  $effect(() => {
    if (isProcessing || isPasswordMode) {
      suggestions = [];
      return;
    }
    suggestions = getCommandSuggestions(command, commandNames);
  });

  $effect(() => {
    const isVisible = !isProcessing && !isPasswordMode && suggestions.length > 0;
    if (isVisible === wasVisible) return;
    wasVisible = isVisible;
    dispatch(isVisible ? 'show' : 'hide');
  });

  $effect(() => {
    const isVisible = !isProcessing && !isPasswordMode && suggestions.length > 0;
    if (!isVisible) {
      lastSuggestionsKey = '';
      return;
    }

    const key = suggestions.join('\n');
    if (!lastSuggestionsKey) {
      lastSuggestionsKey = key;
      return;
    }

    if (key !== lastSuggestionsKey) {
      lastSuggestionsKey = key;
      dispatch('update');
    }
  });

  const suggestionText = () => ['Suggestions:', ...suggestions].join('\n');
</script>

{#if !isProcessing && !isPasswordMode && suggestions.length > 0}
  <div class="command-suggestions">{suggestionText()}</div>
{/if}

<style>
  .command-suggestions {
    font-family: monospace;
    color: var(--theme-bright-black);
    opacity: 1;
    white-space: pre-wrap;
    line-height: 1.25;
  }
</style>