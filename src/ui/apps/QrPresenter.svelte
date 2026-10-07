<!--
  Present mode (docs/plan/06-qr.md; designs/qr.md, "Phone and Instagram in-app browser"): a white
  sheet over everything with the code as large as fits, so a visitor can hold the phone up for a
  friend to scan, or save it. The code is a PNG, black on white, which a long press saves; Save,
  Share and Copy show where they work. It closes with ✕, Esc, q or Enter, a tap outside the code,
  and Back (Android's button, iOS's swipe): opening it adds a history entry with no URL of its
  own, and going back from it closes it. The screen stays awake while it shows, where it can.

  It is a modal dialog: focus starts on ✕ and Tab stays inside. `qr -f` shows it through AppHost,
  which puts focus back afterwards; a tapped card draws it in a layer on <body> (qr-present.ts)
  and puts focus back itself.
-->
<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { asQrView, displayPayload, metaLine, middleEllipsis, pngDataUrl, raisedNote, type QrView } from '../../lib/qr';
  import { browserHost, copy, pageClipboard, pngFor, qrEnv, save, share, STATUS_MS, type QrEnv } from '../../services/qr-actions';
  import { measureWidth } from '../components/qr-measure';
  import type { AppProps } from './registry';

  let { props, close }: AppProps = $props();

  /** A tapped card hands over { view, env }; `qr -f` hands over the view itself. */
  function read(value: unknown): { view: QrView | null; env: Partial<QrEnv> } {
    const request = (typeof value === 'object' && value !== null ? value : {}) as { view?: unknown; env?: unknown };
    if ('view' in request) {
      const env = typeof request.env === 'object' && request.env !== null ? (request.env as Partial<QrEnv>) : {};
      return { view: asQrView(request.view), env };
    }
    return { view: asQrView(value), env: {} };
  }

  // svelte-ignore state_referenced_locally
  const { view, env: given } = read(props);
  const host = browserHost();
  const env: QrEnv = { ...qrEnv(host), ...given };
  const write = pageClipboard(host);
  const src = view === null ? '' : pngDataUrl(pngFor(view));
  const display = view === null ? '' : displayPayload(view.payload);
  const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  let sheet: HTMLElement | undefined = $state();
  let closeButton: HTMLButtonElement | undefined = $state();
  let textWidth = $state(0);
  let status = $state('');
  let statusTimer: ReturnType<typeof setTimeout> | undefined;

  /** The payload in two lines of 16px monospace at most, cut in the middle. */
  const shown = $derived.by(() => {
    const perLine = textWidth > 0 ? Math.max(12, Math.floor(textWidth / (16 * 0.6))) : 40;
    return middleEllipsis(display, perLine * 2);
  });

  // ── Back closes it ──
  const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  let pushed = false;
  let finished = false;

  function ours(): boolean {
    const state = history.state as { vesenQr?: unknown } | null;
    return state !== null && typeof state === 'object' && state.vesenQr === token;
  }

  /** Closes the dialog; `fromBack` when Back already left its history entry. */
  function finish(fromBack = false): void {
    if (finished) return;
    finished = true;
    if (pushed && !fromBack && ours()) history.back();
    close();
  }

  function onPopState(): void {
    if (!ours()) finish(true);
  }

  // ── Keys and focus ──
  function focusables(): HTMLElement[] {
    return Array.from(sheet?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])') ?? []);
  }

  function onKey(event: KeyboardEvent): void {
    if (finished || event.defaultPrevented) return;
    const target = event.target instanceof Element ? event.target : null;
    const onControl = target?.closest('button, a[href]') != null;
    const plain = !event.ctrlKey && !event.metaKey && !event.altKey;
    if (event.key === 'Tab') {
      const list = focusables();
      const first = list[0];
      const last = list[list.length - 1];
      if (first === undefined || last === undefined) return;
      const active = document.activeElement;
      const inside = active instanceof Node && sheet?.contains(active) === true;
      if (event.shiftKey ? !inside || active === first : !inside || active === last) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
      return;
    }
    let handled = true;
    if (event.key === 'Escape') finish();
    else if (plain && (event.key === 'q' || event.key === 'Q')) finish();
    else if (plain && event.key === 'Enter' && !onControl) finish();
    else if (plain && event.key === 's' && !env.inApp) onSave();
    else if (plain && event.key === 'c') void onCopy();
    else handled = false;
    if (handled) {
      // Not the prompt's: Esc there would stop a running line.
      event.preventDefault();
      event.stopPropagation();
    }
  }

  /** A tap outside the code and the controls closes it. */
  function onSheetClick(event: MouseEvent): void {
    const target = event.target instanceof Element ? event.target : null;
    if (target === null || target.closest('img, button, a, .payload, .meta, .hint, .status') !== null) return;
    finish();
  }

  // ── Actions ──
  function say(text: string): void {
    clearTimeout(statusTimer);
    status = text;
    if (text !== '') statusTimer = setTimeout(() => (status = ''), STATUS_MS);
  }

  function onSave(): void {
    if (view !== null) say(save(host, view, 'png', env));
  }

  async function onShare(): Promise<void> {
    if (view !== null) say(await share(host, view));
  }

  async function onCopy(): Promise<void> {
    if (view !== null) say(await copy(view, write));
  }

  // ── The screen stays awake ──
  let lock: WakeLockSentinel | null = null;

  async function stayAwake(): Promise<void> {
    if (finished || lock !== null || document.visibilityState !== 'visible') return;
    try {
      const wake = (navigator as Navigator & { wakeLock?: WakeLock }).wakeLock;
      if (wake === undefined) return;
      const sentinel = await wake.request('screen');
      if (finished) void sentinel.release().catch(() => {});
      else {
        lock = sentinel;
        sentinel.addEventListener('release', () => {
          if (lock === sentinel) lock = null;
        });
      }
    } catch {
      // Not allowed here, or low battery: the screen sleeps as usual.
    }
  }

  function onVisibility(): void {
    void stayAwake();
  }

  let focusTimer: ReturnType<typeof setTimeout> | undefined;

  onMount(() => {
    try {
      history.pushState({ vesenQr: token }, '');
      pushed = true;
    } catch {
      pushed = false;
    }
    void stayAwake();
    document.addEventListener('visibilitychange', onVisibility);
    // After AppHost has focused itself, so ✕ ends up with focus either way.
    focusTimer = setTimeout(() => closeButton?.focus({ preventScroll: true }), 0);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  });

  onDestroy(() => {
    clearTimeout(statusTimer);
    clearTimeout(focusTimer);
    if (lock !== null) void lock.release().catch(() => {});
    lock = null;
    // Taken down from outside (^C on qr -f): leave no history entry behind.
    if (!finished && pushed && ours()) history.back();
    finished = true;
  });
