<!--
  The alternate screen (docs/plan/designs/shell-architecture.md, "AppHost"): a command's
  full-screen app, drawn over the whole terminal, dock included, until it closes. It sits outside
  <main>, whose vintage CRT filter would capture a fixed child, and the shell under it is inert
  meanwhile, so keys, taps and screen readers reach only the app.

  Each app has one history entry while it shows (apps/history-entry.ts), so Back (Android's
  button, iOS's edge swipe) closes the app rather than leaving vesen: Back calls the app's own
  back(), which closes it the way q or ^X would (nano asks to save first, and keeps its entry
  while it asks), and an app that closes itself takes its entry off again.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import type { AppRequest } from '../shell/index';
  import { holdHistoryEntry, type HistoryEntry } from './apps/history-entry';
  import { appLoader, type AppExports } from './apps/registry';

  let { request, onclose }: { request: AppRequest; onclose: (id: number, result?: unknown) => void } = $props();

  let host: HTMLElement | undefined = $state();
  /** The app on screen, once its chunk has come: its back() is what Back does. */
  let instance: AppExports | undefined = $state.raw();
  let entry: HistoryEntry | null = null;

  const app = $derived.by(() => {
    const load = appLoader(request.view);
    return load === undefined ? Promise.reject(new Error(`no app called ${request.view}`)) : load().then((module) => module.default);
  });

  const close = (result?: unknown): void => {
    entry?.release();
    onclose(request.id, result);
  };

  /** Back left the app's entry: the app closes as it closes itself, or asks first. */
  function back(): void {
    if (instance?.back !== undefined) instance.back();
    // Not loaded yet, or it could not load: the command goes on without it.
    else close();
  }

  onMount(() => {
    entry = holdHistoryEntry(back);
    // The app takes focus from the prompt, so keys come here.
    host?.focus({ preventScroll: true });
    // Taken down from outside (^C, or another app): its entry goes too.
    return () => entry?.release();
  });
</script>

<div class="app-host" role="dialog" aria-modal="true" aria-label={request.view} tabindex="-1" bind:this={host}>
  {#await app then App}
    <App props={request.props} {close} bind:this={instance} />
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
