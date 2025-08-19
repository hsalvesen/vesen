<script lang="ts">
  import { history } from '../stores/history';
  import { theme } from '../stores/theme';
  import Ps1 from './Ps1.svelte';
</script>

{#each $history as { command, outputs }}
  <div style={`color: ${$theme.foreground}`}>
    <div class="flex flex-col md:flex-row">
      <Ps1 />

      <div class="flex">
        <p class="visible md:hidden command-text">❯</p>
        <span class="command-text" style="margin-left: 0.25rem;">{command}</span>
      </div>
    </div>

    {#each outputs as output}
      <div class="whitespace-pre command-text">
        {@html output}
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
</style>
