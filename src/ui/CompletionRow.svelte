<!--
  The completions under the prompt (docs/plan/03-terminal-input.md, "Desktop completion row and
  chips"; F067). While typing, a quiet row of the first few candidates and a count of the rest;
  after Tab, the whole list, with each candidate's description, and the Tab menu's choice marked.
  Chips are <button role=option> in a listbox: a theme name carries its colour, and the typed part
  of each label is bold. A tap or click does what Tab would, through the same accept(), and keeps
  focus, and a phone's keyboard, on the prompt. Everything here is text, never markup.
-->
<script module lang="ts">
  /** The listbox's id, for the input's aria-controls. */
  export const COMPLETION_LIST_ID = 'completion-list';

  /** The id of the option at `index`, for the input's aria-activedescendant. */
  export function optionId(index: number): string {
    return `${COMPLETION_LIST_ID}-${index}`;
  }
</script>

<script lang="ts">
  import type { Chip } from '../shell/complete/types';

  let {
    chips = [],
    more = 0,
    listed = false,
    question = null,
    announce = '',
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
    onchoose?: (chip: Chip) => void;
  } = $props();

  const runs = (chip: Chip): boolean => chip.action.kind === 'run';

  /** The chip's name for screen readers: what a tap does, when that is more than its label says. */
  function nameOf(chip: Chip): string | undefined {
    if (chip.kind === 'didyoumean') return `Did you mean ${chip.label}?`;
    if (chip.action.kind === 'run') return `Run: ${chip.line ?? chip.action.line}`;
    return undefined;
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

<div class="completion-row" class:listed>
  {#if question}
    <div class="question">{question}</div>
  {/if}

  {#if chips.length > 0}
    <div id={COMPLETION_LIST_ID} class="chips" role="listbox" aria-label={listed ? 'Completions' : 'Suggestions'}>
      {#each chips as chip, index (chip.id)}
        <button
          type="button"
          role="option"
          id={optionId(index)}
          class="chip kind-{chip.kind}"
          class:selected={chip.selected === true}
          aria-selected={chip.selected === true}
          aria-label={nameOf(chip)}
          title={chip.summary}
          tabindex="-1"
          onpointerdown={keepFocus}
          onmousedown={(event) => event.preventDefault()}
          onclick={() => onchoose?.(chip)}
        >
          {#if chip.swatch}<span class="swatch" style:background={chip.swatch} aria-hidden="true"></span>{/if}<span class="label"
            ><b>{chip.label.slice(0, chip.matchLen)}</b>{chip.label.slice(chip.matchLen)}</span
          >{#if runs(chip)}<span class="run" aria-hidden="true"> ⏎</span>{/if}{#if listed && chip.summary}<span class="summary">{chip.summary}</span>{/if}
        </button>
      {/each}
    </div>
    {#if more > 0}
      <span class="more">+{more} more</span>
    {/if}
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

  .chip:hover {
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

  .swatch {
    flex: none;
    width: 0.9em;
    height: 0.9em;
    border: 1px solid var(--role-muted);
    border-radius: 50%;
  }

  .run {
    color: var(--role-accent);
  }

  /* After Tab: the whole list, a candidate and its description per cell. */
  .listed .chips {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(24ch, 100%), 1fr));
    width: 100%;
  }

  .listed .chip {
    color: var(--role-fg-strong);
  }

  .summary {
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
