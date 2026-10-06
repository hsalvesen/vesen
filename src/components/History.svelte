<script lang="ts">
  import { history } from '../stores/history';
  import { theme } from '../stores/theme';
  import { outputBlocks } from '../interfaces/command';
  import type { Action } from '../output/model';
  import OutputView from '../ui/OutputView.svelte';
  import Ps1 from './Ps1.svelte';

  let { onaction }: { onaction?: (action: Action) => void } = $props();
</script>

{#each $history as { command, outputs }}
  <div style={`color: ${$theme.foreground}`}>
    <div class="flex flex-row">
      <Ps1 />

      <div class="flex flex-1 min-w-0">
        <span class="command-text command-input-display" style="margin-left: 0.25rem;">{command}</span>
      </div>
    </div>

    {#each outputs as output}
      <div class="command-text command-output">
        <OutputView blocks={outputBlocks(output)} {onaction} />
      </div>
    {/each}
  </div>
{/each}

<style>
  .command-text {
    font-family: monospace;
    font-size: 0.75rem; /* text-xs */
    letter-spacing: 0;
    font-feature-settings: normal;
    font-variant-ligatures: none;
    text-rendering: optimizeSpeed;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  /* Long commands wrap like a terminal line instead of being cut off with an ellipsis. */
  .command-input-display {
    min-width: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  /* OutputView wraps text (pre-wrap, overflow-wrap: anywhere) at every width. */
  .command-output {
    max-width: 100%;
  }

  @media (min-width: 640px) {
    .command-text {
      font-size: 0.875rem; /* sm:text-sm */
    }
  }

  @media (min-width: 768px) {
    .command-text {
      font-size: 1rem; /* md:text-base */
    }
  }

  /* Phones keep the sizes the old output wrapper gave them, until the phone work sets new ones. */
  @media (max-width: 768px) {
    .command-output {
      max-width: calc(100vw - 64px);
      overflow-x: hidden;
      font-size: 0.75rem;
      line-height: 1.4;
    }
  }

  @media (max-width: 480px) {
    .command-output {
      max-width: calc(100vw - 32px);
      font-size: 0.7rem;
    }
  }
</style>
