<!--
  The layout blocks: grid, table, art, panel, chips, card, columns and component. OutputView
  loads this the first time it draws one, so the initial chunk carries only what legacy output
  and plain lines need. Everything is drawn with text interpolation only.

  Markup inside text containers is written without whitespace between tags on purpose: those
  containers preserve whitespace, so any space Svelte kept there would show.
-->
<script lang="ts">
  import {
    isTrustedAction,
    lineText,
    out,
    safeHref,
    textWidth,
    type Action,
    type Block,
    type GridBlock,
  } from '../output/model';
  import LineView from './LineView.svelte';
  import OutputView from './OutputView.svelte';
  import { lookupComponent } from './components/registry';
  import { cssColour, spanClasses, spanCss } from './span-style';

  let { block, onaction }: { block: Block; onaction?: (action: Action) => void } = $props();

  /** Table stacking thresholds with a rule in the stylesheet below; a threshold rounds up to one. */
  const STACK_COLUMNS = [20, 30, 40, 50, 60, 70, 80, 100, 120] as const;

  function stackClass(cols: number | undefined): string {
    if (cols === undefined || cols <= 0) return '';
    const bucket = STACK_COLUMNS.find((c) => c >= cols) ?? STACK_COLUMNS[STACK_COLUMNS.length - 1];
    return `stack-${bucket}`;
  }

  /** The narrowest a grid column may be: the caller's choice, or the widest item plus a gap. */
  function gridMinCh(grid: GridBlock): number {
    if (grid.minCh !== undefined) return grid.minCh;
    return grid.items.reduce((widest, item) => Math.max(widest, textWidth(item.text)), 1) + 2;
  }

  function artColumns(text: string): number {
    return text.split('\n').reduce((widest, row) => Math.max(widest, textWidth(row)), 1);
  }
</script>

