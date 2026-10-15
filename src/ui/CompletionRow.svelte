<!--
  The completions under the prompt (docs/plan/03-terminal-input.md, "Desktop completion row and
  chips"; F067). While typing, a quiet row of the first few candidates and a count of the rest.
  After Tab, the whole list, with the Tab menu's choice marked, and a name is never cut short:
  - a short list (up to LONG_LIST candidates) has each description beside its name, in columns
    wide enough for both; the name never shrinks, so the description is what gets cut;
  - a long list is names only, in columns as wide as the longest (as `ls -C` lays them out),
    and one muted line under them names the menu's choice with its description as Tab cycles.
  On a phone the dock draws the chips, with no descriptions, so the choice's line comes on its
  own, through `choice`. Every chip keeps its description as a tooltip.
  Chips are <button role=option> in a listbox: a theme name has a small circle before it, filled,
  with the name bold in the theme's accent, for the theme in use (ui/theme-mark.ts, following the
  theme as it changes), and the typed part of each label is bold. A tap or click does what Tab would, through the same accept(), and keeps
  focus, and a phone's keyboard, on the prompt. Everything here is text, never markup. The app
  loads it in its own chunk just after the first paint: nothing completes before the kernel does.
-->
<script lang="ts">
  import type { Chip } from '../shell/complete/types';
  import { theme } from '../stores/theme';
  import { COMPLETION_LIST_ID, optionId } from './completion-ids';
  import { CURRENT_THEME_MARK, currentThemeName, isCurrentTheme, THEME_MARK } from './theme-mark';

  /** A Tab list longer than this is names only, with the choice's description on its own line. */
  const LONG_LIST = 16;
  /** In ch: the `>` before a chip that runs with its gap, a theme's circle with its gap, and a chip's padding. */
  const RUN_WIDTH = 2;
  const MARK_WIDTH = 2;
  const PADDING = 1;

  let {
    chips = [],
    more = 0,
    listed = false,
    question = null,
    announce = '',
    choice = null,
    onchoose,
  }: {
    chips?: readonly Chip[];
    /** Matches not shown, for '+N more'. */
    more?: number;
    /** The full list Tab asked for, rather than the quiet row shown while typing. */
    listed?: boolean;
    /** `Display all N possibilities? (y or n)`. */
    question?: string | null;
    /** Said politely to screen readers: 'No completions'. */
    announce?: string;
    /** The Tab menu's candidate on the line, named with its description under the list. */
    choice?: Chip | null;
    onchoose?: (chip: Chip) => void;
  } = $props();

  const runs = (chip: Chip): boolean => chip.action.kind === 'run';

  /** A long list: names only. */
  const long = $derived(listed && chips.length > LONG_LIST);

  /**
   * The widest chip in ch: its label, the > where it runs, a theme's circle, and the padding. A
   * listed column is at least this wide, so no name is ever cut.
   */
  const column = $derived.by(() => {
    let widest = 0;
    for (const chip of chips) {
      const width = [...chip.label].length + (runs(chip) ? RUN_WIDTH : 0) + (chip.theme ? MARK_WIDTH : 0);
      if (width > widest) widest = width;
    }
    return widest + PADDING;
  });

  /** The choice's line: under a long list, or the dock's chips, when the choice has a description. */
  const named = $derived(listed && (long || chips.length === 0) && choice?.summary ? choice : null);

  /** The chip's name for screen readers: what a tap does, when that is more than its label says. */
  function nameOf(chip: Chip, current: boolean): string | undefined {
    if (chip.kind === 'didyoumean') return `Did you mean ${chip.label}?`;
    if (chip.action.kind === 'run') return `Run: ${chip.line ?? chip.action.line}`;
    return current ? currentThemeName(chip.label) : undefined;
  }

  /**
   * A mouse press must not take focus from the prompt. A touch press is left alone: WebKit on iOS
   * drops the whole tap, click included, when pointerdown is cancelled, so touch relies on the
   * mousedown that follows the tap being cancelled instead.
   */
  function keepFocus(event: PointerEvent): void {
    if (event.pointerType === 'mouse') event.preventDefault();
  }
</script>

