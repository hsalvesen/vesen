<script lang="ts">
  import { commandNames } from "../utils/commands";
  import { getCommandSuggestions } from "../utils/commandSuggestions";

  let { command = "", isProcessing = false, isPasswordMode = false } = $props();

  // Every registered command, read when the line changes, so commands that arrive with the
  // shell's chunk are offered too.
  const suggestions = $derived(
    isProcessing || isPasswordMode ? [] : getCommandSuggestions(command, commandNames()),
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
