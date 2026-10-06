<!--
  The transcript: every entry of the screen store, each with the prompt it was typed at, the
  line, and its output. Replaces components/History.svelte.
-->
<script lang="ts">
  import type { Action } from '../output/model';
  import { screen } from '../stores/screen';
  import OutputView from './OutputView.svelte';
  import Prompt from './Prompt.svelte';

  let { onaction }: { onaction?: (action: Action) => void } = $props();
</script>

{#each $screen as entry (entry.id)}
  <div class="entry">
    <!-- A line that cleared the screen keeps its output, not the prompt it was typed at. -->
    {#if entry.prompt !== null}
      <!-- Inline, so a long prompt and its line wrap as a terminal's do, never pushing the page sideways. -->
      <div class="entry-line"><Prompt line={entry.prompt} /><span class="command-input-display">{entry.line}</span></div>
    {/if}

    {#if entry.blocks.length > 0}
      <div class="command-output">
        <OutputView blocks={entry.blocks} {onaction} />
      </div>
    {/if}
  </div>
{/each}

<style>
  .entry {
    color: var(--role-fg);
  }

  /* Long commands wrap like a terminal line instead of being cut off with an ellipsis. */
  .entry-line {
    min-width: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .command-input-display {
    margin-left: 0.25rem;
  }

  /* OutputView wraps text (pre-wrap, overflow-wrap: anywhere) at every width, and art scrolls
     inside itself, so an output is never wider than the screen. */
  .command-output {
    max-width: 100%;
    min-width: 0;
  }
</style>