<div class="completion-row" class:listed class:long>
  {#if question}
    <div class="question">{question}</div>
  {/if}

  {#if chips.length > 0}
    <div id={COMPLETION_LIST_ID} class="chips" role="listbox" aria-label={listed ? 'Completions' : 'Suggestions'} style:--column={`${column}ch`}>
      {#each chips as chip, index (chip.id)}
        {@const current = chip.theme === true && isCurrentTheme(chip.label, $theme.name)}
        <button
          type="button"
          role="option"
          id={optionId(index)}
          class="chip kind-{chip.kind}"
          class:selected={chip.selected === true}
          class:current
          class:b={current}
          aria-selected={chip.selected === true}
          aria-label={nameOf(chip, current)}
          title={chip.summary}
          tabindex="-1"
          onpointerdown={keepFocus}
          onmousedown={(event) => event.preventDefault()}
          onclick={() => onchoose?.(chip)}
        >
          {#if runs(chip)}<span class="run" aria-hidden="true">&gt;</span>{/if}{#if chip.theme}<span class="mark" aria-hidden="true">{current ? CURRENT_THEME_MARK : THEME_MARK}</span>{/if}<span class="label"
            ><b>{chip.label.slice(0, chip.matchLen)}</b>{chip.label.slice(chip.matchLen)}</span
          >{#if listed && !long && chip.summary}<span class="summary">{chip.summary}</span>{/if}
        </button>
      {/each}
    </div>
    {#if more > 0}
      <span class="more">+{more} more</span>
    {/if}
  {/if}

  {#if named}
    <div class="choice"><span class="choice-name">{named.label}</span><span class="choice-summary">{named.summary}</span></div>
  {/if}

  <div class="sr-only" aria-live="polite">{announce}</div>
</div>

<style>
  .completion-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0 1ch;
    min-width: 0;
  }

  .question {
    flex-basis: 100%;
    color: var(--role-fg-strong);
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0 1ch;
    min-width: 0;
  }

  /* While typing: quiet, a muted line of names. */
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.5ch;
    max-width: 100%;
    padding: 0 0.5ch;
    border: 0;
    border-radius: 3px;
    background: none;
    color: var(--role-muted);
    font: inherit;
    text-align: left;
    white-space: pre;
    cursor: pointer;
  }

  /* A hovered chip is the chip colours throughout: its name, a folder's link colour, its
     description and the > that marks a run alike, the one pair checked for contrast (lib/roles.ts). */
  .chip:not(.selected):hover,
  .chip:not(.selected):hover .label,
  .chip:not(.selected):hover .summary,
  .chip:not(.selected):hover .run {
    background: var(--role-chip-bg);
    color: var(--role-chip-fg);
  }

  .label {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .label b {
    font-weight: bold;
  }

  .kind-dir .label {
    color: var(--role-link);
  }

  /* A theme's small circle, in the chip's own colour. */
  .mark {
    flex: none;
  }

  .run {
    color: var(--role-accent);
  }

  /* After Tab: the whole list in columns at least --column wide (set from the chips), so a name
     is never cut. A short list has each description beside its name, in columns wide enough for
     both: 36ch, or the longest name and 10ch of description. A name wider than the terminal
     widens its column and the list scrolls sideways, never the page. */
  .listed .chips {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(max(36ch, calc(var(--column) + 10ch)), 100%), 1fr));
    justify-content: start;
    width: 100%;
    overflow-x: auto;
  }

  /* A long list: names only, in columns as wide as the longest, as `ls -C` lays them out. */
  .long .chips {
    grid-template-columns: repeat(auto-fill, minmax(min(var(--column), 100%), max-content));
  }

  .listed .chip {
    color: var(--role-fg-strong);
  }

  /* The theme in use: its circle and name bold, in the theme's accent, which reads against the
     background in every theme (lib/roles.ts). A hover keeps the chip's fill; the Tab menu's
     choice still shows over it. */
  .chip.current:not(.selected),
  .chip.current:not(.selected) .label {
    color: var(--role-accent);
    font-weight: bold;
  }

  /* The name never shrinks; the description is what gets cut. */
  .listed .label {
    flex: none;
    overflow: visible;
  }

  .summary {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--role-muted);
  }

  .chip.selected,
  .chip.selected .summary,
  .chip.selected .label {
    background: var(--role-selection);
    color: var(--role-fg-strong);
  }

  /* Forced colours (Windows contrast themes) replace the fill: the Tab menu's choice is
     outlined in the system's highlight instead. */
  @media (forced-colors: active) {
    .chip.selected {
      outline: 2px solid Highlight;
      outline-offset: -2px;
    }
  }

  /* The menu's choice, named under a long list (or the dock's chips) with its description. */
  .choice {
    flex-basis: 100%;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: pre;
    color: var(--role-muted);
  }

  .choice-name {
    color: var(--role-fg);
  }

  .choice-summary {
    margin-left: 2ch;
  }

  .more {
    color: var(--role-muted);
    white-space: nowrap;
  }

  /* A thumb needs a 44px target. */
  @media (pointer: coarse) {
    .chip {
      min-height: 44px;
      padding: 0 1ch;
    }

    .more {
      line-height: 44px;
    }
  }

  .chip:active {
    opacity: 0.6;
  }
</style>
