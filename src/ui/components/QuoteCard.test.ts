// The quote card and table (docs/plan/07-stock-and-proxy.md, "Rendering"), drawn from the view
// models the stock command builds, for every recorded chart and every state: text by
// interpolation only (a hostile name stays text), no <pre>, every colour a role or palette
// variable, a gradient id of its own per card, and chips that act without taking focus.
import { fireEvent, render } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { cardAlt, cardView, tableAlt, tableView } from '../../commands/network/stock/view';
import { out, type Action } from '../../output/model';
import type { QuoteOutcome } from '../../services/market/port';
import { HOSTILE_NAME, RECORDED_AT_MS, cardStates, quoteOf, recordedQuotes } from '../../testing/quotes';
import QuoteCard from './QuoteCard.svelte';
import QuoteTable from './QuoteTable.svelte';
import { loadComponent } from './registry';

const live = (symbol: string): Extract<QuoteOutcome, { ok: true }> => ({ ok: true, quote: quoteOf(symbol), freshness: 'live', via: 'worker' });

function card(outcome: Extract<QuoteOutcome, { ok: true }>, onaction?: (action: Action) => void) {
  const view = cardView(outcome, outcome.quote.series?.range ?? '1d', RECORDED_AT_MS);
  return { view, ...render(QuoteCard, { props: { view, alt: cardAlt(view), ...(onaction ? { onaction } : {}) } }) };
}

/** The card's rows as text: each part's class and what it says. */
function outline(root: Element): string[] {
  const quote = root.querySelector('.quote');
  return Array.from(quote?.children ?? [], (child) => `${child.className.replace(/\s*svelte-[a-z0-9]+/g, '').trim()}: ${child.textContent?.replace(/\s+/g, ' ').trim() ?? ''}`);
}

