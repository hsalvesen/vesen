import { fireEvent, render } from '@testing-library/svelte';
import { flushSync, tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import themes from '../../themes.json';
import { activeContent } from '../../tests/support/xss';
import { out, type Action, type Block, type ComponentName, type SafeHref, type Span } from '../output/model';
import { cathode } from '../stores/cathode';
import { theme } from '../stores/theme';
import FakeCard from '../testing/FakeCard.svelte';
import OutputView from './OutputView.svelte';
import { registerComponent, type BlockComponent } from './components/registry';

/** Renders blocks and waits for the layout-block renderer, which loads on first use. */
async function view(blocks: readonly Block[], onaction?: (action: Action) => void): Promise<HTMLElement> {
  const { container } = render(OutputView, onaction ? { blocks, onaction } : { blocks });
  await vi.dynamicImportSettled();
  for (let i = 0; i < 5; i += 1) await tick();
  return container;
}

/** An element's style attribute without the trailing semicolon the DOM may add. */
function styleOf(element: Element | null | undefined): string | undefined {
  return element?.getAttribute('style')?.replace(/;\s*$/, '');
}

function themeNamed(name: string) {
  const found = themes.find((t) => t.name.toLowerCase() === name);
  if (!found) throw new Error(`no theme ${name}`);
  return found;
}

afterEach(() => {
  theme.set(themeNamed('swamphen'));
  cathode.set('scanlines');
});

describe('OutputView: text', () => {
  it('draws lines of styled spans with palette and role colours', async () => {
    const root = await view([
      out.lines([
        [out.span('ok', { fg: 'cyan', bold: true }), out.span(' then '), out.span('fail', { fg: 'error' })],
        [],
        [out.span('last', { dim: true, underline: true })],
      ]),
    ]);
    const rows = root.querySelectorAll('.lines > .text');
    expect(rows).toHaveLength(3);
    expect(rows[0]?.textContent).toBe('ok then fail');
    expect(rows[1]?.querySelector('br')).not.toBeNull();
    expect(rows[1]?.textContent).toBe('');

    const [ok, plainText, fail] = Array.from(rows[0]?.querySelectorAll('span') ?? []);
    expect(styleOf(ok)).toBe('color: var(--theme-cyan)');
    expect(ok?.classList.contains('b')).toBe(true);
    expect(plainText?.hasAttribute('style')).toBe(false);
    expect(styleOf(fail)).toBe('color: var(--role-error, var(--theme-red))');
    expect(rows[2]?.querySelector('span')?.className).toMatch(/\bdim\b.*\bu\b/);
  });

  it('shows markup in span text as text, never as elements', async () => {
    const root = await view([out.text('<img src=x onerror=window.__x=1> & <b>bold</b>\n')]);
    expect(root.querySelector('.lines')?.textContent).toBe('<img src=x onerror=window.__x=1> & <b>bold</b>');
    expect(root.querySelector('img, b')).toBeNull();
  });

  it('marks stderr lines', async () => {
    expect((await view([out.text('boom', { fg: 'error' }, 'stderr')])).querySelector('.lines.stderr')).not.toBeNull();
  });

  it('swaps colours for inverse text', async () => {
    const span = (await view([out.lines([[out.span('x', { fg: 'green', inverse: true })]])])).querySelector('.text span');
    expect(styleOf(span)).toBe('color: var(--theme-background); background-color: var(--theme-green)');
  });
});

describe('OutputView: links and actions', () => {
  it('opens checked links in a new tab without an opener', async () => {
    const link = (await view([out.lines([[out.link('repo', 'https://github.com/hsalvesen/vesen')]])])).querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://github.com/hsalvesen/vesen');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('checks an href again at render time', async () => {
    const forged: Span = { text: 'x', href: 'javascript:window.__x=1' as SafeHref };
    const root = await view([out.lines([[forged]])]);
    expect(root.querySelector('a')).toBeNull();
    expect(activeContent(root)).toEqual([]);
  });

  it('turns a trusted action into a button that calls back with it', async () => {
    const onaction = vi.fn();
    const span = out.run('ls', 'ls -la');
    const button = (await view([out.lines([[span]])], onaction)).querySelector('button');
    expect(button?.getAttribute('type')).toBe('button');
    expect(button?.textContent).toBe('ls');
    if (!button) throw new Error('no button');
    await fireEvent.click(button);
    expect(onaction).toHaveBeenCalledWith(span.action);
  });

  it('never takes focus from the prompt when an action or a chip is pressed, so a phone keyboard stays up', async () => {
    const chips = out.chips([{ label: 'help', action: out.action.run('help') }], 'Try');
    const root = await view([out.lines([[out.run('wombat', 'theme set wombat')]]), chips], vi.fn());
    const input = document.body.appendChild(document.createElement('input'));
    input.focus();
    for (const button of Array.from(root.querySelectorAll('button'))) {
      expect(await fireEvent.mouseDown(button), button.textContent ?? '').toBe(false);
    }
    expect(document.activeElement).toBe(input);
    input.remove();
  });

  it('never makes a button from an action it did not build', async () => {
    const forged = { text: 'x', action: { kind: 'run', line: 'rm -rf ~' } } as unknown as Span;
    expect((await view([out.lines([[forged]])], vi.fn())).querySelector('button')).toBeNull();
  });

  it('draws actions as plain text when nothing can act on them', async () => {
    const root = await view([out.lines([[out.run('ls', 'ls')]])]);
    expect(root.querySelector('button')).toBeNull();
    expect(root.textContent).toBe('ls');
  });

  it('draws chips as buttons only for trusted actions', async () => {
    const onaction = vi.fn();
    const chips = out.chips([{ label: 'help', action: out.action.run('help') }], 'Try');
    const forged = { type: 'chips', items: [{ label: 'evil', action: { kind: 'run', line: 'x' } }] } as unknown as Block;
    const root = await view([chips, forged], onaction);
    const buttons = root.querySelectorAll('button');
    expect(Array.from(buttons, (b) => b.textContent)).toEqual(['help']);
    await fireEvent.click(buttons[0] as HTMLButtonElement);
    expect(onaction).toHaveBeenCalledWith(chips.items[0]?.action);
    expect(root.textContent).toContain('evil');
  });

  it('draws a card as a real link in a new tab, with Copy (ui/components/LinkCard.test.ts has the rest)', async () => {
    const root = await view([out.card({ title: 'LinkedIn', href: 'https://www.linkedin.com/in/example', detail: 'profile' })], vi.fn());
    const link = root.querySelector('a.card-url');
    expect(link?.getAttribute('href')).toBe('https://www.linkedin.com/in/example');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link?.textContent).toBe('↗ linkedin.com/in/example');
    expect(root.querySelector('.card-detail')?.textContent).toBe('profile');
    expect(root.querySelector('button.card-copy')?.textContent?.trim()).toBe('⧉ Copy');
  });
});

