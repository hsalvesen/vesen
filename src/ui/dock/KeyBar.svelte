<!--
  The dock's key bar (designs/phone-and-instagram.md, "C. Typing"): the keys a phone keyboard
  lacks, each at least 44 by 44 px, as a labelled toolbar.

  - full: tab ↑ ↓ ^C clear ••• ⌄. ••• turns to a page of symbols (esc | > / - ~ * " $ ← →), where
    ← and → repeat while held, and back.
  - compact: tab ↑ ^C, for the one-row dock on a short screen.
  - closed: with the keyboard put away, ⌨ Type a command… (which opens it, inside the tap), ↑ and
    clear.

  tab and the arrows do what the same keys on a keyboard do (keys.ts). Holding ↑ opens the history
  sheet. While a command runs, ^C is outlined. A press never takes focus from the prompt.
-->
<script lang="ts">
  import { CLOSED_KEYS, COMPACT_KEYS, FULL_KEYS, SYMBOL_KEYS, SYMBOLS_KEY, runKey, type KeyDef, type KeyTarget } from './keys';
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

  const keys = $derived.by((): readonly KeyDef[] => {
    if (variant === 'closed') return CLOSED_KEYS;
    if (variant === 'compact') return COMPACT_KEYS;
    return symbols ? [...SYMBOL_KEYS, SYMBOLS_KEY] : FULL_KEYS;
  });

  function act(key: KeyDef): void {
    if (runKey(key.action, target) === 'symbols') symbols = !symbols;
  }
</script>

<div class="key-bar {variant}" role="toolbar" aria-label={symbols && variant === 'full' ? 'Symbols' : 'Terminal keys'}>
  {#each keys as key (key.id)}
    <button
      type="button"
      class="key"
      class:wide={key.wide === true}
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

  .key-bar.compact {
    flex: none;
    padding-right: 0;
  }

  .key {
    flex: 1 0 44px;
    min-width: 44px;
    height: 44px;
    padding: 0 6px;
    border: 1px solid transparent;
    border-radius: 6px;
    background: var(--role-chip-bg);
    color: var(--role-chip-fg);
    font: inherit;
    line-height: 1;
    white-space: nowrap;
    cursor: pointer;
    touch-action: manipulation;
    -webkit-touch-callout: none;
    user-select: none;
    -webkit-user-select: none;
  }

  .compact .key {
    flex: none;
  }

  .key.wide {
    flex: 1 1 auto;
    text-align: left;
    padding-inline: 12px;
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
