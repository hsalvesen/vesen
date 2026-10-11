<!--
  A quote's chart (commands/network/stock/view.ts, SparkView; chart.ts draws it): the closes
  traced in ASCII on the character grid, each cell above the dotted comparison line (the previous
  close for a day) in the ok role and each below it in the error role, the line itself muted, and
  the last point marked o in the strong text role. Text only: the rows are runs of cells, one span
  a run, at the terminal's own line height, so the chart is as wide as its columns and never
  stretches. Colours are roles, through classes.
-->
<script lang="ts">
  import type { SparkView } from '../../commands/network/stock/view';

  let { spark, mini = false }: { spark: SparkView; mini?: boolean } = $props();

  /** The chart's columns: the widest row reaches the last one, where the o is. */
  const columns = $derived(Math.max(1, ...spark.rows.map((row) => row.reduce((width, run) => width + run.text.length, 0))));
</script>

<div class="spark" class:mini role="img" aria-label={spark.label}>
  <div class="plot" aria-hidden="true">{#each spark.rows as row, i}{#if i > 0}{'\n'}{/if}{#each row as run}<span class={run.tone}>{run.text}</span>{/each}{/each}</div>
  {#if !mini && (spark.labels.start !== '' || spark.labels.end !== '')}
    <!-- The start and the end under the chart's own ends; what the dotted line is, centred below. -->
    <div class="axis" aria-hidden="true" style="width: {columns}ch">
      <div class="ends"><span>{spark.labels.start}</span><span>{spark.labels.end}</span></div>
      {#if spark.labels.middle !== ''}<div class="middle">{spark.labels.middle}</div>{/if}
    </div>
  {/if}
</div>

<style>
  .spark {
    max-width: 100%;
    min-width: 0;
  }

  /* The rows as written: cells on the grid, never wrapped, at the terminal's line height. */
  .plot {
    white-space: pre;
    overflow-x: auto;
    line-height: var(--term-lh, 1.35);
    color: var(--role-fg);
  }

  .up {
    color: var(--role-ok);
  }

  .down {
    color: var(--role-error);
  }

  .flat,
  .base {
    color: var(--role-muted);
  }

  .last {
    color: var(--role-fg-strong);
  }

  /* The axis is as wide as the chart's columns (set inline), so its ends sit under the chart's. */
  .axis {
    max-width: 100%;
    color: var(--role-muted);
    white-space: nowrap;
  }

  .ends {
    display: flex;
    justify-content: space-between;
    gap: 1ch;
  }

  .middle {
    text-align: center;
  }
</style>
