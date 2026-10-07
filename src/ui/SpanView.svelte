<!--
  One span of output, drawn with text interpolation only. A trusted action becomes a button, a
  checked http, https or mailto href becomes a link, and live bindings read the theme and cathode
  stores, so old output stays true after either changes: a highlight moves to the current theme
  or CRT mode, and so does a marker. Swatches are drawn in their own fixed colours, checked again
  here, for the eye only. A press on an action never takes focus from the prompt, so a phone's
  keyboard stays as it was (02, section 5), as the dock's chips do.
-->
<script lang="ts">
  import { hexColour, isTrustedAction, safeHref, type Action, type HexColour, type Span } from '../output/model';
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

  /** A strip of swatches, with every colour checked; null when the span has none or one is bad. */
  const swatches = $derived.by((): { background: HexColour; colours: HexColour[] } | null => {
    const strip = span.swatches;
    if (strip === undefined) return null;
    const background = hexColour(strip.background);
    const colours = strip.colours.map(hexColour);
    if (background === null || colours.some((colour) => colour === null)) return null;
    return { background, colours: colours as HexColour[] };
  });

  // The current entry of a theme or cathode list is drawn the way the legacy lists draw it: in the
  // accent, not bold, since a synthetic bold is wider in WebKit and would push the columns after it.
  const style = $derived(current ? { ...span.style, fg: 'accent' as const } : span.style);
  const classes = $derived(spanClasses(style) || undefined);
  const css = $derived(spanCss(style));
  // Checked again here: a span is plain data, and only a builder-made action or URL may act.
  const action = $derived(isTrustedAction(span.action) ? span.action : null);
  const href = $derived(span.href === undefined ? null : safeHref(span.href));
</script>

{#if swatches !== null}
  <span class="swatches" aria-hidden="true" style="background-color: {swatches.background}">{' '}{#each swatches.colours as colour}<span style="color: {colour}">██</span>{/each}{' '}</span>
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

  .action {
    display: inline;
    padding: 0;
    border: 0;
    background: none;
    font: inherit;
    color: inherit;
    text-align: inherit;
    text-decoration: underline dotted;
    text-underline-offset: 3px;
    cursor: pointer;
  }
</style>
