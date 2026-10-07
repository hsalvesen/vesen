<!--
  The QR card (the `qr-card` component block; docs/plan/06-qr.md, "What visitors get"): a head line
  with exactly what was encoded, the code, its meta line, what scanning does, and the actions.

  The code is one SVG path in the theme's QR ink on its QR paper, inside a 4-module quiet zone,
  each module a whole number of device pixels: 8 CSS pixels on a desktop, up to 10 on a phone,
  shrunk to fit the terminal (and on a phone to fit 296 pixels, so a friend's camera can take it
  in from arm's length). It sits above the CRT overlay, so scanlines never cross it; vintage mode's
  filter keeps it under the glass, so the hint offers full screen there. With -t utf8, utf8i or
  ascii it is text art instead (light on an ink field, rows 1.2 lines high so the modules are
  square, never wrapped); art that would need a font under 8 pixels is drawn as the card.

  Every action is a button made here from the trusted view model, never from the payload's text.
  A tap on the card never focuses the prompt (ui/actions/focusPolicy.ts), and its buttons never
  take focus from it, so a phone's keyboard stays as it was. Tapping the code opens Present mode,
  in a layer on <body> (apps/qr-present.ts), and focus goes back where it was when it closes.
-->
<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import {
    asQrView,
    cardHint,
    displayPayload,
    formatPx,
    metaLine,
    middleEllipsis,
    moduleSize,
    raisedNote,
    textColumns,
    toSvgPath,
    toText,
    type QrView,
  } from '../../lib/qr';
  import { browserHost, copy, pageClipboard, qrEnv, save, share, STATUS_MS, type QrEnv } from '../../services/qr-actions';
  import { cathode, crtTier } from '../../stores/cathode';
  import { presentLayer } from '../apps/qr-present';
  import QrPresenter from '../apps/QrPresenter.svelte';
  import { measureWidth } from './qr-measure';
  import type { ComponentBlockProps } from './registry';

  let { view: raw, alt }: ComponentBlockProps = $props();

  /** The smallest font text art may be drawn at before it becomes a card. */
  const MIN_ART_PX = 8;
  /** The most room a phone gives the card: min(content width, 320 px), as the plan sets it. */
  const PHONE_ROOM = 320;
  /**
   * The widest the code gets in that room: 12 px stays clear either side, so a thumb can scroll
   * past the code without tapping it, and a v2 or v3 code is 264 to 296 px on a 375 px phone.
   */
  const PHONE_MAX_PX = 296;

  const view: QrView | null = $derived(asQrView(raw));
  const host = browserHost();
  const env: QrEnv = qrEnv(host);
  const write = pageClipboard(host);
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;

  let root: HTMLElement | undefined = $state();
  let width = $state(0);
  let fontPx = $state(13);
  let chRatio = $state(0.6);

  // The terminal's font size and cell width (styles/tokens.css), for fitting text art and the head line.
  onMount(() => {
    if (!root) return;
    const win = root.ownerDocument.defaultView;
    fontPx = Number.parseFloat(win?.getComputedStyle(root).fontSize ?? '') || 13;
    chRatio = Number.parseFloat(win?.getComputedStyle(root.ownerDocument.documentElement).getPropertyValue('--ch-ratio') ?? '') || 0.6;
  });

  const display = $derived(view === null ? '' : displayPayload(view.payload));
  const columns = $derived(width > 0 ? Math.floor(width / (fontPx * chRatio)) : 0);
  // The head line: `qr ` and the payload on one line where it fits.
  const shown = $derived(columns > 0 ? middleEllipsis(display, Math.max(12, columns - 3)) : middleEllipsis(display, 72));

  // ── Text art, or the card it falls back to ──
  const style = $derived(view === null || view.options.type === 'svg' ? null : view.options.type);
  const art = $derived(view === null || style === null ? null : toText(view, { style, margin: view.options.margin }));
  const artColumns = $derived(view === null || style === null ? 0 : textColumns(view, { style, margin: view.options.margin }));
  const artPx = $derived(width > 0 && artColumns > 0 ? Math.min(fontPx, width / (artColumns * chRatio)) : fontPx);
  const asArt = $derived(art !== null && artPx >= MIN_ART_PX);
  const artNote = $derived(
    art !== null && !asArt ? `note: ${style ?? 'text'} art needs ${artColumns} columns; this screen fits ${columns}. Showing an image instead.` : null,
  );

  // ── The card ──
  // Text art that became a card still gets the standard quiet zone.
  const margin = $derived(view === null ? 4 : view.options.type === 'svg' ? view.options.margin : Math.max(4, view.options.margin));
  const total = $derived(view === null ? 0 : view.size + 2 * margin);
  const room = $derived(env.touch ? Math.min(width > 0 ? width : PHONE_ROOM, PHONE_ROOM) - (PHONE_ROOM - PHONE_MAX_PX) : width);
  const sized = $derived(
    moduleSize(total, room, dpr, {
      cap: env.touch ? 10 : 8,
      ...(view !== null && typeof view.options.size === 'number' ? { requested: view.options.size } : {}),
    }),
  );
  const side = $derived(sized.px * total);
  const path = $derived(view === null || asArt ? '' : toSvgPath(view, margin));

  const vintage = $derived($cathode === 'vintage' && $crtTier.tier !== 'off');
  const hint = $derived(view === null ? '' : cardHint({ kind: view.kind, touch: env.touch, vintage }));
  const notes = $derived.by(() => {
    const list: string[] = [...(view?.tips ?? [])];
    if (artNote !== null) list.push(artNote);
    if (!asArt && sized.clamped) list.push(`note: size reduced to ${formatPx(sized.px)} px to fit this window`);
    if (!asArt && sized.dense) list.push(`note: ${formatPx(sized.px)} px modules are dense for a phone screen. Tap the code for full screen.`);
    return list;
  });

  // ── Actions ──
  let status = $state('');
  let statusTimer: ReturnType<typeof setTimeout> | undefined;
  let copyFailed = $state(false);
  let fallback: HTMLElement | undefined = $state();

  function say(text: string): void {
    clearTimeout(statusTimer);
    status = text;
    if (text !== '') statusTimer = setTimeout(() => (status = ''), STATUS_MS);
  }

  /** Keeps focus, and a phone's keyboard, where it was. */
  function keepFocus(event: MouseEvent): void {
    event.preventDefault();
  }

  /** Present mode, with where focus was when it opened; null while it is closed. */
  let presenting: { readonly returnFocus: Element | null } | null = $state(null);

  function present(): void {
    if (view === null || presenting !== null) return;
    presenting = { returnFocus: root?.ownerDocument.activeElement ?? null };
  }

  /** Closes Present mode, and gives focus back where it was, so the keyboard is as it was. */
  async function endPresent(): Promise<void> {
    const back = presenting?.returnFocus;
    presenting = null;
    await tick();
    if (back instanceof HTMLElement && back.isConnected) back.focus({ preventScroll: true });
  }

  function onSave(format: 'png' | 'svg'): void {
    if (view !== null) say(save(host, view, format, env));
  }

  async function onShare(): Promise<void> {
    if (view !== null) say(await share(host, view));
  }

  async function onCopy(): Promise<void> {
    if (view === null) return;
    const message = await copy(view, write);
    copyFailed = message !== 'Copied.';
    say(message);
    if (!copyFailed) return;
    // Copying failed: the payload is shown selected, for a long press or Ctrl+C.
    await tick();
    const selection = fallback?.ownerDocument.defaultView?.getSelection();
    if (fallback && selection) {
      const range = fallback.ownerDocument.createRange();
      range.selectNodeContents(fallback);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }

  onDestroy(() => clearTimeout(statusTimer));
</script>

{#if view !== null}
  <div class="qr" role="group" aria-label={alt} data-qr-card bind:this={root} use:measureWidth={(w) => (width = w)}>
    <div class="qr-head"><span class="qr-name">qr</span> <span class="qr-payload" title={view.payload}>{shown}</span>{#if view.note !== undefined}<span class="qr-dim">{` · ${view.note}`}</span>{/if}</div>
    {#if asArt && art !== null}
      <div
        class="qr-text"
        class:qr-text-ascii={style === 'ascii'}
        data-qr-text
        aria-hidden="true"
        style="font-size: {artPx}px"
      >{art.join('\n')}</div><span class="sr-only">{alt}</span>
    {:else}
      <button
        type="button"
        class="qr-figure"
        data-qr-figure
        style="width: {side}px; height: {side}px"
        aria-label="QR code for {display}. Show full screen"
        onmousedown={keepFocus}
        onclick={present}
      >
        <svg viewBox="0 0 {total} {total}" width={side} height={side} shape-rendering="crispEdges" aria-hidden="true" focusable="false">
          <rect width={total} height={total} style="fill: var(--role-qr-paper, #fff)" />
          <path d={path} fill="none" stroke-width="1" style="stroke: var(--role-qr-ink, #000)" />
        </svg>
      </button>
    {/if}
    <div class="qr-dim qr-meta" title={raisedNote(view)}>{metaLine(view)}</div>
    {#each notes as note}
      <div class="qr-dim">{note}</div>
    {/each}
    <div class="qr-hint">{hint}</div>
    <div class="qr-actions" role="group" aria-label="QR code actions">
      <button type="button" class="chip" onmousedown={keepFocus} onclick={present}>full screen</button>
      {#if !env.touch && !env.inApp}
        <button type="button" class="chip" onmousedown={keepFocus} onclick={() => onSave('png')}>save png</button>
        <button type="button" class="chip" onmousedown={keepFocus} onclick={() => onSave('svg')}>save svg</button>
      {/if}
      {#if env.touch && env.canShareFiles}
        <button type="button" class="chip" onmousedown={keepFocus} onclick={onShare}>share</button>
      {/if}
      <button type="button" class="chip" onmousedown={keepFocus} onclick={onCopy}>copy</button>
    </div>
    {#if copyFailed}
      <div class="qr-fallback" bind:this={fallback}>{view.payload}</div>
    {/if}
    <div class="qr-dim qr-status" role="status" aria-live="polite">{status}</div>
  </div>
  {#if presenting !== null}
    <div use:presentLayer data-qr-present-host><QrPresenter props={{ view, env }} close={endPresent} /></div>
  {/if}
{/if}

<style>
  .qr {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    margin: 4px 0;
    min-width: 0;
    max-width: 100%;
    white-space: normal;
  }

  .qr-head,
  .qr-dim,
  .qr-hint,
  .qr-fallback {
    max-width: 100%;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .qr-name {
    color: var(--role-accent, var(--theme-cyan));
    font-weight: bold;
  }

  .qr-payload {
    color: var(--role-fg-strong, var(--theme-foreground));
  }

  .qr-dim {
    color: var(--role-muted, var(--theme-bright-black));
  }

  .qr-hint {
    color: var(--role-fg, var(--theme-foreground));
  }

  .qr-status:empty {
    display: none;
  }

  .qr-fallback {
    user-select: all;
    -webkit-user-select: all;
    -webkit-touch-callout: default;
  }

  /* The code: paper with rounded corners, lifted above the CRT overlay (z-index 2 in
     styles/crt.css) so scanlines never cross it. Nothing between it and the overlay makes a
     stacking context, except vintage mode's filter on the transcript, which keeps it under. */
  .qr-figure {
    position: relative;
    z-index: 3;
    display: block;
    flex: none;
    box-sizing: content-box;
    margin: 4px 0;
    padding: 0;
    border: 0;
    border-radius: 6px;
    overflow: hidden;
    background: var(--role-qr-paper, #fff);
    text-shadow: none;
    cursor: zoom-in;
  }

  .qr-figure svg {
    display: block;
  }

  .qr-figure:focus-visible {
    outline: 2px solid var(--role-accent, var(--theme-cyan));
    outline-offset: 2px;
  }

  /* Text art: light modules on an ink field, two module rows a line, rows 1.2 lines high so each
     module is as tall as a cell is wide. Never wrapped; selectable, so it can be copied. Lifted
     above the CRT overlay, as the card is. */
  .qr-text {
    position: relative;
    z-index: 3;
    display: block;
    flex: none;
    max-width: 100%;
    margin: 4px 0;
    overflow-x: auto;
    white-space: pre;
    overflow-wrap: normal;
    word-break: normal;
    line-height: 1.2;
    letter-spacing: 0;
    font-variant-ligatures: none;
    font-weight: normal;
    text-shadow: none;
    background: var(--role-qr-ink, #000);
    color: var(--role-qr-paper, #fff);
    user-select: text;
    -webkit-user-select: text;
  }

  /* ascii marks the dark modules, so it is ink on paper. */
  .qr-text-ascii {
    background: var(--role-qr-paper, #fff);
    color: var(--role-qr-ink, #000);
  }

  .qr-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5ch 1ch;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    padding: 0 1ch;
    border: 1px solid var(--role-chip-fg, var(--theme-foreground));
    border-radius: 4px;
    background: var(--role-chip-bg, transparent);
    color: var(--role-chip-fg, var(--theme-foreground));
    font: inherit;
    cursor: pointer;
  }

  .chip:active {
    background: var(--role-chip-fg, var(--theme-foreground));
    color: var(--theme-background);
  }

  /* A thumb's target on a touch screen. */
  @media (pointer: coarse) {
    .chip {
      min-height: 44px;
      padding: 0 1.5ch;
    }
  }
</style>
