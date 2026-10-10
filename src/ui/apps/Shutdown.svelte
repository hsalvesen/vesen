<!--
  The Shutdown app (docs/plan/04-phone-and-instagram.md, "Inside Instagram's browser";
  designs/phone-and-instagram.md, "G"): systemd's lines one after another, a fade (at once under
  reduced motion), then '● vesen is off' and [Power on] behind a power symbol (inline SVG: the
  terminal's font has no glyph for one), which hands the command its result so it starts a new
  session with the files kept. A desktop also powers on at any key. Inside an in-app browser it
  says how to close the page; nothing ever calls window.close or rewrites the page, so the
  visitor is never left on a dead one. A reboot comes straight back up.
-->
<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import { POWER_ON, type ShutdownView } from '../../shell/shutdown';

  let { props, close }: { props: unknown; close: (result?: unknown) => void } = $props();

  /** Between lines, before the fade, the fade itself, and a reboot's pause before it is back. */
  const LINE_MS = 120;
  const SETTLE_MS = 400;
  const FADE_MS = 700;
  const REBOOT_MS = 600;

  function viewOf(value: unknown): ShutdownView {
    const raw = (typeof value === 'object' && value !== null ? value : {}) as Partial<ShutdownView>;
    return {
      kind: raw.kind === 'reboot' ? 'reboot' : 'poweroff',
      lines: Array.isArray(raw.lines) ? raw.lines.filter((line): line is string => typeof line === 'string') : [],
      inApp: raw.inApp === true,
      touch: raw.touch === true,
    };
  }

  // svelte-ignore state_referenced_locally
  const view = viewOf(props);
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const OK = '[  OK  ]';

  let shown = $state(reduce ? view.lines.length : 0);
  let phase: 'lines' | 'fading' | 'off' = $state('lines');
  let button: HTMLButtonElement | undefined = $state();
  const timers: ReturnType<typeof setTimeout>[] = [];
  let done = false;

  function later(ms: number, run: () => void): void {
    timers.push(setTimeout(run, ms));
  }

  function powerOn(): void {
    if (done) return;
    done = true;
    close(POWER_ON);
  }

  /** Back (AppHost) powers on: the visitor stays in vesen, never on a dead page. */
  export function back(): void {
    powerOn();
  }

  async function off(): Promise<void> {
    phase = 'off';
    if (view.kind === 'reboot') {
      later(reduce ? 0 : REBOOT_MS, powerOn);
      return;
    }
    await tick();
    button?.focus({ preventScroll: true });
  }

  function fade(): void {
    phase = 'fading';
    later(reduce ? 0 : FADE_MS, () => void off());
  }

  function next(): void {
    if (shown < view.lines.length) {
      shown += 1;
      later(LINE_MS, next);
    } else later(reduce ? 0 : SETTLE_MS, fade);
  }

  /** On a desktop, any key powers on once vesen is off. */
  function onKey(event: KeyboardEvent): void {
    if (phase !== 'off' || view.kind === 'reboot') return;
    if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Tab'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    powerOn();
  }

  onMount(() => {
    if (reduce) later(0, fade);
    else next();
  });

  onDestroy(() => {
    for (const timer of timers) clearTimeout(timer);
  });
</script>

<svelte:window onkeydown={onKey} />

<div class="shutdown">
  {#if phase !== 'off'}
    <div class="lines" class:fading={phase === 'fading'} class:instant={reduce} style="--fade: {FADE_MS}ms" role="log" aria-live="polite">
      {#each view.lines.slice(0, shown) as line, index (index)}
        <div class="line">{#if line.startsWith(OK)}[  <span class="ok">OK</span>  ]{line.slice(OK.length)}{:else}{line}{/if}</div>
      {/each}
    </div>
  {:else if view.kind === 'reboot'}
    <p class="state" role="status">Starting vesen…</p>
  {:else}
    <div class="off">
      <p class="state" role="status"><span class="dot" aria-hidden="true">●</span> vesen is off</p>
      <button type="button" class="power" bind:this={button} onclick={powerOn}
        ><svg class="icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.25v5.5" /><path d="M5.25 4.5a4.5 4.5 0 1 0 5.5 0" /></svg>Power on</button
      >
      {#if !view.touch}
        <p class="hint">or press any key</p>
      {/if}
      {#if view.inApp}
        <p class="hint">Close this page with ×</p>
      {/if}
    </div>
  {/if}
</div>

<style>
  .shutdown {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-height: 0;
    padding: max(16px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) max(16px, env(safe-area-inset-bottom))
      max(16px, env(safe-area-inset-left));
    font-family: var(--term-font, monospace);
    font-size: var(--term-fs, 13px);
    line-height: var(--term-lh, 1.35);
  }

  .lines {
    overflow: hidden;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    transition: opacity var(--fade) ease-out;
  }

  .lines.fading {
    opacity: 0;
  }

  .lines.instant {
    transition: none;
  }

  .ok {
    color: var(--role-ok, var(--theme-green));
  }

  .off {
    margin: auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    text-align: center;
  }

  .state {
    margin: auto;
  }

  .off .state {
    margin: 0;
  }

  .dot,
  .hint {
    color: var(--role-muted, var(--theme-bright-black));
  }

  .hint {
    margin: 0;
  }

  .power {
    display: inline-flex;
    align-items: center;
    gap: 1ch;
    min-height: 44px;
    padding: 0 20px;
    border: 1px solid var(--role-accent, var(--theme-green));
    border-radius: 999px;
    background: transparent;
    color: var(--role-accent, var(--theme-green));
    font: inherit;
    cursor: pointer;
  }

  .icon {
    flex: none;
    width: 1em;
    height: 1em;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linecap: round;
  }

  .power:active,
  .power:focus-visible {
    background: var(--role-accent, var(--theme-green));
    color: var(--theme-background);
  }

  @media (prefers-reduced-motion: reduce) {
    .lines {
      transition: none;
    }
  }
</style>