</script>

<svelte:window onkeydowncapture={onKey} onpopstate={onPopState} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  class="qr-present"
  class:instant={reduceMotion}
  role="dialog"
  aria-modal="true"
  aria-labelledby="qr-present-title"
  tabindex="-1"
  data-qr-present
  bind:this={sheet}
  onclick={onSheetClick}
>
  <button type="button" class="close" aria-label="Close" bind:this={closeButton} onclick={() => finish()}>✕</button>
  {#if view === null}
    <p id="qr-present-title" class="payload">This code could not be shown.</p>
  {:else}
    <h2 id="qr-present-title" class="sr-only">QR code for {display}</h2>
    <img class="code" {src} alt="QR code for {display}" />
    <div class="details">
      <p class="payload" title={view.payload} use:measureWidth={(w) => (textWidth = w)}>{shown}</p>
      <!-- Each label stays with its value ('mask 0'): the line wraps only between them. -->
      <p class="meta" title={raisedNote(view)}>{#each metaLine(view).split(' · ') as part, i}{#if i > 0}{' · '}{/if}<span class="together">{part}</span>{/each}</p>
      {#if env.inApp}
        <p class="hint">Press and hold the code to save it, or take a screenshot</p>
      {/if}
      <div class="actions">
        {#if !env.inApp}
          <button type="button" onclick={onSave}>Save image</button>
        {/if}
        {#if env.canShareFiles}
          <button type="button" onclick={onShare}>Share</button>
        {/if}
        <button type="button" onclick={onCopy}>{view.kind === 'link' ? 'Copy link' : 'Copy text'}</button>
      </div>
      <p class="status" role="status" aria-live="polite">{status}</p>
    </div>
  {/if}
</div>

<style>
  /* Fixed to the viewport, over everything, with no reliance on 100vh: inset 0 and the safe areas. */
  .qr-present {
    position: fixed;
    inset: 0;
    z-index: 40;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: max(16px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) max(16px, env(safe-area-inset-bottom))
      max(16px, env(safe-area-inset-left));
    overflow-y: auto;
    overscroll-behavior: contain;
    background: #fff;
    color: #000;
    font-family: var(--term-font, monospace);
    text-shadow: none;
    animation: qr-present-in 160ms ease-out;
    outline: none;
  }

  .qr-present.instant {
    animation: none;
  }

  @keyframes qr-present-in {
    from {
      opacity: 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .qr-present {
      animation: none;
    }
  }

  .close {
    position: absolute;
    top: max(8px, env(safe-area-inset-top));
    right: max(8px, env(safe-area-inset-right));
    min-width: 44px;
    min-height: 44px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: #000;
    font: inherit;
    font-size: 24px;
    cursor: pointer;
  }

  /* As large as fits: the whole width less the margins, or the height less the text below it. */
  .code {
    display: block;
    width: min(100vw - 32px, 100vh - 220px);
    height: auto;
    aspect-ratio: 1;
    image-rendering: pixelated;
    -webkit-touch-callout: default;
    user-select: auto;
  }

  @supports (height: 100dvh) {
    .code {
      width: min(100vw - 32px, 100dvh - 220px);
    }
  }

  /* What goes with the code: under it, or beside it on a phone held sideways. */
  .details {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    width: 100%;
    min-width: 0;
  }

  .payload {
    width: min(100%, 40rem);
    margin: 0;
    font-size: 16px;
    line-height: 1.3;
    text-align: center;
    overflow-wrap: anywhere;
    user-select: text;
  }

  .meta,
  .hint,
  .status {
    margin: 0;
    font-size: 14px;
    text-align: center;
  }

  .meta,
  .hint {
    color: #444;
  }

  .together {
    white-space: nowrap;
  }

  .status {
    min-height: 1.3em;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 8px;
  }

  .actions button {
    min-height: 44px;
    padding: 0 16px;
    border: 1px solid #000;
    border-radius: 8px;
    background: #fff;
    color: #000;
    font: inherit;
    font-size: 15px;
    cursor: pointer;
  }

  .actions button:active {
    background: #000;
    color: #fff;
  }

  .close:focus-visible,
  .actions button:focus-visible {
    outline: 3px solid #0a58ca;
    outline-offset: 2px;
  }

  /* A phone on its side: the height would leave the code smaller than on the card, so the text
     and buttons go beside it and the code takes the whole height less the margins. */
  @media (orientation: landscape) and (max-height: 500px) {
    .qr-present {
      flex-direction: row;
      gap: 24px;
    }

    .code {
      flex: none;
      width: min(100vh - max(16px, env(safe-area-inset-top)) - max(16px, env(safe-area-inset-bottom)), 100vw - 360px);
    }

    @supports (height: 100dvh) {
      .code {
        width: min(100dvh - max(16px, env(safe-area-inset-top)) - max(16px, env(safe-area-inset-bottom)), 100vw - 360px);
      }
    }

    .details {
      flex: 0 1 320px;
      width: auto;
    }
  }
</style>
