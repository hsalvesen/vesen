<script lang="ts">
  import { commands } from "../utils/commands";
  import { getCommandSuggestions } from "../utils/commandSuggestions";

  let { command = "", isProcessing = false, isPasswordMode = false } = $props();

  const commandNames = Object.keys(commands);
  const suggestions = $derived(
    isProcessing || isPasswordMode ? [] : getCommandSuggestions(command, commandNames),
  );
</script>

{#if suggestions.length > 0}
  <div class="command-suggestions"><span class="label">Suggestions:</span>{"\n" + suggestions.join("\n")}</div>
{/if}

<style>
  .command-suggestions {
    color: var(--theme-bright-black);
    opacity: 1;
    white-space: pre-wrap;
  }

  .label {
    color: var(--theme-cyan);
  }
</style>