{#if block.type === 'grid'}
  <div class="grid" style="--min-col: {gridMinCh(block)}ch">
    {#each block.items as item}
      <div class="text"><LineView line={[item]} {onaction} /></div>
    {/each}
  </div>
{:else if block.type === 'table'}
  <div class="table-wrap">
    <table class="table {stackClass(block.stackBelowCols)}">
      {#if block.head}
        <thead>
          <tr>
            {#each block.head as cell, c}
              <th scope="col" class="text" class:right={block.align?.[c] === 'r'}><LineView line={cell} {onaction} /></th>
            {/each}
          </tr>
        </thead>
      {/if}
      <tbody>
        {#each block.rows as row}
          <tr>
            {#each row as cell, c}
              {@const label = block.head?.[c]}
              <td class="text" class:right={block.align?.[c] === 'r'}>{#if label}<span class="cell-label" aria-hidden="true">{`${lineText(label)}: `}</span>{/if}<LineView line={cell} {onaction} /></td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{:else if block.type === 'art'}
  <div class="art-wrap">
    <div
      class="art {spanClasses(block.style)}"
      class:art-fit={block.fit === 'scale'}
      aria-hidden="true"
      style="--art-cols: {artColumns(block.text)}; {spanCss(block.style) ?? ''}"
    >{block.text}</div>
    <span class="sr-only">{block.alt}</span>
  </div>
{:else if block.type === 'panel'}
  <div class="panel" style="--tone: {cssColour(block.tone)}">
    {#if block.title !== undefined}
      <div class="text panel-title">{block.title}</div>
    {/if}
    {#each block.body as line}
      <div class="text">{#if line.length === 0}<br />{:else}<LineView {line} {onaction} />{/if}</div>
    {/each}
  </div>
{:else if block.type === 'chips'}
  <div class="chips">
    {#if block.label !== undefined}
      <span class="chips-label">{block.label}</span>
    {/if}
    {#each block.items as item}
      {#if onaction && isTrustedAction(item.action)}
        <button type="button" class="chip" onclick={() => onaction?.(item.action)}>{item.label}</button>
      {:else}
        <span class="chip">{item.label}</span>
      {/if}
    {/each}
  </div>
{:else if block.type === 'card'}
  {@const href = safeHref(block.href)}
  <div class="card">
    {#if href !== null}
      <a class="card-title" {href} target="_blank" rel="noopener noreferrer">{block.title}</a>
    {:else}
      <span class="card-title">{block.title}</span>
    {/if}
    {#if block.detail !== undefined}
      <div class="text">{block.detail}</div>
    {/if}
    <div class="text card-url">{block.href}</div>
    {#if onaction}
      <button type="button" class="chip" onclick={() => onaction?.(out.action.copy(block.copy ?? block.href, 'Copy'))}>Copy</button>
    {/if}
  </div>
{:else if block.type === 'columns'}
  <div class="columns" style="--stack-at: {block.stackBelowCols}ch">
    <div class="column"><OutputView blocks={block.left} {onaction} /></div>
    <div class="column"><OutputView blocks={block.right} {onaction} /></div>
  </div>
{:else if block.type === 'component'}
  {@const Card = lookupComponent(block.name)}
  {#if Card}
    <div class="component"><Card view={block.props} alt={block.alt} {onaction} /></div>
  {:else}
    <div class="text">{block.plain}</div>
  {/if}
{/if}

<style>
  .text {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(var(--min-col), 100%), 1fr));
  }

  .table-wrap {
    max-width: 100%;
    overflow-x: auto;
  }

  .table {
    border-collapse: collapse;
    --row: table-row;
    --cell: table-cell;
    --head: table-header-group;
    --label: none;
  }

  .table tr {
    display: var(--row);
  }

  .table tr + tr {
    margin-top: var(--row-gap, 0);
  }

  .table thead {
    display: var(--head);
  }

  .table th,
  .table td {
    display: var(--cell);
    padding: 0 2ch 0 0;
    text-align: left;
    vertical-align: top;
    font-weight: inherit;
  }

  .table th {
    font-weight: bold;
  }

  .table .right {
    text-align: right;
  }

  .cell-label {
    display: var(--label);
    color: var(--role-muted, var(--theme-bright-black));
  }

  /* Below a table's threshold each row becomes a stack of "key: value" lines. The query runs
     against OutputView's container; its conditions cannot read a variable, so each threshold the
     renderer rounds to has a rule. */
  @container output (max-width: 20ch) {
    .stack-20 { --row: block; --cell: block; --head: none; --label: inline; --row-gap: 0.5em; }
  }
  @container output (max-width: 30ch) {
    .stack-30 { --row: block; --cell: block; --head: none; --label: inline; --row-gap: 0.5em; }
  }
  @container output (max-width: 40ch) {
    .stack-40 { --row: block; --cell: block; --head: none; --label: inline; --row-gap: 0.5em; }
  }
  @container output (max-width: 50ch) {
    .stack-50 { --row: block; --cell: block; --head: none; --label: inline; --row-gap: 0.5em; }
  }
  @container output (max-width: 60ch) {
    .stack-60 { --row: block; --cell: block; --head: none; --label: inline; --row-gap: 0.5em; }
  }
  @container output (max-width: 70ch) {
    .stack-70 { --row: block; --cell: block; --head: none; --label: inline; --row-gap: 0.5em; }
  }
  @container output (max-width: 80ch) {
    .stack-80 { --row: block; --cell: block; --head: none; --label: inline; --row-gap: 0.5em; }
  }
  @container output (max-width: 100ch) {
    .stack-100 { --row: block; --cell: block; --head: none; --label: inline; --row-gap: 0.5em; }
  }
  @container output (max-width: 120ch) {
    .stack-120 { --row: block; --cell: block; --head: none; --label: inline; --row-gap: 0.5em; }
  }

  .art-wrap {
    max-width: 100%;
  }

  /* The one callout style: a 4px left border and a 12% tint, for help, notices and cancellations. */
  .panel {
    position: relative;
    margin: 8px 0;
    padding: 8px 10px;
    border-left: 4px solid var(--tone);
    border-radius: 4px;
  }

  .panel::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 4px;
    background: var(--tone);
    opacity: 0.12;
    pointer-events: none;
  }

  .panel > * {
    position: relative;
  }

  .panel-title {
    color: var(--tone);
    font-weight: bold;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5ch 1ch;
  }

  .chips-label {
    color: var(--role-muted, var(--theme-bright-black));
  }

  .chip {
    padding: 0 1ch;
    border: 1px solid var(--role-chip-fg, var(--theme-foreground));
    border-radius: 4px;
    background: var(--role-chip-bg, transparent);
    color: var(--role-chip-fg, var(--theme-foreground));
    font: inherit;
  }

  button.chip {
    cursor: pointer;
  }

  .card {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    margin: 4px 0;
  }

  .card-title {
    color: var(--role-link, var(--theme-bright-blue));
    font-weight: bold;
  }

  .card-url {
    color: var(--role-muted, var(--theme-bright-black));
  }

  /* Side by side until the row is narrower than --stack-at, then stacked, without a query. */
  .columns {
    display: flex;
    flex-wrap: wrap;
    gap: 0 3ch;
  }

  .column {
    flex-grow: 1;
    flex-basis: calc((var(--stack-at) - 100%) * 999);
    min-width: 0;
  }
</style>