const COLOUR_PROPERTY = /^(?:color|background(?:-color)?|stop-color|stroke|fill|border(?:-[a-z]+)?-color|border(?:-top|-bottom|-left|-right)?)$/;
const TOKEN = /^(?:var\(--(?:role|theme)-[a-z-]+\)|url\(#[\w-]+\))$/;

/** Every colour in an inline style is a token. */
function expectTokenColours(root: Element): void {
  for (const element of Array.from(root.querySelectorAll('[style]'))) {
    for (const declaration of (element.getAttribute('style') ?? '').split(';')) {
      const [property = '', ...rest] = declaration.split(':');
      const value = rest.join(':').trim();
      if (!COLOUR_PROPERTY.test(property.trim()) || value === '') continue;
      expect(value, `${property}: ${value}`).toMatch(TOKEN);
    }
  }
}

describe('the quote card', () => {
  it.each(recordedQuotes())('draws %s', (_name, quote) => {
    const { container } = card({ ok: true, quote, freshness: 'live', via: 'worker' });
    expect(outline(container)).toMatchSnapshot();
    expect(container.innerHTML).not.toContain('<pre');
    expectTokenColours(container);
    expect(container.querySelector('[role="img"][aria-label]')).not.toBeNull();
  });

  it.each(cardStates())('draws %s', (_name, outcome) => {
    if (outcome.ok === false) throw new Error('a card state is a quote');
    const { container } = card(outcome);
    expect(outline(container)).toMatchSnapshot();
    expect(container.innerHTML).not.toContain('<pre');
    expectTokenColours(container);
    const stale = outcome.freshness === 'saved' || outcome.quote.stale;
    expect(container.querySelector('.badge')?.textContent ?? null).toBe(stale ? 'STALE' : null);
  });

  it('keeps a hostile name and exchange as text', () => {
    const { container } = card({ ...live('AAPL'), quote: { ...quoteOf('AAPL'), name: HOSTILE_NAME, exchange: '<b>NMS</b>' } });
    expect(container.querySelector('img, script, b')).toBeNull();
    expect(container.querySelector('.name')?.textContent).toBe(HOSTILE_NAME);
    expect(container.textContent).toContain('<b>NMS</b>');
    expect(container.innerHTML).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('gives every card its own gradient, so cards on one page never share one', () => {
    const { container } = render(QuoteCard, { props: { view: cardView(live('CBA.AX'), '1d', RECORDED_AT_MS), alt: 'a' } });
    const second = render(QuoteCard, { props: { view: cardView(live('CBA.AX'), '1d', RECORDED_AT_MS), alt: 'b' } });
    const ids = [container, second.container].flatMap((root) => Array.from(root.querySelectorAll('linearGradient'), (gradient) => gradient.id));
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    for (const root of [container, second.container]) {
      const id = root.querySelector('linearGradient')?.id ?? '';
      expect(root.querySelector('path')?.getAttribute('style')).toMatch(new RegExp(`^stroke: url\\(#${id}\\);?$`));
    }
    // Stops are coloured through style, never presentation attributes.
    for (const stop of Array.from(container.querySelectorAll('stop'))) {
      expect(stop.getAttribute('stop-color')).toBeNull();
      expect(stop.getAttribute('style')).toMatch(/^stop-color: var\(--role-(?:ok|error)\)$/);
    }
  });

  it('runs a chip without taking focus, the range shown outlined', async () => {
    const onaction = vi.fn();
    const { container, view } = card(live('AAPL'), onaction);
    const buttons = Array.from(container.querySelectorAll('button.chip'));
    expect(buttons.map((button) => button.textContent)).toEqual(['↻ refresh', '1d', '5d', '1mo', '1y']);
    expect(buttons.map((button) => button.getAttribute('aria-pressed'))).toEqual([null, 'true', null, null, null]);
    expect(buttons[2]?.getAttribute('aria-label')).toBe('Show AAPL over 5 days');
    const fiveDays = buttons[2] as HTMLElement;
    expect(await fireEvent.mouseDown(fiveDays)).toBe(false);
    await fireEvent.click(fiveDays);
    expect(onaction).toHaveBeenCalledWith(view.chips[2]?.action);
  });

  it('draws chips as text with no host to act, and never acts on a forged action', async () => {
    const { container } = card(live('AAPL'));
    expect(container.querySelectorAll('button')).toHaveLength(0);
    const onaction = vi.fn();
    const view = cardView(live('AAPL'), '1d', RECORDED_AT_MS);
    const forged = { ...view, chips: [{ label: 'reset', title: 'x', active: false, action: { kind: 'run', line: 'reset' } as unknown as Action }] };
    const { container: forgedCard } = render(QuoteCard, { props: { view: forged, alt: 'x', onaction } });
    expect(forgedCard.querySelectorAll('button')).toHaveLength(0);
    expect(forgedCard.querySelector('.chip')?.textContent).toBe('reset');
  });

  it('draws only its summary for a view model that is not a card', () => {
    const { container } = render(QuoteCard, { props: { view: { kind: 'other' }, alt: 'AAPL: 332.89 USD' } });
    expect(container.textContent).toBe('AAPL: 332.89 USD');
  });

  it('is registered to load lazily', async () => {
    expect(await loadComponent('quote-card')).toBe(QuoteCard);
    expect(await loadComponent('quote-table')).toBe(QuoteTable);
  });
});

describe('the quote table', () => {
  const rows = (): { symbol: string; outcome: QuoteOutcome }[] => [
    { symbol: 'AAPL', outcome: live('AAPL') },
    { symbol: 'CBA.AX', outcome: { ok: true, quote: { ...quoteOf('CBA.AX'), name: HOSTILE_NAME }, freshness: 'saved', savedAt: RECORDED_AT_MS - 3_600_000, reason: 'timeout', via: 'worker' } },
    { symbol: 'BTC-USD', outcome: live('BTC-USD') },
    { symbol: 'ZZZZQQ', outcome: { ok: false, error: { code: 'not_found' } } },
  ];

  it('has a row per ticker, the failures inline, every colour a token', () => {
    const view = tableView(rows(), RECORDED_AT_MS);
    const { container } = render(QuoteTable, { props: { view, alt: tableAlt(view), onaction: vi.fn() } });
    const text = Array.from(container.querySelectorAll('tbody tr'), (row) => Array.from(row.querySelectorAll('td'), (cell) => cell.textContent?.trim() ?? ''));
    expect(text).toMatchSnapshot();
    expect(container.querySelector('td.failure')?.getAttribute('colspan')).toBe('4');
    expect(container.querySelectorAll('.badge')).toHaveLength(1);
    expect(container.querySelector('img, script')).toBeNull();
    expect(container.innerHTML).not.toContain('<pre');
    expectTokenColours(container);
    // A mini chart per row that has one, each with its own gradient.
    const ids = Array.from(container.querySelectorAll('linearGradient'), (gradient) => gradient.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('opens a ticker from its chip, without taking focus', async () => {
    const onaction = vi.fn();
    const view = tableView(rows(), RECORDED_AT_MS);
    const { container } = render(QuoteTable, { props: { view, alt: 'x', onaction } });
    const chip = container.querySelector('button.chip') as HTMLElement;
    expect(chip.textContent).toBe('AAPL');
    expect(await fireEvent.mouseDown(chip)).toBe(false);
    await fireEvent.click(chip);
    expect(onaction).toHaveBeenCalledWith(view.rows[0]?.action);
    expect(view.rows[0]?.action).toEqual(out.action.run('stock AAPL'));
  });
});

describe('the components’ stylesheets', () => {
  it.each(['QuoteCard.svelte', 'QuoteTable.svelte', 'Sparkline.svelte'])('%s uses only role and palette colours', (file) => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), file), 'utf8');
    const style = /<style>([\s\S]*?)<\/style>/.exec(source)?.[1] ?? '';
    expect(style).not.toBe('');
    expect(style).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|color-mix/i);
    for (const match of style.matchAll(/(?:^|[\s;{])(color|background(?:-color)?|border(?:-(?:top|bottom|left|right))?(?:-color)?|stroke|fill)\s*:\s*([^;]+);/g)) {
      const value = match[2] ?? '';
      if (!/(?:^|\s)(?:solid|dashed)\s|^var\(|^none$|^transparent$|^\d/.test(value) && /[a-z]/i.test(value)) {
        expect(value, `${match[1]}: ${value}`).toMatch(/var\(--(?:role|theme)-/);
      }
      if (/var\(/.test(value)) expect(value, `${match[1]}: ${value}`).toMatch(/var\(--(?:role|theme)-[a-z-]+\)/);
    }
  });
});
