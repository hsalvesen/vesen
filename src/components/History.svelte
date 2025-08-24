<script lang="ts">
  import { history } from '../stores/history';
  import { theme } from '../stores/theme';
  import Ps1 from './Ps1.svelte';
  import { applyResponsiveWrapping } from '../utils/textWrap';
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
      <div class="whitespace-pre command-text command-output">
        {@html applyResponsiveWrapping(output)}
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

  .command-input-display {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    word-break: break-all;
  }

  .command-output {
    max-width: 100%;
    word-wrap: break-word;
    word-break: break-word;
    overflow-wrap: break-word;
  }

  /* Global responsive text wrapping for command outputs */
  :global(.command-output-wrapper) {
    max-width: 100%;
    word-wrap: break-word;
    word-break: break-word;
    overflow-wrap: break-word;
    white-space: pre-wrap;
    line-height: 1.4;
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

  @media (max-width: 768px) {
    :global(.command-output-wrapper) {
      font-size: 0.75rem;
      line-height: 1.3;
      overflow-x: hidden;
    }
    
    .command-output {
      max-width: calc(100vw - 64px);
      overflow-x: hidden;
    }
    
    .command-input-display {
      max-width: calc(100vw - 140px); /* Account for prompt width */
    }
  }

  @media (max-width: 480px) {
    :global(.command-output-wrapper) {
      font-size: 0.7rem;
      line-height: 1.2;
      max-width: calc(100vw - 32px);
      overflow-x: hidden;
    }
    
    .command-output {
      max-width: calc(100vw - 32px);
      overflow-x: hidden;
    }
    
    .command-input-display {
      max-width: calc(100vw - 120px); /* Account for prompt width */
    }
  }
</style>
