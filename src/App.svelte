<script lang="ts">
  import Ps1 from './components/Ps1.svelte';
  import Input from './components/Input.svelte';
  import History from './components/History.svelte';
  import CommandSuggestionsRow from './components/CommandSuggestionsRow.svelte';
  import Cathode from './components/Cathode.svelte';
  import { theme } from './stores/theme';
  import { interruptJob } from './stores/job';
  // Importing the store ensures the CRT effect's <html> classes are applied on
  // first paint (restoring a persisted mode without a flash of the flat theme).
  import './stores/cathode';
  
  let isPasswordMode = $state(false);
  let isProcessing = $state(false);
  let loadingText = $state('');
  let command = $state('');
  let mainElement: HTMLElement;
  let suggestionsScrollTop = $state<number | null>(null);

  // Phones get a tap target; keyboards get the shortcut. Both can click the line.
  const cancelHint =
    typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches
      ? 'tap to cancel'
      : 'Ctrl+C to cancel';

  const onSuggestionsShow = () => {
    if (!mainElement) return;
    if (suggestionsScrollTop === null) {
      suggestionsScrollTop = mainElement.scrollTop;
    }
    setTimeout(() => {
      if (mainElement) mainElement.scrollTop = mainElement.scrollHeight;
    }, 0);
  };

  const onSuggestionsHide = () => {
    if (!mainElement) return;
    if (suggestionsScrollTop === null) return;
    const restoreTo = suggestionsScrollTop;
    suggestionsScrollTop = null;
    setTimeout(() => {
      if (mainElement) mainElement.scrollTop = restoreTo;
    }, 0);
  };

  const onSuggestionsUpdate = () => {
    if (!mainElement) return;
    if (suggestionsScrollTop === null) {
      suggestionsScrollTop = mainElement.scrollTop;
    }
    setTimeout(() => {
      if (mainElement) mainElement.scrollTop = mainElement.scrollHeight;
    }, 0);
  };

  // Auto-scroll to bottom when loading text appears
  $effect(() => {
    if (isProcessing && loadingText && mainElement) {
      setTimeout(() => {
        if (mainElement) mainElement.scrollTop = mainElement.scrollHeight;
      }, 0);
    }
  });
</script>

<main
  bind:this={mainElement}
  class="h-full border-2 rounded-md p-2 sm:p-4 overflow-auto text-xs sm:text-sm md:text-base"
  style={`background-color: ${$theme.background}; color: ${$theme.foreground}; border-color: ${$theme.green};`}
>
  <History />

  <div class="flex flex-col">
    <div class="grid items-center gap-x-1" style="grid-template-columns: max-content 1fr;">
      <div class="flex items-center">
        <Ps1 {isPasswordMode} />
      </div>
      <Input bind:command bind:isPasswordMode bind:isProcessing bind:loadingText />
    </div>

    <CommandSuggestionsRow {command} {isProcessing} {isPasswordMode} on:show={onSuggestionsShow} on:hide={onSuggestionsHide} on:update={onSuggestionsUpdate} />

    {#if isProcessing && loadingText}
      <!-- pointerdown is cancelled so the tap does not take focus, and the keyboard, from the prompt. -->
      <button
        type="button"
        class="processing font-mono mt-1"
        aria-label="Cancel running command"
        onpointerdown={(event) => event.preventDefault()}
        onclick={() => interruptJob()}
      >{loadingText} ({cancelHint})</button>
    {/if}
  </div>
</main>

<Cathode />

<style>
  .processing {
    display: block;
    width: 100%;
    padding: 0;
    border: 0;
    background: none;
    text-align: left;
    color: var(--theme-cyan);
    cursor: pointer;
  }

  @media (pointer: coarse) {
    .processing {
      min-height: 44px;
    }
  }
</style>


