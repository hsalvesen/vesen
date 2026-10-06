<!--
  The dock's row of chips (designs/phone-and-instagram.md, "B. Exploring by tapping"; F067): a
  horizontally scrolling listbox of the chips the prompt offers now. A chip's label is the word it
  completes; its name for screen readers says the whole of what a tap does. A tap does what the
  chip says: a completion goes on the line exactly as Tab would put it there, and a chip marked ⏎
  runs its line. A long press on a chip that runs puts its line at the prompt instead, to edit.
  Pressing a chip never takes focus from the prompt, so the keyboard stays as it was. A new set of
  chips starts scrolled to its first; the Tab menu's choice is kept in view.
-->
<script lang="ts">
  import type { Chip } from '../../shell/complete/types';
  import { COMPLETION_LIST_ID, optionId } from '../CompletionRow.svelte';
  import { chipName, leadGlyph, runsLine } from './chip-name';
  import { press } from './press';

  let {
    chips = [],
    more = 0,
    onchoose,
  }: {
    chips?: readonly Chip[];
    /** Matches not shown. */
    more?: number;
    onchoose?: (chip: Chip, options?: { insert?: boolean }) => void;
  } = $props();

  let list: HTMLElement | undefined = $state();

  const signature = $derived(chips.map((chip) => chip.id).join('\n'));
  $effect(() => {
    void signature;
    if (list) list.scrollLeft = 0;
  });

  const selected = $derived(chips.findIndex((chip) => chip.selected === true));
  $effect(() => {
    if (selected === -1 || !list) return;
    const option = list.querySelector<HTMLElement>(`#${optionId(selected)}`);
    option?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  });
</script>

<div class="chip-row">
  {#if chips.length > 0}
    <div bind:this={list} id={COMPLETION_LIST_ID} class="chips" role="listbox" aria-label="Suggestions" aria-orientation="horizontal">
      {#each chips as chip, index (chip.id)}
        {@const lead = leadGlyph(chip)}
        {@const runs = runsLine(chip)}
        <button
          type="button"
          role="option"
          id={optionId(index)}
          class="chip kind-{chip.kind}"
          class:emphasis={chip.action.kind === 'interrupt'}
          class:selected={chip.selected === true}
          aria-selected={chip.selected === true}
          aria-label={chipName(chip)}
          title={chip.summary}
          tabindex="-1"
          use:press={{
            tap: () => onchoose?.(chip),
            ...(runs ? { longPress: () => onchoose?.(chip, { insert: true }) } : {}),
          }}
        >
          {#if lead}<span class="glyph" aria-hidden="true">{lead}</span>{/if}{#if chip.swatch}<span
              class="swatch"
              style:background={chip.swatch}
              aria-hidden="true"
            ></span>{/if}<span class="label"><b>{chip.label.slice(0, chip.matchLen)}</b>{chip.label.slice(chip.matchLen)}</span
          >{#if runs && !lead}<span class="glyph run" aria-hidden="true">⏎</span>{/if}
        </button>
      {/each}
      {#if more > 0}
        <span class="more">+{more}</span>
      {/if}
    </div>
  {/if}
</div>

<style>
  /* One row, the same height whatever it holds, so the screen above never jumps as the chips
     come and go: 36px chips with room around them, or the 44px cancel chip. */
  .chip-row {
    display: flex;
    align-items: center;
    min-width: 0;
    height: 44px;
  }

  .chips {
    display: flex;
    flex: 1 1 auto;
    align-items: center;
    gap: 6px;
    min-width: 0;
    height: 100%;
    padding: 0 12px;
    overflow-x: auto;
    overscroll-behavior-x: contain;
    scroll-snap-type: x proximity;
    scrollbar-width: none;
    /* The row fades at its edges, so a chip cut off says there are more. */
    mask-image: linear-gradient(to right, transparent 0, #000 10px, #000 calc(100% - 16px), transparent 100%);
    -webkit-mask-image: linear-gradient(to right, transparent 0, #000 10px, #000 calc(100% - 16px), transparent 100%);
  }

  .chips::-webkit-scrollbar {
    display: none;
  }

  .chip {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: 0.5ch;
    max-width: 80vw;
    height: 36px;
    padding: 0 12px;
    border: 1px solid transparent;
    border-radius: 18px;
    background: var(--role-chip-bg);
    color: var(--role-chip-fg);
    font: inherit;
    white-space: pre;
    scroll-snap-align: start;
    cursor: pointer;
    touch-action: manipulation;
    -webkit-touch-callout: none;
    user-select: none;
    -webkit-user-select: none;
  }

  .label {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .label b {
    font-weight: bold;
  }

  .glyph {
    flex: none;
    color: var(--role-accent);
  }

  .swatch {
    flex: none;
    width: 0.9em;
    height: 0.9em;
    border: 1px solid var(--role-muted);
    border-radius: 50%;
  }

  .kind-current {
    border-color: var(--role-accent);
  }

  /* While a command runs: one large chip to stop it. */
  .chip.emphasis {
    height: 44px;
    padding: 0 18px;
    border-color: var(--role-accent);
  }

  .chip.selected {
    border-color: var(--role-accent);
    background: var(--role-selection);
    color: var(--role-fg-strong);
  }

  .chip:active {
    opacity: 0.6;
  }

  .chip:focus-visible {
    outline: 2px solid var(--role-accent);
    outline-offset: 1px;
  }

  .more {
    flex: none;
    color: var(--role-muted);
    white-space: nowrap;
  }
</style>
