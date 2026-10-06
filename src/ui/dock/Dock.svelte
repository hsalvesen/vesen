<!--
  The phone dock (docs/plan/04-phone-and-instagram.md, "Dock, chips and key bar"; 02, section 5;
  F067). It sits in the app shell under the screen, never inside <main>, so the vintage CRT's
  filter there cannot capture the history sheet. The shell is sized to the visible viewport, so
  the dock rides directly above the soft keyboard, and the screen above it gives up the room it
  takes: it never covers the prompt.

  With the keyboard open (the prompt has focus), by the visible height:
  - full, 460px and up: the chip row (40px) over the key bar (44px);
  - compact, 300 to 459px: one 44px row, tab ↑ ^C and then the chips;
  - minimal, under 300px: the keys only.
  With the keyboard put away: the chip row, then ⌨ Type a command… ↑ clear.

  A hardware keyboard used on a touch screen hides the key bar and keeps the chips, unless
  `keys on` says otherwise (stores/prefs.ts). Holding ↑ opens the history sheet.
-->
<script lang="ts">
  import { appleTouch, isPhysicalKey } from './hardware';
  import { dockMode } from '../../platform/viewport';
  import type { Chip } from '../../shell/complete/types';
  import { hardwareKeyboard, keyBar, keyBarShown } from '../../stores/prefs';
  import { visibleArea } from '../../stores/viewport';
  import type { PromptController } from '../prompt/promptController.svelte';
  import ChipRow from './ChipRow.svelte';
  import HistorySheet from './HistorySheet.svelte';
  import KeyBar from './KeyBar.svelte';

  let { controller }: { controller: PromptController } = $props();

  const mode = $derived(dockMode($visibleArea.height));
  const typing = $derived(controller.focused);
  const keysShown = $derived(keyBarShown($keyBar, $hardwareKeyboard));
  const busy = $derived(controller.running !== null && controller.read === null);
  const chips = $derived(controller.chipList);

  let sheet = $state(false);
  /** The prompt had focus when the sheet opened: it gets it back when the sheet closes. */
  let refocus = false;

  const apple = typeof navigator === 'undefined' ? false : appleTouch(navigator);

  /** The first key from a hardware keyboard on a touch screen puts the key bar away. */
  function onkeydown(event: KeyboardEvent): void {
    if (!controller.touch || $hardwareKeyboard) return;
    if (isPhysicalKey(event, apple)) hardwareKeyboard.set(true);
  }

  function choose(chip: Chip, options?: { insert?: boolean }): void {
    controller.choose(chip, options);
  }

  function openSheet(): void {
    refocus = controller.focused;
    sheet = true;
  }

  function closeSheet(): void {
    sheet = false;
    if (refocus) controller.focus({ keyboard: true });
  }
</script>

<svelte:window onkeydowncapture={onkeydown} />

<div class="dock {mode}" class:typing data-dock-mode={mode} role="region" aria-label="Suggestions and keys">
  {#if typing}
    {#if mode === 'compact'}
      <div class="one-row">
        {#if keysShown}<KeyBar target={controller} variant="compact" {busy} onhistory={openSheet} />{/if}
        <ChipRow chips={chips.chips} more={chips.more} onchoose={choose} />
      </div>
    {:else if mode === 'minimal' && keysShown}
      <KeyBar target={controller} {busy} onhistory={openSheet} />
    {:else}
      <ChipRow chips={chips.chips} more={chips.more} onchoose={choose} />
      {#if keysShown && mode === 'full'}<KeyBar target={controller} {busy} onhistory={openSheet} />{/if}
    {/if}
  {:else}
    {#if mode !== 'minimal'}<ChipRow chips={chips.chips} more={chips.more} onchoose={choose} />{/if}
    <KeyBar target={controller} variant="closed" {busy} onhistory={openSheet} />
  {/if}
</div>

{#if sheet}
  <HistorySheet
    history={controller.history}
    oninsert={(line) => {
      sheet = false;
      controller.insert(line);
      controller.focus({ keyboard: true });
    }}
    onrun={(line) => {
      sheet = false;
      controller.submit(line, 'chip');
      if (refocus) controller.focus({ keyboard: true });
    }}
    onclose={closeSheet}
  />
{/if}

<style>
  .dock {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    padding: 2px 0 env(safe-area-inset-bottom);
    border-top: 1px solid var(--role-chip-bg);
    background: var(--theme-background);
    color: var(--role-fg);
    touch-action: manipulation;
  }

  /* The keyboard covers the home indicator, so its inset goes while it is open. */
  :global(html.kb-open) .dock {
    padding-bottom: 4px;
  }

  .one-row {
    display: flex;
    align-items: center;
    min-width: 0;
  }

  .one-row > :global(.chip-row) {
    flex: 1 1 auto;
  }
</style>
