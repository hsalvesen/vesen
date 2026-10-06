<script lang="ts">
  import { HOST } from '../constants';

  const currentDir = '~';

  let { isPasswordMode = false }: { isPasswordMode?: boolean } = $props();
</script>

<!-- Role colours (--role-prompt-*), so earlier prompts follow the theme too. -->
{#if isPasswordMode}
  <span class="flex">
    <span class="punct">Password:</span>
  </span>
{:else}
  <span class="font-bold flex">
    <span class="user">guest</span>
    <span class="punct">@</span>
    <span class="host">{HOST}</span>
    <span class="punct">:</span>
    <span class="path">{currentDir}</span>
    <span class="punct">$</span>
  </span>
{/if}

<style>
  .user {
    color: var(--role-prompt-user);
  }

  .host {
    color: var(--role-prompt-host);
  }

  .path {
    color: var(--role-prompt-path);
  }

  .punct {
    color: var(--role-fg-strong);
  }
</style>
