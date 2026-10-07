<!--
  The weather card: the `weather-card` component block (docs/plan/05-weather.md). Both layouts are
  drawn, and a container query on the card shows one: the compact block (36 columns at most, for
  a 320 px phone) at 73ch or less, the wide one (72 columns at most) from 74ch. Rotating a phone or
  resizing the window lays out cards already on screen again, with nothing run again. Where
  container queries are missing, a viewport media query decides instead.

  Everything is drawn with text interpolation from the view model, which comes only from the
  weather command. Colours are role and palette tokens; a range bar is a CSS strip shaded from
  the cold role to the hot one, with a tick at the current temperature, laid over its ASCII
  drawing, which keeps it exactly as wide as its columns and is what a copy picks up. Screen
  readers hear one summary, not the art. The chips are the command's trusted actions only.

  Markup inside the text blocks is written without whitespace between tags on purpose: they
  preserve whitespace, so any space Svelte kept there would show.
-->
<script lang="ts">
  import { colourVar, isTrustedAction, type Action, type ChipItem } from '../../output/model';
  import type { Line, RangeBar, WeatherCardProps } from '../../services/weather/types';
  import { ROLE_COLOUR } from '../../services/weather/view';
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
  /** What a screen reader hears: the summary, then the notes and the credit. */
  const spoken = $derived(
    [alt || card?.summary || 'Weather', ...(card?.notes ?? []), card?.attribution.openMeteo ?? '', card?.attribution.osm ?? '']
      .filter((part) => part !== '')
      .join(' '),
  );

  /** The narrowest a day's range may be drawn, in percent of the bar, so a steady day still shows. */
  const MIN_SPAN = 8;

  function barStyle(bar: RangeBar): string {
    let lo = Math.min(100, Math.max(0, Math.round(bar.lo)));
    let hi = Math.min(100, Math.max(lo, Math.round(bar.hi)));
    if (hi - lo < MIN_SPAN) {
      const middle = (lo + hi) / 2;
      lo = Math.max(0, Math.min(100 - MIN_SPAN, Math.round(middle - MIN_SPAN / 2)));
      hi = lo + MIN_SPAN;
    }
    const now = bar.now === undefined ? '' : `; --now: ${Math.min(100, Math.max(0, Math.round(bar.now)))}%`;
    return `--lo: ${lo}%; --hi: ${hi}%${now}`;
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
{#snippet lines(rows: readonly Line[])}{#each rows as row}<div class="wx-line">{#if row.length === 0}<br />{:else}{#each row as segment}{#if segment[0] === 'bar'}<span class="wx-bar" style={barStyle(segment[2])}><span class="wx-track"></span><span class="wx-fill"></span>{#if segment[2].now !== undefined}<span class="wx-now"></span>{/if}<span class="wx-bar-text">{segment[1]}</span></span>{:else}<span style={colour(segment[0])}>{segment[1]}</span>{/if}{/each}{/if}</div>{/each}{/snippet}

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
      <div class="wx-chips">
        <span class="wx-also">Also:</span>
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

  /* A range bar: the ASCII drawing sets its width and is what a copy takes, drawn transparent
     under a strip shaded from cold to hot across the whole scale, cut to the day's range. */
  .wx-bar {
    position: relative;
    display: inline-block;
  }

  .wx-bar-text {
    color: transparent;
  }

  .wx-track,
  .wx-fill {
    position: absolute;
    left: 0;
    right: 0;
    top: 50%;
    height: 0.45em;
    transform: translateY(-50%);
    border-radius: 0.25em;
    pointer-events: none;
  }

  .wx-track {
    background: var(--role-muted, var(--theme-bright-black));
    opacity: 0.35;
  }

  .wx-fill {
    background: linear-gradient(to right, var(--role-cold, var(--theme-cyan)), var(--role-hot, var(--theme-red)));
    -webkit-clip-path: inset(0 calc(100% - var(--hi, 100%)) 0 var(--lo, 0%) round 0.25em);
    clip-path: inset(0 calc(100% - var(--hi, 100%)) 0 var(--lo, 0%) round 0.25em);
  }

  .wx-now {
    position: absolute;
    left: var(--now, 50%);
    top: 15%;
    bottom: 15%;
    width: 2px;
    margin-left: -1px;
    background: var(--role-fg-strong, var(--theme-foreground));
    pointer-events: none;
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
