<!--
  The weather card: the `weather-card` component block (docs/plan/05-weather.md). Both layouts are
  drawn, and a container query on the card shows one: the compact block (36 columns at most, for
  a 320 px phone) at 73ch or less, the wide one (72 columns at most) from 74ch. Rotating a phone or
  resizing the window lays out cards already on screen again, with nothing run again. Where
  container queries are missing, a viewport media query decides instead.

  Everything is drawn with text interpolation from the view model, which comes only from the
  weather command, and everything drawn is the text itself, on the character grid at the
  terminal's line height: the pictogram is ASCII art, and a range bar is its characters
  ('--==|=----'), each cell its own span, the = cells shaded from the cold role to the hot one by
  where they sit on the scale. Colours are role and palette tokens. Screen readers hear one
  summary, not the art. The chips are the command's trusted actions only; under 'Matches:' the
  place shown comes first, marked * in the terminal's foreground, so which of the same-named
  places this is stays plain.

  Markup inside the text blocks is written without whitespace between tags on purpose: they
  preserve whitespace, so any space Svelte kept there would show.
-->
<script lang="ts">
  import { colourVar, isTrustedAction, type Action, type ChipItem } from '../../output/model';
  import type { Line, WeatherCardProps } from '../../services/weather/types';
  import { BAR_NOW, BAR_RANGE, CHOSEN_MARK, MATCHES_LABEL, ROLE_COLOUR } from '../../services/weather/view';
  import type { ComponentBlockProps } from './registry';

  let { view, alt, onaction }: ComponentBlockProps = $props();

  /** The view model, when it looks like one; anything else draws only its summary. */
  function asCard(value: unknown): WeatherCardProps | null {
    if (typeof value !== 'object' || value === null) return null;
    const card = value as Partial<WeatherCardProps>;
    return Array.isArray(card.compact) && Array.isArray(card.wide) ? (card as WeatherCardProps) : null;
  }

  const card = $derived(asCard(view));
  const chips = $derived(card !== null && Array.isArray(card.chips) ? card.chips : []);
  const also = $derived(card !== null && Array.isArray(card.also) ? card.also : []);
  const chosen = $derived(card !== null && typeof card.chosen === 'string' && card.chosen !== '' ? card.chosen : null);
  /** What a screen reader hears: the summary, then the notes and the credit. */
  const spoken = $derived(
    [alt || card?.summary || 'Weather', ...(card?.notes ?? []), card?.attribution.openMeteo ?? '', card?.attribution.osm ?? '']
      .filter((part) => part !== '')
      .join(' '),
  );

  /** One run of a range bar's text: the scale, a range cell, or the mark at the current temperature. */
  interface BarCell {
    readonly kind: 'track' | 'range' | 'now';
    readonly text: string;
    /** A range cell's share of the cold role, from 100% at the bar's left end to 0% at its right. */
    readonly cold: number;
  }

  /**
   * The bar's text as cells: runs of the scale's - in one span, each = its own, coloured by its
   * place across the whole bar, so a warm day's range sits in the warm colours.
   */
  function barCells(text: string): BarCell[] {
    const cells: BarCell[] = [];
    const last = Math.max(1, text.length - 1);
    for (let i = 0; i < text.length; i += 1) {
      const ch = text.charAt(i);
      if (ch === BAR_RANGE) cells.push({ kind: 'range', text: ch, cold: Math.round(100 * (1 - i / last)) });
      else if (ch === BAR_NOW) cells.push({ kind: 'now', text: ch, cold: 0 });
      else {
        const previous = cells[cells.length - 1];
        if (previous?.kind === 'track') cells[cells.length - 1] = { ...previous, text: previous.text + ch };
        else cells.push({ kind: 'track', text: ch, cold: 0 });
      }
    }
    return cells;
  }

  function colour(role: string): string {
    const token = Object.prototype.hasOwnProperty.call(ROLE_COLOUR, role) ? ROLE_COLOUR[role as keyof typeof ROLE_COLOUR] : 'fg';
    return `color: ${colourVar(token)}`;
  }

  function run(action: Action): void {
    if (isTrustedAction(action)) onaction?.(action);
  }
</script>

