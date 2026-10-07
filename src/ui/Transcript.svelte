<!--
  The transcript: every entry of the screen store, each with the prompt it was typed at, the
  line, and its output. Replaces components/History.svelte. A line's entry is here from the
  moment it starts, with its output arriving under it as the command writes it, and `status`
  (the status line) under the line still running.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { Action } from '../output/model';
  import { screen } from '../stores/screen';
  import OutputView from './OutputView.svelte';
  import Prompt from './Prompt.svelte';

  let { onaction, status }: { onaction?: (action: Action) => void; status?: Snippet } = $props();

  /** The line running now: the newest entry still running. */
  const running = $derived.by(() => {
    const entries = $screen;
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      if (entries[i]?.state === 'running') return entries[i]?.id ?? null;
    }
    return null;
  });
</script>

{#each $screen as entry (entry.id)}
  <div class="entry" class:running={entry.state === 'running'}>
    <!-- A line that cleared the screen keeps its output, not the prompt it was typed at. -->
    {#if entry.prompt !== null}
      <!-- Inline, so a long prompt and its line wrap as a terminal's do, never pushing the page sideways. -->
      <div class="entry-line"><Prompt line={entry.prompt} /><span class="command-input-display">{entry.line}</span></div>
    {/if}

    <!-- The status line follows the output with no space between, so a finished entry is as it was. -->
    {#if entry.blocks.length > 0}
      <div class="command-output">
        <OutputView blocks={entry.blocks} {onaction} />
      </div>
    {/if}{#if status && entry.id === running}{@render status()}{/if}
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
