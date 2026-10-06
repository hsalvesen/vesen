<!--
  The history sheet (designs/phone-and-instagram.md, "C. Typing"): holding ↑ on the key bar opens
  this sheet from the bottom of the screen, listing recent commands, newest first. A tap puts a
  line at the prompt; a long press runs it. A swipe down on its top, Escape, the close button or
  a tap outside closes it. It is a modal dialog: focus moves into it and stays there until it
  closes.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { press } from './press';

  /** The most lines the sheet lists. */
  const MAX_LINES = 50;
  /** A drag down further than this closes the sheet. */
  const SWIPE_CLOSE_PX = 60;

  let {
    history = [],
    oninsert,
    onrun,
    onclose,
  }: {
    /** Command history, oldest first. */
    history?: readonly string[];
    oninsert?: (line: string) => void;
    onrun?: (line: string) => void;
    onclose?: () => void;
  } = $props();

  // Newest first, each line once.
  const lines = $derived.by(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (let i = history.length - 1; i >= 0 && out.length < MAX_LINES; i -= 1) {
      const line = history[i] ?? '';
      if (line.trim() === '' || seen.has(line)) continue;
      seen.add(line);
      out.push(line);
    }
    return out;
  });

  let sheet: HTMLElement | undefined = $state();
  let drag = $state(0);

  function focusables(): HTMLElement[] {
    return sheet ? Array.from(sheet.querySelectorAll<HTMLElement>('button:not([disabled])')) : [];
  }

  onMount(() => {
    // Into the sheet: its newest line, or the close button.
    const [close, first] = focusables();
    (first ?? close ?? sheet)?.focus({ preventScroll: true });
  });

  function onkeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onclose?.();
      return;
    }
    if (event.key !== 'Tab') return;
    // Focus stays in the sheet: Tab from the last goes to the first, Shift+Tab the other way.
    const all = focusables();
    const first = all[0];
    const last = all[all.length - 1];
    if (first === undefined || last === undefined) return;
    const active = sheet?.ownerDocument.activeElement;
    if (event.shiftKey && (active === first || !sheet?.contains(active ?? null))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !sheet?.contains(active ?? null))) {
      event.preventDefault();
      first.focus();
    }
  }

  /** A drag down on the sheet's top: it follows the finger, and far enough closes the sheet. */
  function swipeDown(node: HTMLElement): { destroy(): void } {
    let from: number | null = null;
    const grab = (event: PointerEvent): void => {
      from = event.clientY;
      drag = 0;
      node.setPointerCapture?.(event.pointerId);
    };
    const move = (event: PointerEvent): void => {
      if (from !== null) drag = Math.max(0, event.clientY - from);
    };
    const release = (): void => {
      if (from === null) return;
      from = null;
      const far = drag > SWIPE_CLOSE_PX;
      drag = 0;
      if (far) onclose?.();
    };
    node.addEventListener('pointerdown', grab);
    node.addEventListener('pointermove', move);
    node.addEventListener('pointerup', release);
    node.addEventListener('pointercancel', release);
    return {
      destroy() {
        node.removeEventListener('pointerdown', grab);
        node.removeEventListener('pointermove', move);
        node.removeEventListener('pointerup', release);
        node.removeEventListener('pointercancel', release);
      },
    };
  }
</script>

<div class="backdrop" aria-hidden="true" use:press={{ tap: () => onclose?.() }}></div>
<div
  bind:this={sheet}
  class="sheet"
  role="dialog"
  aria-modal="true"
  aria-labelledby="history-sheet-title"
  tabindex="-1"
  style:transform={drag > 0 ? `translateY(${drag}px)` : undefined}
  {onkeydown}
>
  <div class="grab" use:swipeDown>
    <span class="handle" aria-hidden="true"></span>
    <div class="head">
      <h2 id="history-sheet-title">History</h2>
      <button type="button" class="close" aria-label="Close history" use:press={{ tap: () => onclose?.() }}>✕</button>
    </div>
  </div>
  {#if lines.length === 0}
    <p class="empty">No commands yet.</p>
  {:else}
    <ul class="lines">
      {#each lines as line (line)}
        <li>
          <button
            type="button"
            class="line"
            aria-label={`Insert: ${line}`}
            use:press={{ tap: () => oninsert?.(line), longPress: () => onrun?.(line) }}>{line}</button
          >
        </li>
      {/each}
    </ul>
  {/if}
  <p class="hint">Tap to put a line at the prompt; hold to run it.</p>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 20;
    background: rgba(0, 0, 0, 0.45);
  }

  .sheet {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 21;
    display: flex;
    flex-direction: column;
    max-height: min(70%, 520px);
    padding: 0 0 max(8px, env(safe-area-inset-bottom));
    border-top: 1px solid var(--role-accent);
    border-radius: 12px 12px 0 0;
    background: var(--theme-background);
    color: var(--role-fg);
    font: inherit;
    outline: none;
  }

  .grab {
    flex: none;
    touch-action: none;
    cursor: grab;
  }

  .handle {
    display: block;
    width: 40px;
    height: 4px;
    margin: 8px auto 0;
    border-radius: 2px;
    background: var(--role-muted);
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 4px 0 16px;
  }

  h2 {
    margin: 0;
    font: inherit;
    font-weight: bold;
    color: var(--role-fg-strong);
  }

  .close {
    width: 44px;
    height: 44px;
    border: 0;
    background: none;
    color: var(--role-fg);
    font: inherit;
    cursor: pointer;
    touch-action: manipulation;
  }

  .lines {
    flex: 1 1 auto;
    min-height: 0;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    list-style: none;
  }

  .line {
    display: block;
    width: 100%;
    min-height: 44px;
    padding: 0 16px;
    border: 0;
    border-top: 1px solid var(--role-chip-bg);
    background: none;
    color: var(--role-fg-strong);
    font: inherit;
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: pointer;
    touch-action: manipulation;
    -webkit-touch-callout: none;
    user-select: none;
    -webkit-user-select: none;
  }

  .line:active,
  .close:active {
    background: var(--role-chip-bg);
    color: var(--role-chip-fg);
  }

  .line:focus-visible,
  .close:focus-visible {
    outline: 2px solid var(--role-accent);
    outline-offset: -2px;
  }

  .empty,
  .hint {
    margin: 0;
    padding: 8px 16px;
    color: var(--role-muted);
  }
</style>
