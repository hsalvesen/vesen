// The quote card and table as plain text: what a pipe or a file receives, and what --plain
// prints. Made from the same view models the components draw, so the two never disagree; the
// chart is the same ASCII rows the card shows, and a range bar the same `[--*----]` track.

import { chartLines } from './chart';
import { NONE, SEP, type QuoteCardView, type QuoteTableView, type RangeBarView } from './view';

/** 'Day  151.22 [---*---] 152.54'. */
function barText(bar: RangeBarView, labelWidth: number): string {
  return `${bar.label.padEnd(labelWidth)} ${bar.low} ${bar.track} ${bar.high}`;
}

export function cardText(view: QuoteCardView): string {
  const rows: string[] = [];
  rows.push([view.symbol, view.name ?? '', view.stale === null ? '' : '[STALE]'].filter((part) => part !== '').join('  '));
  rows.push([view.price, view.change?.text ?? '', view.change?.basis ?? ''].filter((part) => part !== '').join('  '));
  rows.push(view.phase.text);
  if (view.chart !== null) {
    rows.push(...chartLines(view.chart.rows));
    const { start, middle, end } = view.chart.labels;
    rows.push([start, middle, end].filter((part) => part !== '').join(SEP));
  }
  const width = Math.max(0, ...view.bars.map((bar) => bar.label.length));
  for (const bar of view.bars) rows.push(barText(bar, width));
  if (view.stats.length > 0) rows.push(view.stats.map((stat) => `${stat.label} ${stat.value}`).join(SEP));
  rows.push(view.footer);
  return `${rows.join('\n')}\n`;
}

export function tableText(view: QuoteTableView): string {
  const symbolWidth = Math.max(6, ...view.rows.map((row) => row.symbol.length)) + 2;
  const lastWidth = Math.max(4, ...view.rows.map((row) => (row.last ?? '').length)) + 2;
  const rows = [`${'SYMBOL'.padEnd(symbolWidth)}${'LAST'.padEnd(lastWidth)}CHG%`];
  for (const row of view.rows) {
    if (row.failure !== null) {
      rows.push(`${row.symbol.padEnd(symbolWidth)}${row.failure}`);
      continue;
    }
    rows.push(`${row.symbol.padEnd(symbolWidth)}${(row.last ?? NONE).padEnd(lastWidth)}${row.percent ?? NONE}${row.stale ? '  STALE' : ''}`);
  }
  if (view.footer !== null) rows.push(view.footer);
  return `${rows.join('\n')}\n`;
}
