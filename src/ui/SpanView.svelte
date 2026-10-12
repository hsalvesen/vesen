<!--
  One span of output, drawn with text interpolation only. A trusted action becomes a button, a
  checked http, https or mailto href becomes a link, and live bindings read the theme and cathode
  stores, so old output stays true after either changes: the marker moves to the current theme or
  CRT mode, and the name of the current one says so to a screen reader. Swatches are two full
  blocks (██) each, drawn in their own colours (hex, checked again here, or palette tokens), for the eye only. A
  press on an action never takes focus from the prompt, so a phone's keyboard stays as it was
  (02, section 5), as the dock's chips do.
-->
<script lang="ts">
  import { colourVar, hexColour, isPalette, isTrustedAction, safeHref, SWATCH, type Action, type HexColour, type Span } from '../output/model';
  import { theme } from '../stores/theme';
  import { cathode } from '../stores/cathode';
  import { linkPolicy } from './links';
  import { spanClasses, spanCss } from './span-style';

  let { span, onaction }: { span: Span; onaction?: (action: Action) => void } = $props();

  // A new tab in a browser; the same view in an in-app browser, so Back returns here.
  const links = linkPolicy();

  /** For a highlight binding, whether this span names the current theme or CRT mode. */
  const current = $derived.by(() => {
    const live = span.live;
    if (live?.kind === 'isCurrentTheme') return live.theme.toLowerCase() === $theme.name.toLowerCase();
    if (live?.kind === 'isCurrentCathode') return live.mode === $cathode;
    return false;
  });

  /** A marker's text, shown only on the current entry; null for any other span. */
  const marker = $derived.by(() => {
    const live = span.live;
    if ((live?.kind !== 'isCurrentTheme' && live?.kind !== 'isCurrentCathode') || live.marker === undefined) return null;
    return current ? live.marker : ' '.repeat(Array.from(live.marker).length);
  });

  const text = $derived(span.live?.kind === 'currentThemeName' ? $theme.name : (marker ?? span.text));

  /**
   * A strip of swatches, each colour checked and written as CSS: a hex colour as it is, a palette
   * token as its variable. Null when the span has none or one is bad.
   */
  const swatches = $derived.by((): { background: HexColour | null; colours: string[] } | null => {
    const strip = span.swatches;
    if (strip === undefined) return null;
    const background = strip.background === null ? null : hexColour(strip.background);
    if (strip.background !== null && background === null) return null;
    const colours: string[] = [];
    for (const colour of strip.colours) {
      const hex = hexColour(colour);
      if (hex !== null) colours.push(hex);
      else if (isPalette(colour)) colours.push(colourVar(colour));
      else return null;
    }
    return { background, colours };
  });

  // The current entry of a theme or cathode list keeps its own colour: the marker beside it says
  // which it is, and aria-current says so to a screen reader.
  const classes = $derived(spanClasses(span.style) || undefined);
  const css = $derived(spanCss(span.style));
  // Checked again here: a span is plain data, and only a builder-made action or URL may act.
  const action = $derived(isTrustedAction(span.action) ? span.action : null);
  const href = $derived(span.href === undefined ? null : safeHref(span.href));
</script>

{#if swatches !== null}
  <span class="swatches" aria-hidden="true" style={swatches.background === null ? undefined : `background-color: ${swatches.background}`}>{' '}{#each swatches.colours as colour}<span style="color: {colour}">{SWATCH}</span>{/each}{' '}</span>
{:else if action !== null && onaction}
  <button
    type="button"
    class="action {classes ?? ''}"
    style={css}
    aria-current={current ? 'true' : undefined}
    onmousedown={(event) => event.preventDefault()}
    onclick={() => onaction(action)}>{text}</button
  >
{:else if marker !== null}
  <span class={classes} style={css} aria-hidden="true">{text}</span>
{:else if href !== null}
  <a class={classes} style={css} {href} target={/^mailto:/i.test(href) ? undefined : links.target} rel="noopener noreferrer">{text}</a>
{:else}
  <span class={classes} style={css} aria-current={current ? 'true' : undefined}>{text}</span>
{/if}

<style>
  .b {
    font-weight: bold;
  }

  .dim {
    opacity: 0.65;
  }

  .i {
    font-style: italic;
  }

  .u {
    text-decoration: underline;
  }

  .s {
    text-decoration: line-through;
  }

  .u.s {
    text-decoration: underline line-through;
  }

  a {
    color: var(--role-link, var(--theme-bright-blue));
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  /* A tappable name reads as the text around it: no underline until the pointer or the focus is
     on it. Chromium's own stylesheet gives a button no text shadow, which would leave the name
     without the cathode glow the text beside it has (styles/crt.css), so it inherits it. */
  .action {
    display: inline;
    padding: 0;
    border: 0;
    background: none;
    font: inherit;
    color: inherit;
    text-align: inherit;
    text-shadow: inherit;
    cursor: pointer;
  }

  .action:hover,
  .action:focus-visible {
    text-decoration: underline;
    text-underline-offset: 2px;
  }
</style>
