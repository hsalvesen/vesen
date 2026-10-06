<script lang="ts">
  import { HOST } from '../constants';
  import { theme } from '../stores/theme';

  const currentDir = '~';

  let { isPasswordMode = false }: { isPasswordMode?: boolean } = $props();
</script>

{#if isPasswordMode}
  <span class="flex">
    <span style={`color: ${$theme.white}`}>Password:</span>
  </span>
{:else}
  <span class="font-bold flex">
    <span style={`color: ${$theme.yellow};`}>guest</span>
    <span style={`color: ${$theme.white}`}>@</span>
    <span style={`color: ${$theme.green}`}>{HOST}</span>
    <span style={`color: ${$theme.white}`}>:</span>
    <span style={`color: ${$theme.blue}`}>{currentDir}</span>
    <span style={`color: ${$theme.white}`}>$</span>
  </span>
{/if}