describe('OutputView: layout blocks', () => {
  it('lays a grid with notes out as an item column and a note beside each item', async () => {
    const blocks = [out.grid([out.insert('ls', 'ls '), out.span('mkdir')], 40, [[out.span('list')], [out.span('make')]])];
    const grid = (await view(blocks, () => {})).querySelector('.grid');
    expect(styleOf(grid)).toBe('--min-col: 40ch; --item-col: 5ch');
    const cells = Array.from(grid?.querySelectorAll('.cell') ?? []);
    expect(cells.map((cell) => Array.from(cell.children, (child) => child.textContent))).toEqual([
      ['ls', 'list'],
      ['mkdir', 'make'],
    ]);
    expect(cells[0]?.querySelector('button')?.textContent).toBe('ls');
  });

  it("fills ls's columns top to bottom, and other grids row by row", async () => {
    const byColumn = (await view([out.grid([out.span('a'), out.span('b'), out.span('c')], undefined, undefined, 'columns')])).querySelector('.grid');
    expect(byColumn?.classList.contains('by-column')).toBe(true);
    expect(Array.from(byColumn?.children ?? []).map((child) => child.textContent)).toEqual(['a', 'b', 'c']);
    const byRow = (await view([out.grid([out.span('a')])])).querySelector('.grid');
    expect(byRow?.classList.contains('by-column')).toBe(false);
  });

  it('lays a grid out in as many columns as fit', async () => {
    const grid = (await view([out.grid([out.span('README.md'), out.span('documents/', { fg: 'brightBlue' })])])).querySelector('.grid');
    expect(styleOf(grid)).toBe('--min-col: 12ch');
    expect(grid?.children).toHaveLength(2);
    expect(styleOf((await view([out.grid([out.span('a')], 20)])).querySelector('.grid'))).toBe('--min-col: 20ch');
  });

  it('draws a table with a hidden key label per cell for the stacked layout', async () => {
    const table = (await view([
      out.table([[[out.span('AAPL')], [out.span('190.10')]]], {
        head: [[out.span('Symbol')], [out.span('Price')]],
        align: ['l', 'r'],
        stackBelowCols: 35,
      }),
    ])).querySelector('table');
    expect(table?.classList.contains('stack-40')).toBe(true);
    expect(Array.from(table?.querySelectorAll('th') ?? [], (th) => th.textContent)).toEqual(['Symbol', 'Price']);
    const cells = table?.querySelectorAll('td');
    expect(cells?.[1]?.classList.contains('right')).toBe(true);
    expect(cells?.[1]?.querySelector('.cell-label')?.textContent).toBe('Price: ');
    expect(cells?.[1]?.querySelector('.cell-label')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('never stacks a table without a threshold', async () => {
    expect((await view([out.table([[[out.span('a')]]])])).querySelector('table')?.className).toMatch(/^table\b(?!.*stack)/);
  });

  it('hides art from screen readers and gives them the alt text instead', async () => {
    const root = await view([out.art('██\n██', 'The vesen logo')]);
    const art = root.querySelector('.art');
    expect(art?.getAttribute('aria-hidden')).toBe('true');
    expect(art?.textContent).toBe('██\n██');
    // The global art classes (styles/terminal.css): block rows touch, and the font shrinks to fit.
    expect(art?.classList.contains('art-fit')).toBe(true);
    expect(art?.classList.contains('art-block')).toBe(true);
    expect(art?.classList.contains('art-glyph')).toBe(false);
    expect(styleOf(art)).toBe('--art-cols: 2');
    expect(root.querySelector('.sr-only')?.textContent).toBe('The vesen logo');
  });

  it('draws art made of letters at the terminal line height, and still fits it to the width', async () => {
    const cow = ' /\\_/\\\n( o.o )\n > ^ <';
    const art = (await view([out.art(cow, 'A cat')])).querySelector('.art');
    expect(art?.classList.contains('art-glyph')).toBe(true);
    expect(art?.classList.contains('art-block')).toBe(false);
    expect(art?.classList.contains('art-fit')).toBe(true);
    expect(styleOf(art)).toBe('--art-cols: 7');
    // Scrolling art keeps its class and its kind without the fit.
    const wide = (await view([out.art('├── a\n└── b', 'A tree', 'scroll')])).querySelector('.art');
    expect(wide?.classList.contains('art-fit')).toBe(false);
    expect(wide?.classList.contains('art-block')).toBe(true);
  });

  it('draws a panel in its tone with a title', async () => {
    const panel = (await view([out.panel('warn', [[out.span('Request cancelled')]], 'stock')])).querySelector('.out-panel');
    expect(styleOf(panel)).toBe('--panel-tone: var(--role-warn, var(--theme-yellow))');
    expect(panel?.querySelector('.out-panel-title')?.textContent).toBe('stock');
    expect(Array.from(panel?.querySelectorAll('.text') ?? [], (row) => row.textContent)).toEqual(['stock', 'Request cancelled']);
  });

  it('nests columns', async () => {
    const columns = (await view([out.columns([out.text('left')], [out.text('right')], 60)])).querySelector('.columns');
    expect(styleOf(columns)).toBe('--stack-at: 60ch');
    expect(Array.from(columns?.querySelectorAll('.column') ?? [], (c) => c.textContent)).toEqual(['left', 'right']);
  });

  it('shows a component with no registered card as its plain text', async () => {
    // A name no card is registered for: every real name gets a card as its workstream lands.
    const unregistered = 'no-such-card' as ComponentName;
    const root = await view([out.component(unregistered, { place: 'Oslo' }, 'Oslo: 9°C, light rain\n', 'Weather in Oslo')]);
    expect(root.textContent).toBe('Oslo: 9°C, light rain\n');
  });

  it('draws a registered card from its own chunk, with the plain text until the chunk arrives', async () => {
    let arrive: (module: { default: BlockComponent }) => void = () => {};
    const load = vi.fn(() => new Promise<{ default: BlockComponent }>((resolve) => (arrive = resolve)));
    registerComponent('qr-card', load);
    const block = out.component('qr-card', { text: 'hi' }, 'QR code for hi\n', 'QR code for hi');
    const root = await view([block, block]);
    expect(root.textContent).toBe('QR code for hi\nQR code for hi\n');
    expect(load).toHaveBeenCalledTimes(1);
    arrive({ default: FakeCard as BlockComponent });
    await vi.waitFor(() => expect(root.querySelectorAll('.component [data-fake-card]')).toHaveLength(2));
    expect(root.querySelector('[data-fake-card]')?.getAttribute('aria-label')).toBe('QR code for hi');
    expect(root.textContent).toBe('hihi');
    // Drawn again, it draws at once, from the chunk already here.
    const again = await view([block]);
    expect(again.querySelector('.component [data-fake-card]')?.textContent).toBe('hi');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('shows the plain text of a card whose chunk does not load, and tries again next time', async () => {
    const load = vi.fn(() => Promise.reject(new Error('offline')));
    registerComponent('quote-card', load);
    const block = out.component('quote-card', {}, 'CBA.AX 1.00\n', 'Quote');
    const root = await view([block]);
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    for (let i = 0; i < 5; i += 1) await tick();
    expect(root.textContent).toBe('CBA.AX 1.00\n');
    await view([block]);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('never draws HTML, even from a block shaped like the retired legacyHtml one', async () => {
    const stale = { type: 'legacyHtml', html: '<b>bold</b><img src=x onerror=window.__x=1>' } as unknown as Block;
    const root = await view([stale, out.text('after')]);
    expect(root.querySelector('b, img')).toBeNull();
    expect(root.textContent).toBe('after');
    expect((window as unknown as { __x?: unknown }).__x).toBeUndefined();
  });

  it('skips blocks it does not know', async () => {
    const root = await view([{ type: 'marquee', text: 'x' } as unknown as Block, out.text('after')]);
    expect(root.textContent).toBe('after');
  });
});

describe('OutputView: live bindings', () => {
  it('highlights the current theme and follows the store', async () => {
    const root = await view([
      out.lines([
        [{ text: 'swamphen', live: { kind: 'isCurrentTheme', theme: 'swamphen' } }],
        [{ text: 'cockatoo', live: { kind: 'isCurrentTheme', theme: 'cockatoo' } }],
      ]),
    ]);
    const current = () => Array.from(root.querySelectorAll('[aria-current="true"]'), (el) => el.textContent);
    theme.set(themeNamed('swamphen'));
    flushSync();
    expect(current()).toEqual(['swamphen']);
    expect(styleOf(root.querySelector('[aria-current="true"]'))).toBe('color: var(--role-accent, var(--theme-cyan))');

    theme.set(themeNamed('cockatoo'));
    flushSync();
    expect(current()).toEqual(['cockatoo']);
  });

  it('prints the current theme name and the current cathode mode', async () => {
    const root = await view([
      out.lines([
        [{ text: 'stale', live: { kind: 'currentThemeName' } }],
        [{ text: 'vintage', live: { kind: 'isCurrentCathode', mode: 'vintage' } }],
      ]),
    ]);
    theme.set(themeNamed('cockatoo'));
    cathode.set('vintage');
    flushSync();
    const rows = root.querySelectorAll('.text');
    expect(rows[0]?.textContent).toBe(themeNamed('cockatoo').name);
    expect(rows[1]?.querySelector('[aria-current="true"]')?.textContent).toBe('vintage');

    cathode.set('off');
    flushSync();
    expect(rows[1]?.querySelector('[aria-current="true"]')).toBeNull();
  });
});