<!-- One line per row; no whitespace between tags, which the pre-formatted blocks would show. -->
{#snippet lines(rows: readonly Line[])}{#each rows as row}<div class="wx-line">{#if row.length === 0}<br />{:else}{#each row as segment}{#if segment[0] === 'bar'}{#each barCells(segment[1]) as cell}{#if cell.kind === 'range'}<span class="wx-range" style="--cold: {cell.cold}%">{cell.text}</span>{:else}<span class={cell.kind === 'now' ? 'wx-now' : 'wx-track'}>{cell.text}</span>{/if}{/each}{:else}<span style={colour(segment[0])}>{segment[1]}</span>{/if}{/each}{/if}</div>{/each}{/snippet}

{#snippet chip(item: ChipItem)}
  {#if onaction && isTrustedAction(item.action)}
    <button type="button" class="wx-chip" onmousedown={(event) => event.preventDefault()} onclick={() => run(item.action)}>{item.label}</button>
  {:else}
    <span class="wx-chip">{item.label}</span>
  {/if}
{/snippet}

<div class="wx" data-weather-card>
  <p class="sr-only">{spoken}</p>
  {#if card !== null}
    <div class="wx-block wx-compact" aria-hidden="true">{@render lines(card.compact)}</div>
    <div class="wx-block wx-wide" aria-hidden="true">{@render lines(card.wide)}</div>
    {#if chips.length > 0}
      <div class="wx-chips">
        {#each chips as item}{@render chip(item)}{/each}
      </div>
    {/if}
    {#if also.length > 0}
      <div class="wx-chips" role="group" aria-label="Places with this name">
        <span class="wx-also">{MATCHES_LABEL}</span>
        {#if chosen !== null}<span class="wx-chip wx-chosen" aria-current="true"><span class="wx-mark" aria-hidden="true">{`${CHOSEN_MARK} `}</span>{chosen}</span>{/if}
        {#each also as item}{@render chip(item)}{/each}
      </div>
    {/if}
  {/if}
</div>

<style>
  /* The card is the container its layout follows, measured in the terminal font's ch. */
  .wx {
    container: wx / inline-size;
    min-width: 0;
    white-space: normal;
  }

  .wx-block {
    white-space: pre;
    overflow-wrap: normal;
    word-break: normal;
    /* Never wider than the output: a font wider than expected scrolls inside the card. */
    max-width: 100%;
    overflow-x: auto;
  }

  .wx-wide {
    display: none;
  }

  @container wx (min-width: 74ch) {
    .wx-wide {
      display: block;
    }

    .wx-compact {
      display: none;
    }
  }

  /* Engines without container queries pick by the window instead. */
  @supports not (container-type: inline-size) {
    @media (min-width: 769px) {
      .wx-wide {
        display: block;
      }

      .wx-compact {
        display: none;
      }
    }
  }

  /* A range bar's cells: the scale muted, the mark at the current temperature strong. */
  .wx-track {
    color: var(--role-muted, var(--theme-bright-black));
  }

  .wx-now {
    color: var(--role-fg-strong, var(--theme-foreground));
  }

  /* A range cell is the cold role, mixed towards the hot one by its place on the scale (--cold is
     its share of the cold role, set inline). An engine without color-mix keeps the cold role: a
     declaration with var() is never dropped at parse time, so the mix sits behind @supports. */
  .wx-range {
    color: var(--role-cold, var(--theme-cyan));
  }

  @supports (color: color-mix(in oklab, red 50%, blue)) {
    .wx-range {
      color: color-mix(in oklab, var(--role-cold, var(--theme-cyan)) var(--cold, 100%), var(--role-hot, var(--theme-red)));
    }
  }

  .wx-chips {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5ch 1ch;
    margin-top: 0.25em;
  }

  .wx-also {
    color: var(--role-muted, var(--theme-bright-black));
  }

  .wx-chip {
    display: inline-flex;
    align-items: center;
    padding: 0 1ch;
    border: 1px solid var(--role-chip-fg, var(--theme-foreground));
    border-radius: 4px;
    background: var(--role-chip-bg, transparent);
    color: var(--role-chip-fg, var(--theme-foreground));
    font: inherit;
  }

  button.wx-chip {
    cursor: pointer;
  }

  /* The place shown, among its namesakes: the same chip as the others, bold, with its * mark;
     the mark itself says which is chosen, so no accent colour or outline is needed. */
  .wx-chosen {
    font-weight: bold;
  }

  /* The mark is a flex item of its own, so its trailing space would collapse without this. */
  .wx-mark {
    white-space: pre;
  }

  button.wx-chip:active {
    background: var(--role-chip-fg, var(--theme-foreground));
    color: var(--theme-background);
  }

  /* A thumb's target on a touch screen. */
  @media (pointer: coarse) {
    .wx-chip {
      min-height: 44px;
      padding: 0 1.5ch;
    }
  }
</style>
