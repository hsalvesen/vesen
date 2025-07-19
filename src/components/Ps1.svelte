<script>
  import { theme } from '../stores/theme';
  let hostname = window.location.hostname;
  let currentDir = '~';
  
  let { isPasswordMode = false } = $props();
</script>

{#if isPasswordMode}
  <h1 class="flex">
    <span style={`color: ${$theme.white}`}>Password:</span>
  </h1>
{:else}
  <h1 class="font-bold flex">
    <span style={`color: ${$theme.yellow};`}>guest</span>
    <span style={`color: ${$theme.white}`}>@</span>
    <span style={`color: ${$theme.green}`}>{hostname}</span>
    <span style={`color: ${$theme.white}`}>:</span>
    <span style={`color: ${$theme.blue}`}>{currentDir}</span>
    <span style={`color: ${$theme.white}`}>$</span>
  </h1>
{/if}
