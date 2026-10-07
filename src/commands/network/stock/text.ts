// The quote card and table as plain text: what a pipe or a file receives, and what --plain
// prints. Made from the same view models the components draw, so the two never disagree; the
// chart becomes a row of block glyphs.

import type { QuoteSeries } from '../../../services/market/contract';
import type { QuoteCardView, QuoteTableView, RangeBarView } from './view';

const GLYPHS = '▁▂▃▄▅▆▇█';

/** The closes as up to `columns` block glyphs, oldest first. */
export function glyphLine(series: QuoteSeries, columns = 32): string {
  const closes = series.points.map(([, close]) => close);
  if (closes.length < 2) return '';
  const cells = Math.min(columns, closes.length);
  const picked: number[] = [];
  for (let i = 0; i < cells; i += 1) {
    const index = Math.min(closes.length - 1, Math.round((i * (closes.length - 1)) / Math.max(1, cells - 1)));
    picked.push(closes[index] ?? 0);
  }
  const low = Math.min(...picked);
  const high = Math.max(...picked);
  const top = GLYPHS.length - 1;
  return picked.map((value) => GLYPHS[high - low < 1e-9 ? 3 : Math.round(((value - low) / (high - low)) * top)] ?? '').join('');
}

/** 'Day  151.22 ├──●───┤ 152.54'. */
function barText(bar: RangeBarView, labelWidth: number): string {
  const track = 9;
  const at = Math.round((bar.at / 100) * (track - 1));
  const line = Array.from({ length: track }, (_, i) => (i === at ? '●' : '─')).join('');
  return `${bar.label.padEnd(labelWidth)} ${bar.low} ├${line}┤ ${bar.high}`;
}

export function cardText(view: QuoteCardView, series: QuoteSeries | null): string {
  const rows: string[] = [];
  rows.push([view.symbol, view.name ?? '', view.stale === null ? '' : '[STALE]'].filter((part) => part !== '').join('  '));
  rows.push([view.price, view.change?.text ?? '', view.change?.basis ?? ''].filter((part) => part !== '').join('  '));
  rows.push(view.phase.text);
  if (view.chart !== null && series !== null) {
    const glyphs = glyphLine(series);
    if (glyphs !== '') rows.push(glyphs);
    const { start, middle, end } = view.chart.labels;
    rows.push([start, middle, end].filter((part) => part !== '').join(' · '));
  }
  const width = Math.max(0, ...view.bars.map((bar) => bar.label.length));
  for (const bar of view.bars) rows.push(barText(bar, width));
  if (view.stats.length > 0) rows.push(view.stats.map((stat) => `${stat.label} ${stat.value}`).join(' · '));
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
    rows.push(`${row.symbol.padEnd(symbolWidth)}${(row.last ?? '—').padEnd(lastWidth)}${row.percent ?? '—'}${row.stale ? '  STALE' : ''}`);
  }
  if (view.footer !== null) rows.push(view.footer);
  return `${rows.join('\n')}\n`;
}
