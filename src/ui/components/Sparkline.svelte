<!--
  A quote's chart (commands/network/stock/view.ts, SparkView): the closes as one line across the
  session, green above and red below the dashed comparison line (the previous close for a day),
  with a dot on the last point. The SVG stretches to the width it is given; the stroke keeps its
  thickness, and the dashed line and the dot are drawn over it in HTML so they never stretch.
  Colours are roles, set through style, never through presentation attributes.
-->
<script lang="ts">
  import type { SparkView } from '../../commands/network/stock/view';

  let { spark, id, mini = false }: { spark: SparkView; id: string; mini?: boolean } = $props();

  const gradient = $derived(`${id}-line`);
  /** Where the colour changes, as a fraction of the height; null when there is no baseline. */
  const split = $derived(spark.baseline === null ? null : Math.min(1, Math.max(0, spark.baseline / spark.height)));
  const toneVar = $derived(spark.tone === 'up' ? 'var(--role-ok)' : spark.tone === 'down' ? 'var(--role-error)' : 'var(--role-muted)');
  const stroke = $derived(split === null ? toneVar : `url(#${gradient})`);
  const lastIsUp = $derived(spark.baseline === null ? spark.tone !== 'down' : (spark.last.y / 100) * spark.height <= spark.baseline);
  const dotColour = $derived(spark.baseline === null ? toneVar : lastIsUp ? 'var(--role-ok)' : 'var(--role-error)');
</script>

<div class="spark" class:mini role="img" aria-label={spark.label}>
  <div class="plot">
    <svg viewBox="0 0 {spark.width} {spark.height}" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      {#if split !== null}
        <defs>
          <linearGradient id={gradient} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2={spark.height}>
            <stop offset="0" style="stop-color: var(--role-ok)" />
            <stop offset={split} style="stop-color: var(--role-ok)" />
            <stop offset={split} style="stop-color: var(--role-error)" />
            <stop offset="1" style="stop-color: var(--role-error)" />
          </linearGradient>
        </defs>
      {/if}
      <path d={spark.path} style="stroke: {stroke}" />
    </svg>
    {#if spark.baseline !== null}
      <span class="baseline" style="top: {(spark.baseline / spark.height) * 100}%"></span>
    {/if}
    <span class="dot" style="left: {spark.last.x}%; top: {spark.last.y}%; background: {dotColour}"></span>
  </div>
  {#if !mini && (spark.labels.start !== '' || spark.labels.end !== '')}
    <div class="axis" aria-hidden="true"><span>{spark.labels.start}</span><span class="middle">{spark.labels.middle}</span><span>{spark.labels.end}</span></div>
  {/if}
</div>

<style>
  .spark {
    width: 100%;
    min-width: 0;
  }

  .plot {
    position: relative;
    height: 4.2em;
  }

  .mini .plot {
    height: 1.2em;
  }

  svg {
    display: block;
    width: 100%;
    height: 100%;
    overflow: visible;
  }

  path {
    fill: none;
    stroke-width: 1.5px;
    stroke-linejoin: round;
    stroke-linecap: round;
    vector-effect: non-scaling-stroke;
  }

  .baseline {
    position: absolute;
    left: 0;
    right: 0;
    border-top: 1px dashed var(--role-muted);
    pointer-events: none;
  }

  .dot {
    position: absolute;
    width: 0.45em;
    height: 0.45em;
    border-radius: 50%;
    transform: translate(-50%, -50%);
    pointer-events: none;
  }

  .mini .dot {
    width: 0.3em;
    height: 0.3em;
  }

  .axis {
    display: flex;
    justify-content: space-between;
    gap: 1ch;
    color: var(--role-muted);
    white-space: nowrap;
    overflow: hidden;
  }

  .axis .middle {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
