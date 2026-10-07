<!--
  The alternate screen (docs/plan/designs/shell-architecture.md, "AppHost"): a command's
  full-screen app, drawn over the whole terminal, dock included, until it closes. It sits outside
  <main>, whose vintage CRT filter would capture a fixed child, and the shell under it is inert
  meanwhile, so keys, taps and screen readers reach only the app.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import type { AppRequest } from '../shell/index';
  import { appLoader } from './apps/registry';

  let { request, onclose }: { request: AppRequest; onclose: (id: number, result?: unknown) => void } = $props();

  let host: HTMLElement | undefined = $state();

  const app = $derived.by(() => {
    const load = appLoader(request.view);
    return load === undefined ? Promise.reject(new Error(`no app called ${request.view}`)) : load().then((module) => module.default);
  });

  // The app takes focus from the prompt, so keys come here.
  onMount(() => host?.focus({ preventScroll: true }));

  const close = (result?: unknown): void => onclose(request.id, result);
</script>

<div class="app-host" role="dialog" aria-modal="true" aria-label={request.view} tabindex="-1" bind:this={host}>
  {#await app then App}
    <App props={request.props} {close} />
  {:catch}
    <!-- Its chunk did not load: say so, and let the command go on. -->
    <div class="app-failed">
      <p>This screen could not load. Check the connection.</p>
      <button type="button" onclick={() => close()}>Back to the terminal</button>
    </div>
  {/await}
</div>

<style>
  .app-host {
    position: absolute;
    inset: 0;
    z-index: 20;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--theme-background);
    color: var(--role-fg, var(--theme-foreground));
    outline: none;
  }

  .app-failed {
    margin: auto;
    padding: 16px;
    text-align: center;
  }

  .app-failed button {
    padding: 4px 12px;
    border: 1px solid currentColor;
    border-radius: 4px;
    background: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
</style>
