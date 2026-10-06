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
        <span class="command-input-display" style="margin-left: 0.25rem;">{command}</span>
      </div>
    </div>

    {#each outputs as output}
      <div class="command-output">
        <OutputView blocks={outputBlocks(output)} {onaction} />
      </div>
    {/each}
  </div>
{/each}

<style>
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

  /* Phones keep the widths the old output wrapper gave them, until the app shell is sized to the
     visible viewport. */
  @media (max-width: 768px) {
    .command-output {
      max-width: calc(100vw - 64px);
      overflow-x: hidden;
    }
  }

  @media (max-width: 480px) {
    .command-output {
      max-width: calc(100vw - 32px);
    }
  }
</style>
