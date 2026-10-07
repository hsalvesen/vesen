<!--
  Several quotes at once (docs/plan/07-stock-and-proxy.md, "Rendering"), drawn from the
  QuoteTableView that commands/network/stock/view.ts builds: SYMBOL, LAST and CHG%, and where the
  output is wide enough the change itself and a 64 px chart. A row that failed says so in place
  of its figures. Each ticker is a chip that opens its card; a press never takes focus from the
  prompt. Text by interpolation only; every colour a role.
-->
<script lang="ts">
  import type { QuoteTableView } from '../../commands/network/stock/view';
  import { isTrustedAction, type Action } from '../../output/model';
  import Sparkline from './Sparkline.svelte';

  let { view, alt, onaction }: { view: unknown; alt: string; onaction?: (action: Action) => void } = $props();

  const table = $derived(
    typeof view === 'object' && view !== null && (view as { kind?: unknown }).kind === 'quote-table' ? (view as QuoteTableView) : null,
  );
</script>

{#if table}
  <div class="quotes" role="group" aria-label={alt}>
    <table>
      <thead>
        <tr>
          <th scope="col">SYMBOL</th>
          <th scope="col" class="num">LAST</th>
          <th scope="col" class="num">CHG%</th>
          <th scope="col" class="num wide">CHG</th>
          <th scope="col" class="wide"><span class="sr-only">Chart</span></th>
        </tr>
      </thead>
      <tbody>
        {#each table.rows as row, i}
          <tr>
            <td class="sym">
              {#if row.action !== null && onaction && isTrustedAction(row.action)}
                <button
                  type="button"
                  class="chip"
                  aria-label="Show {row.symbol}"
                  onmousedown={(event) => event.preventDefault()}
                  onclick={() => row.action && onaction?.(row.action)}>{row.symbol}</button
                >
              {:else}
                <span class="symbol">{row.symbol}</span>
              {/if}
              {#if row.stale}<span class="badge">STALE</span>{/if}
            </td>
            {#if row.failure !== null}
              <td class="failure" colspan="4">{row.failure}</td>
            {:else}
              <td class="num">{row.last ?? '—'}</td>
              <td class="num {row.tone}">{row.percent ?? '—'}</td>
              <td class="num wide {row.tone}">{row.change ?? '—'}</td>
              <td class="wide spark">{#if row.spark !== null}<Sparkline spark={row.spark} id="{table.id}-{i}" mini />{/if}</td>
            {/if}
          </tr>
        {/each}
      </tbody>
    </table>
    {#if table.footer !== null}
      <div class="footer">{table.footer}</div>
    {/if}
  </div>
{:else}
  <div class="quotes">{alt}</div>
{/if}

<style>
  .quotes {
    max-width: min(62ch, 100%);
    min-width: 0;
    margin: 0.25em 0;
    white-space: normal;
    color: var(--role-fg);
  }

  table {
    border-collapse: collapse;
    max-width: 100%;
  }

  th {
    padding: 0 2ch 0 0;
    text-align: left;
    color: var(--role-muted);
    font-weight: normal;
  }

  td {
    padding: 0.1em 2ch 0.1em 0;
    vertical-align: middle;
    white-space: nowrap;
  }

  th:last-child,
  td:last-child {
    padding-right: 0;
  }

  .num {
    text-align: right;
  }

  .symbol {
    color: var(--role-accent);
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

  .failure {
    color: var(--role-muted);
    white-space: normal;
  }

  .badge {
    margin-left: 1ch;
    padding: 0 0.5ch;
    border: 1px solid var(--role-warn);
    border-radius: 3px;
    color: var(--role-warn);
    font-weight: bold;
  }

  /* The change and the chart, only where the output has room for them. */
  .wide {
    display: none;
  }

  @container output (min-width: 52ch) {
    .wide {
      display: table-cell;
    }
  }

  .spark {
    width: 64px;
    min-width: 64px;
  }

  .footer {
    color: var(--role-muted);
    overflow-wrap: anywhere;
  }

  .chip {
    padding: 0 1ch;
    border: 1px solid var(--role-muted);
    border-radius: 4px;
    background: var(--role-chip-bg);
    color: var(--role-accent);
    font: inherit;
    font-weight: bold;
    cursor: pointer;
  }

  @media (pointer: coarse) {
    .chip {
      min-height: 44px;
      min-width: 44px;
    }
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
</style>
