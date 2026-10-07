<!--
  The dock's key bar (designs/phone-and-instagram.md, "C. Typing"): the keys a phone keyboard
  lacks, each 44px tall, as a labelled toolbar.

  - full: tab ↑ ↓ ^C clear ••• ⌄. ••• turns to a page of symbols (••• ← → esc | > / - ~ * " $),
    where ••• comes back first and ← and → repeat while held.
  - compact: tab ↑ ^C, for the one-row dock on a short screen.
  - closed: with the keyboard put away, ⌨ Type a command… (which opens it, inside the tap, and
    brings the prompt into view), ↑ and clear.

  The keys share the width, so all of them fit from 320px: 41px each at 320, wider above; word
  keys draw smaller on a narrow screen. Should a screen still be too narrow, the bar scrolls
  sideways and fades at the edge with more beyond it. tab and the arrows do what the same keys
  on a keyboard do (keys.ts). Holding ↑ opens the history sheet. While a command runs, ^C is
  outlined. A press never takes focus from the prompt.
-->
<script lang="ts">
  import { CLOSED_KEYS, COMPACT_KEYS, FULL_KEYS, SYMBOLS_PAGE, runKey, type KeyDef, type KeyTarget } from './keys';
  import { overflowEdges } from './overflow';
  import { press } from './press';

  let {
    target,
    variant = 'full',
    busy = false,
    onhistory,
  }: {
    target: KeyTarget;
    variant?: 'full' | 'compact' | 'closed';
    /** A command is running: ^C stands out. */
    busy?: boolean;
    /** ↑ was held: open the history sheet. */
    onhistory?: () => void;
  } = $props();

  let symbols = $state(false);
  const page = $derived(symbols && variant === 'full');

  const keys = $derived.by((): readonly KeyDef[] => {
    if (variant === 'closed') return CLOSED_KEYS;
    if (variant === 'compact') return COMPACT_KEYS;
    return symbols ? SYMBOLS_PAGE : FULL_KEYS;
  });

  function act(key: KeyDef): void {
    if (runKey(key.action, target) === 'symbols') symbols = !symbols;
  }
</script>

<div class="key-bar {variant}" class:symbols={page} role="toolbar" aria-label={page ? 'Symbols' : 'Terminal keys'} use:overflowEdges>
  {#each keys as key (key.id)}
    <button
      type="button"
      class="key"
      class:wide={key.wide === true}
      class:word={key.wide !== true && Array.from(key.label).length > 2}
      class:emphasis={busy && key.id === 'interrupt'}
      data-key={key.id}
      aria-label={key.ariaLabel}
      aria-pressed={key.id === 'symbols' ? symbols : undefined}
      use:press={{
        tap: () => act(key),
        ...(key.repeat === true ? { repeat: true } : {}),
        ...(key.holdForHistory === true && onhistory ? { hold: onhistory } : {}),
      }}>{key.label}</button
    >
  {/each}
</div>

<style>
  .key-bar {
    display: flex;
    gap: 4px;
    min-width: 0;
    padding: 0 4px;
    overflow-x: auto;
    overscroll-behavior-x: contain;
    scrollbar-width: none;
  }

  .key-bar::-webkit-scrollbar {
    display: none;
  }

  /* More keys beyond an edge: it fades, as the chip row does. */
  .key-bar:global(.more-right) {
    mask-image: linear-gradient(to right, #000 calc(100% - 20px), transparent);
    -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 20px), transparent);
  }

  .key-bar:global(.more-left) {
    mask-image: linear-gradient(to left, #000 calc(100% - 20px), transparent);
    -webkit-mask-image: linear-gradient(to left, #000 calc(100% - 20px), transparent);
  }

  .key-bar:global(.more-left.more-right) {
    mask-image: linear-gradient(to right, transparent, #000 20px, #000 calc(100% - 20px), transparent);
    -webkit-mask-image: linear-gradient(to right, transparent, #000 20px, #000 calc(100% - 20px), transparent);
  }

  .key-bar.compact {
    flex: none;
    padding-right: 0;
  }

  /* Twelve keys on the symbols page: closer together, so they fit at 320px too. */
  .key-bar.symbols {
    gap: 2px;
  }

  /* The keys share the bar's width, and never go narrower than a fingertip. */
  .key {
    flex: 1 1 0;
    min-width: 24px;
    height: 44px;
    padding: 0 2px;
    border: 1px solid transparent;
    border-radius: 6px;
    background: var(--role-chip-bg);
    color: var(--role-chip-fg);
    font: inherit;
    line-height: 1;
    white-space: nowrap;
    overflow: hidden;
    cursor: pointer;
    touch-action: manipulation;
    -webkit-touch-callout: none;
    user-select: none;
    -webkit-user-select: none;
  }

  /* tab, clear, esc: smaller on a narrow screen, so the word stays inside its key. */
  @media (max-width: 359px) {
    .key.word {
      font-size: 0.85em;
    }
  }

  .compact .key {
    flex: none;
    min-width: 44px;
    padding: 0 6px;
  }

  .key.wide {
    flex: 1 1 auto;
    text-align: left;
    padding-inline: 12px;
  }

  /* With the keyboard put away only the Type bar grows; ↑ and clear keep their size, even in
     landscape. */
  .closed .key:not(.wide) {
    flex: 0 0 auto;
    min-width: 64px;
    padding: 0 6px;
  }

  .key[aria-pressed='true'] {
    border-color: var(--role-accent);
  }

  .key.emphasis {
    border-color: var(--role-accent);
    box-shadow: inset 0 0 0 1px var(--role-accent);
  }

  .key:active {
    opacity: 0.6;
  }

  .key:focus-visible {
    outline: 2px solid var(--role-accent);
    outline-offset: -2px;
  }
</style>
