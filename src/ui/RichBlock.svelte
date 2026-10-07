<!--
  The layout blocks: grid, table, panel, chips, card, columns and component. OutputView loads
  this the first time it draws one, so the initial chunk carries only what legacy output, plain
  lines and art (the boot banner) need. Everything is drawn with text interpolation only.

  Markup inside text containers is written without whitespace between tags on purpose: those
  containers preserve whitespace, so any space Svelte kept there would show. A press on a chip
  never takes focus from the prompt, so a phone's keyboard stays as it was.
-->
<script lang="ts">
  import { isTrustedAction, lineText, textWidth, type Action, type Block, type GridBlock } from '../output/model';
  import LineView from './LineView.svelte';
  import LinkCard from './components/LinkCard.svelte';
  import OutputView from './OutputView.svelte';
  import { loadComponent, lookupComponent } from './components/registry';
  import { hangingIndent } from './hang';
  import { cssColour } from './span-style';

  let { block, onaction }: { block: Block; onaction?: (action: Action) => void } = $props();

  /** Table stacking thresholds with a rule in the stylesheet below; a threshold rounds up to one. */
  const STACK_COLUMNS = [20, 30, 40, 50, 60, 70, 80, 100, 120] as const;

  function stackClass(cols: number | undefined): string {
    if (cols === undefined || cols <= 0) return '';
    const bucket = STACK_COLUMNS.find((c) => c >= cols) ?? STACK_COLUMNS[STACK_COLUMNS.length - 1];
    return `stack-${bucket}`;
  }

  /** The widest item in a grid, in cells. */
  function itemCh(grid: GridBlock): number {
    return grid.items.reduce((widest, item) => Math.max(widest, textWidth(item.text)), 1);
  }

  /** The narrowest a grid column may be: the caller's choice, or the widest item plus a gap. */
  function gridMinCh(grid: GridBlock): number {
    return grid.minCh ?? itemCh(grid) + 2;
  }
</script>

{#if block.type === 'grid'}
  {@const notes = block.notes}
  <div
    class="grid"
    class:by-column={block.order === 'columns' && notes === undefined}
    style={notes === undefined ? `--min-col: ${gridMinCh(block)}ch` : `--min-col: ${gridMinCh(block)}ch; --item-col: ${itemCh(block)}ch`}
  >
    {#each block.items as item, i}
      {#if notes !== undefined}
        <!-- An item in a column of its own, and its note wrapping beside it. -->
        <div class="cell"><div class="text"><LineView line={[item]} {onaction} /></div><div class="text note"><LineView line={notes[i] ?? []} {onaction} /></div></div>
      {:else}
        <div class="text"><LineView line={[item]} {onaction} /></div>
      {/if}
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
{:else if block.type === 'panel'}
  <div class="out-panel" style="--panel-tone: {cssColour(block.tone)}">
    {#if block.title !== undefined}
      <div class="text out-panel-title">{block.title}</div>
    {/if}
    {#each block.body as line}
      {@const hang = hangingIndent(line)}
      <!-- A label row's description wraps under itself, not under the label. -->
      <div class="text" style={hang > 0 ? `padding-left: ${hang}ch; text-indent: -${hang}ch` : undefined}>{#if line.length === 0}<br />{:else}<LineView {line} {onaction} />{/if}</div>
    {/each}
  </div>
{:else if block.type === 'chips'}
  <div class="chips">
    {#if block.label !== undefined}
      <span class="chips-label">{block.label}</span>
    {/if}
    {#each block.items as item}
      {#if onaction && isTrustedAction(item.action)}
        <button type="button" class="chip" onmousedown={(event) => event.preventDefault()} onclick={() => onaction?.(item.action)}>{item.label}</button>
      {:else}
        <span class="chip">{item.label}</span>
      {/if}
    {/each}
  </div>
{:else if block.type === 'card'}
  <LinkCard card={block} />
{:else if block.type === 'columns'}
  <div class="columns" style="--stack-at: {block.stackBelowCols}ch">
    <div class="column"><OutputView blocks={block.left} {onaction} /></div>
    <div class="column"><OutputView blocks={block.right} {onaction} /></div>
  </div>
{:else if block.type === 'component'}
  <!-- A card's chunk loads the first time a block names it; until then, the plain text. -->
  {@const Card = lookupComponent(block.name)}
  {@const loading = Card === undefined ? loadComponent(block.name) : undefined}
  {#if Card}
    <div class="component"><Card view={block.props} alt={block.alt} {onaction} /></div>
  {:else if loading}
    {#await loading}
      <div class="text">{block.plain}</div>
    {:then Loaded}
      <div class="component"><Loaded view={block.props} alt={block.alt} {onaction} /></div>
    {:catch}
      <div class="text">{block.plain}</div>
    {/await}
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

  /* ls's order: as many columns as fit, each filled top to bottom before the next, with the
     rows balanced, as ls -C lays names out. Multi-column layout does this with no script, and
     reflows when the width changes. */
  .grid.by-column {
    display: block;
    /* A length: column-width takes no percentage, and a box narrower than one column gets one
       column that narrow anyway. */
    column-width: var(--min-col);
    column-gap: 0;
  }

  .grid.by-column > .text {
    break-inside: avoid;
  }

  .cell {
    display: grid;
    grid-template-columns: var(--item-col) minmax(0, 1fr);
    column-gap: 2ch;
    padding-right: 2ch;
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
