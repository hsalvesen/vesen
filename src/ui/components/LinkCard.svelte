<!--
  A link card (the `card` block; designs/phone-and-instagram.md, "G. Links, email and in-app
  fallbacks"): the title, the link as a real anchor, and Copy. A tapped link opens in a new tab in
  a browser and in the same view inside an in-app browser, so Back comes back to the terminal.

  Copy uses the Clipboard API, then execCommand (services/clipboard.ts). It shows '✓ Copied' for
  two seconds and says so politely; if copying fails, the text is selected and the card says to
  press and hold. Inside an in-app browser a card may also offer the real browser, always beside
  the manual instruction; that only ever happens on a tap.

  Everything is drawn in the terminal's font, so the only marks are glyphs it has: → before a
  link and after a button that leaves the page, ✓ once copied. The buttons are the chips every
  card uses, with words on them.
-->
<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { readableUrl, safeHref, type CardBlock } from '../../output/model';
  import { linkPolicy } from '../links';

  let { card }: { card: CardBlock } = $props();

  /** How long '✓ Copied' stays. */
  const COPIED_MS = 2000;

  const links = linkPolicy();
  const href = $derived(safeHref(card.href));
  const mail = $derived(/^mailto:/i.test(card.href));
  const label = $derived(card.label ?? readableUrl(card.href));
  const copyText = $derived(card.copy ?? card.href);
  // A mail link never needs a tab of its own.
  const target = $derived(mail ? undefined : links.target);
  const escape = $derived(card.escape !== undefined && links.inApp !== null ? card.escape : null);
  const escapeHref = $derived(escape === null ? null : links.escapeHref(escape.url));
  const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform ?? '');
  const failHint = $derived(links.touch ? 'Press and hold to copy' : `Press ${isMac ? 'Cmd+C' : 'Ctrl+C'} to copy`);

  let copied = $state(false);
  let failed = $state(false);
  /** What the polite status region says. */
  let status = $state('');
  let fallback: HTMLElement | undefined = $state();
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function copy(): Promise<void> {
    clearTimeout(timer);
    const ok = await links.copy(copyText);
    if (ok) {
      failed = false;
      copied = true;
      status = 'Copied';
      timer = setTimeout(() => {
        copied = false;
        status = '';
      }, COPIED_MS);
      return;
    }
    copied = false;
    failed = true;
    status = `Could not copy. ${failHint}.`;
    await tick();
    select(fallback);
  }

  /** Selects the text to copy, so a long press (or Ctrl+C) can take it. */
  function select(element: HTMLElement | undefined): void {
    const selection = element?.ownerDocument.defaultView?.getSelection();
    if (!element || !selection) return;
    const range = element.ownerDocument.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  onDestroy(() => clearTimeout(timer));
</script>

<div class="card" role="group" aria-label={card.title}>
  <div class="card-title">{card.title}</div>
  {#if card.openLabel !== undefined || href === null}
    <div class="card-label">{label}</div>
  {:else}
    <a class="card-url" {href} {target} rel="noopener noreferrer"><span aria-hidden="true">{'→ '}</span>{label}</a>
  {/if}
  {#if card.detail !== undefined}
    <div class="card-detail">{card.detail}</div>
  {/if}
  <div class="card-actions">
    {#if card.openLabel !== undefined && href !== null}
      <!-- A plain anchor, so a tap is the browser's own navigation: nothing cancels it. -->
      <a class="chip card-open" {href} {target} rel="noopener noreferrer">{card.openLabel}<span class="arrow" aria-hidden="true">{' →'}</span></a>
    {/if}
    <!-- mousedown is cancelled so a click does not take focus, and the keyboard, from the prompt. -->
    <button type="button" class="chip card-copy" onmousedown={(event) => event.preventDefault()} onclick={copy}>
      {copied ? '✓ Copied' : (card.copyLabel ?? 'Copy')}
    </button>
  </div>
  {#if failed}
    <div class="card-fallback"><span class="card-copy-text" bind:this={fallback}>{copyText}</span><span class="muted">{` ${failHint}`}</span></div>
  {/if}
  {#if escape !== null && links.inApp !== null}
    {#if escape.hint !== undefined}
      <div class="muted">{escape.hint}</div>
    {/if}
    <div class="card-escape">
      <span class="muted">{links.inApp.menuHint}</span>
      {#if escapeHref !== null}
        <button type="button" class="chip card-external" onclick={() => links.openExternal(escape.url)}>Open in {links.inApp.browser}<span class="arrow" aria-hidden="true">{' →'}</span></button>
      {/if}
    </div>
  {/if}
  <span class="sr-only" role="status" aria-live="polite">{status}</span>
</div>

<style>
  .card {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    margin: 4px 0;
    padding-left: 1ch;
    border-left: 2px solid var(--role-link, var(--theme-bright-blue));
    max-width: 100%;
    min-width: 0;
  }

  .card-title {
    color: var(--role-fg-strong, var(--theme-foreground));
    font-weight: bold;
  }

  .card-url {
    color: var(--role-link, var(--theme-bright-blue));
    text-decoration: underline;
    text-underline-offset: 2px;
    overflow-wrap: anywhere;
  }

  .card-label,
  .card-detail,
  .card-fallback {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .card-copy-text {
    user-select: all;
    -webkit-user-select: all;
    -webkit-touch-callout: default;
  }

  .muted {
    color: var(--role-muted, var(--theme-bright-black));
  }

  .card-actions,
  .card-escape {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5ch 1ch;
    margin-top: 2px;
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
    text-decoration: none;
    cursor: pointer;
  }

  .chip:active {
    background: var(--role-chip-fg, var(--theme-foreground));
    color: var(--theme-background);
  }

  /* The arrow is a flex item of its own, so its leading space would collapse without this. */
  .arrow {
    white-space: pre;
  }

  /* A thumb's target on a touch screen. */
  @media (pointer: coarse) {
    .chip {
      min-height: 36px;
      padding: 0 1.5ch;
    }
  }
</style>
