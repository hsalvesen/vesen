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
  /* Muted text on nothing: dim, but still 4.5:1 in every theme. */
  .command-suggestions {
    color: var(--role-muted);
    white-space: pre-wrap;
  }

  .label {
    color: var(--role-accent);
  }
</style>
