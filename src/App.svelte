<script lang="ts">
  import Ps1 from './components/Ps1.svelte';
  import Input from './components/Input.svelte';
  import History from './components/History.svelte';
  import CommandSuggestionsRow from './components/CommandSuggestionsRow.svelte';
  import { theme } from './stores/theme';
  
  let isPasswordMode = $state(false);
  let isProcessing = $state(false);
  let loadingText = $state('');
  let command = $state('');
  let mainElement: HTMLElement;
  let suggestionsScrollTop = $state<number | null>(null);

  const onSuggestionsShow = () => {
    if (!mainElement) return;
    if (suggestionsScrollTop === null) {
      suggestionsScrollTop = mainElement.scrollTop;
    }
    setTimeout(() => {
      mainElement.scrollTop = mainElement.scrollHeight;
    }, 0);
  };

  const onSuggestionsHide = () => {
    if (!mainElement) return;
    if (suggestionsScrollTop === null) return;
    const restoreTo = suggestionsScrollTop;
    suggestionsScrollTop = null;
    setTimeout(() => {
      mainElement.scrollTop = restoreTo;
    }, 0);
  };

  const onSuggestionsUpdate = () => {
    if (!mainElement) return;
    if (suggestionsScrollTop === null) {
      suggestionsScrollTop = mainElement.scrollTop;
    }
    setTimeout(() => {
      mainElement.scrollTop = mainElement.scrollHeight;
    }, 0);
  };

  // Auto-scroll to bottom when loading text appears
  $effect(() => {
    if (isProcessing && loadingText && mainElement) {
      setTimeout(() => {
        mainElement.scrollTop = mainElement.scrollHeight;
      }, 0);
    }
  });
</script>

<svelte:head>
  {#if import.meta.env.VITE_TRACKING_ENABLED === 'true'}
    <script
      async
      defer
      data-website-id={import.meta.env.VITE_TRACKING_SITE_ID}
      src={import.meta.env.VITE_TRACKING_URL}
    ></script>
  {/if}
</svelte:head>

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
      <div class="flex flex-row items-center gap-1 mt-1">
        <span class="font-mono" style="color: var(--theme-cyan);">{loadingText}</span>
      </div>
    {/if}
  </div>
</main>


