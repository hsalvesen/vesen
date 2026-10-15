<!--
  One quote (docs/plan/07-stock-and-proxy.md, "Rendering"), drawn from the QuoteCardView that
  commands/network/stock/view.ts builds: the ticker and name with a STALE badge when the copy is
  not live, the price and its change, the market phase, the chart, the day and 52-week ranges,
  the stats, where the data came from and how old it is, and chips. The chart and the range
  tracks are ASCII text on the character grid (chart.ts). Text by interpolation only; every colour
  a role. One fluid layout, at most 62 columns wide, with no width maths: it fits a 320 px phone
  without scrolling sideways.

  The chips are trusted actions made by the command. A press on one never takes focus from the
  prompt, so a phone's keyboard stays down.
-->
<script lang="ts">
  import type { QuoteCardView } from '../../commands/network/stock/view';
  import { isTrustedAction, type Action } from '../../output/model';
  import Sparkline from './Sparkline.svelte';

  let { view, alt, onaction }: { view: unknown; alt: string; onaction?: (action: Action) => void } = $props();

  /** The view model, when it is one; anything else draws nothing but the summary. */
  const card = $derived(
    typeof view === 'object' && view !== null && (view as { kind?: unknown }).kind === 'quote-card' ? (view as QuoteCardView) : null,
  );
</script>

{#if card}
  <div class="quote" role="group" aria-label={alt}>
    <div class="head">
      <span class="symbol b">{card.symbol}</span>
      {#if card.name !== null}<span class="name" title={card.name}>{card.name}</span>{/if}
      {#if card.stale !== null}<span class="badge b" title="Live data unavailable: {card.stale}">STALE</span>{/if}
    </div>
    <div class="figures">
      <span class="price b">{card.price}</span>
      {#if card.change !== null}
        <span class="change b {card.change.tone}">{card.change.text}{#if card.change.basis !== null}<span class="basis">{` ${card.change.basis}`}</span>{/if}</span>
      {/if}
    </div>
    <div class="phase" class:live={card.phase.live}>{card.phase.text}</div>
    {#if card.chart !== null}
      <div class="chart"><Sparkline spark={card.chart} /></div>
    {/if}
    {#if card.bars.length > 0}
      <div class="bars">
        {#each card.bars as bar}
          {@const mark = bar.track.indexOf('*')}
          <span class="bar-label">{bar.label}</span>
          <span class="bar-value">{bar.low}</span>
          <!-- The track as text, `[--*----]`, its mark in the strong text role. -->
          <span class="track" role="img" aria-label="{bar.label} range {bar.low} to {bar.high}">{bar.track.slice(0, mark)}<span class="mark">{bar.track.slice(mark, mark + 1)}</span>{bar.track.slice(mark + 1)}</span>
          <span class="bar-value">{bar.high}</span>
        {/each}
      </div>
    {/if}
    {#if card.stats.length > 0}
      <div class="stats">
        {#each card.stats as stat}
          <span class="stat"><span class="stat-label">{stat.label}</span>{` ${stat.value}`}</span>
        {/each}
      </div>
    {/if}
    <div class="footer">{card.footer}</div>
    {#if card.chips.length > 0}
      <div class="chips">
        {#each card.chips as chip}
          {#if onaction && isTrustedAction(chip.action)}
            <!-- mousedown is cancelled so the press does not take focus, or the keyboard, from the prompt. -->
            <!-- The range shown carries a plain marker, and aria-current for a screen reader. -->
            <button
              type="button"
              class="chip"
              class:active={chip.active}
              class:b={chip.active}
              aria-current={chip.active ? 'true' : undefined}
              aria-label={chip.title}
              onmousedown={(event) => event.preventDefault()}
              onclick={() => onaction?.(chip.action)}>{#if chip.active}<span aria-hidden="true">{'* '}</span>{/if}{chip.label}</button
            >
          {:else}
            <span class="chip" class:active={chip.active} class:b={chip.active} aria-current={chip.active ? 'true' : undefined}>{#if chip.active}<span aria-hidden="true">{'* '}</span>{/if}{chip.label}</span>
          {/if}
        {/each}
      </div>
    {/if}
  </div>
{:else}
  <div class="quote">{alt}</div>
{/if}

<style>
  .quote {
    display: flex;
    flex-direction: column;
    gap: 0.25em;
    max-width: min(62ch, 100%);
    min-width: 0;
    margin: 0.25em 0;
    white-space: normal;
    color: var(--role-fg);
  }

  .head {
    display: flex;
    align-items: baseline;
    gap: 1ch;
    min-width: 0;
  }

  .symbol {
    flex: none;
    color: var(--role-accent);
    font-weight: bold;
  }

  .name {
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    color: var(--role-fg-strong);
  }

  .badge {
    flex: none;
    margin-left: auto;
    padding: 0 0.5ch;
    border: 1px solid var(--role-warn);
    border-radius: 3px;
    color: var(--role-warn);
    font-weight: bold;
  }

  .figures {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    column-gap: 2ch;
  }

  .price {
    color: var(--role-fg-strong);
    font-weight: bold;
  }

  .change {
    font-weight: bold;
  }

  .up {
    color: var(--role-ok);
  }

  .down {
    color: var(--role-error);
  }

  .flat {
    color: var(--role-muted);
  }

  .basis {
    color: var(--role-muted);
    font-weight: normal;
  }

  .phase {
    color: var(--role-muted);
  }

  .phase.live {
    color: var(--role-ok);
  }

  .chart {
    margin: 0.25em 0;
  }

  /* The ranges share a label column and a track column, each as wide as its text. */
  .bars {
    display: grid;
    grid-template-columns: auto auto auto auto;
    justify-content: start;
    align-items: baseline;
    column-gap: 1ch;
  }

  .bar-label {
    color: var(--role-muted);
  }

  .bar-value {
    text-align: right;
    white-space: nowrap;
  }

  .track {
    color: var(--role-muted);
    white-space: pre;
  }

  .mark {
    color: var(--role-fg-strong);
  }

  .stats {
    display: flex;
    flex-wrap: wrap;
    column-gap: 2ch;
  }

  .stat-label {
    color: var(--role-muted);
  }

  .footer {
    color: var(--role-muted);
    overflow-wrap: anywhere;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5ch 1ch;
    margin-top: 0.25em;
  }

  /* Chip text on the chip, as every card's chips are; the current range is marked with a * before
     its label and bold, in the chip's own colour, which reaches 4.5:1 in every theme. */
  .chip {
    padding: 0 1ch;
    border: 1px solid var(--role-chip-fg);
    border-radius: 4px;
    background: var(--role-chip-bg);
    color: var(--role-chip-fg);
    font: inherit;
    cursor: pointer;
  }

  .chip.active {
    font-weight: bold;
  }

  /* A finger's worth on a touch screen. */
  @media (pointer: coarse) {
    .chip {
      min-height: 44px;
      min-width: 44px;
      padding: 0 1.5ch;
    }
  }
</style>
