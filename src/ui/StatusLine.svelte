<!--
  The status line under a running line's entry (docs/plan/designs/shell-architecture.md, "LOADING,
  CANCEL AND ERRORS"; F013, F047): a braille spinner (a still '…' under reduced motion), what the
  command is doing (its spec's loadingLabel or what it set with tty.status(); 'Processing…' when
  it says nothing), the seconds it has run once it has run three, then how to stop it: the keys on
  a keyboard, a Stop chip on touch. The whole line is one button that stops the command, so a tap
  or a click anywhere on it does.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { DEFAULT_LABEL, ELAPSED_FROM_S, formatElapsed, SPINNER, STILL } from './status-line';

  let {
    label = null,
    startedAt = 0,
    touch = false,
    onstop,
  }: {
    /** What the command is doing; null for the default. */
    label?: string | null;
    /** When it started, in Date.now() time; 0 when not known, which counts from now. */
    startedAt?: number;
    /** A touch screen: a Stop chip in place of the keys. */
    touch?: boolean;
    onstop: () => void;
  } = $props();

  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // svelte-ignore state_referenced_locally
  const since = startedAt > 0 ? startedAt : Date.now();
  let frame = $state(0);
  let now = $state(Date.now());

  onMount(() => {
    // Still under reduced motion, so the clock alone moves, and only as often as it needs to.
    const timer = setInterval(
      () => {
        if (!reduce) frame = (frame + 1) % SPINNER.length;
        now = Date.now();
      },
      reduce ? 250 : 100,
    );
    return () => clearInterval(timer);
  });

  const text = $derived(label === null || label.trim() === '' ? DEFAULT_LABEL : label);
  const seconds = $derived(Math.max(0, Math.floor((now - since) / 1000)));
</script>

<!--
  mousedown is cancelled so the tap does not take focus, and the keyboard, from the prompt. Not
  pointerdown: WebKit on iOS drops the whole tap, click included, when pointerdown is cancelled.
-->
<button
  type="button"
  class="status-line"
  class:touch
  aria-label="Stop: {text}"
  onmousedown={(event) => event.preventDefault()}
  onclick={() => onstop()}
>
  <span class="spinner" aria-hidden="true">{reduce ? STILL : SPINNER[frame]}</span>
  <span class="what">{text}{#if seconds >= ELAPSED_FROM_S}<span class="elapsed">{` · ${formatElapsed(seconds)}`}</span>{/if}</span>
  {#if touch}
    <span class="stop-chip">■ Stop</span>
  {:else}
    <span class="hint">(Ctrl+C or Esc to stop)</span>
  {/if}
</button>

<style>
  /* The parts sit in a row with a cell between them, and wrap as whole parts on a narrow screen. */
  .status-line {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    column-gap: 1ch;
    width: 100%;
    padding: 0;
    border: 0;
    background: none;
    text-align: left;
    color: var(--role-accent);
    font: inherit;
    cursor: pointer;
  }

  .spinner {
    flex: none;
    width: 1ch;
  }

  .what {
    min-width: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .elapsed,
  .hint {
    color: var(--role-muted);
  }

  /* On touch the line is a 44px target, with Stop as a chip at its end. */
  .status-line.touch {
    align-items: center;
    min-height: 44px;
  }

  .stop-chip {
    margin-left: auto;
    padding: 2px 12px;
    border: 1px solid var(--role-error);
    border-radius: 999px;
    color: var(--role-error);
    white-space: nowrap;
  }

  /* Feedback for a tap, in place of the tap highlight styles/shell.css turns off. */
  .status-line:active {
    opacity: 0.6;
  }
</style>
