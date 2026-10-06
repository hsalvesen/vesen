// theme ls and cathode ls on the screen: the marker and the highlight on the current theme or CRT
// mode are live, so they move in a listing already on the screen when the theme or mode changes,
// with no command run again and no DOM patching (F030). The swatches keep their own colours.
import { render } from '@testing-library/svelte';
import { flushSync, tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runLine } from '../../tests/harness';
import type { Block, HexColour, Span } from '../output/model';
import { cathode } from '../stores/cathode';
import { defaultTheme, findTheme, theme } from '../stores/theme';
import OutputView from './OutputView.svelte';

afterEach(() => {
  theme.set(defaultTheme);
  cathode.set('scanlines');
});

async function view(blocks: readonly Block[]): Promise<HTMLElement> {
  const { container } = render(OutputView, { blocks, onaction: () => {} });
  await vi.dynamicImportSettled();
  for (let i = 0; i < 5; i += 1) await tick();
  return container;
}

/** Each listed row as its marker and name, as the screen shows them now. */
function listed(root: HTMLElement): { marker: string; name: string; current: boolean }[] {
  return Array.from(root.querySelectorAll('.lines > .text'))
    .filter((row) => row.querySelector('button') !== null)
    .map((row) => {
      const [marker] = Array.from(row.querySelectorAll(':scope > span'));
      const button = row.querySelector('button');
      return { marker: marker?.textContent ?? '', name: button?.textContent ?? '', current: button?.getAttribute('aria-current') === 'true' };
    });
}

describe('theme ls on the screen', () => {
  it('moves its marker and highlight to the new theme without running again', async () => {
    const root = await view((await runLine('theme ls')).blocks);
    const before = listed(root);
    expect(before.find((row) => row.name === 'swamphen')).toEqual({ marker: '› ', name: 'swamphen', current: true });
    expect(before.find((row) => row.name === 'wombat')).toEqual({ marker: '  ', name: 'wombat', current: false });

    const wombat = findTheme('wombat');
    if (wombat === undefined) throw new Error('no wombat');
    theme.set(wombat);
    flushSync();

    const after = listed(root);
    expect(after.find((row) => row.name === 'swamphen')).toEqual({ marker: '  ', name: 'swamphen', current: false });
    expect(after.find((row) => row.name === 'wombat')).toEqual({ marker: '› ', name: 'wombat', current: true });
    // The marker is for the eye; the button says which is current.
    expect(root.querySelector('.lines > .text > span[aria-hidden="true"]')).not.toBeNull();
  });

  it("draws each theme's swatches in its own hex, hidden from screen readers", async () => {
    const root = await view((await runLine('theme ls')).blocks);
    const strips = root.querySelectorAll('.swatches');
    expect(strips).toHaveLength(10);
    const cockatoo = strips[1];
    expect(cockatoo?.getAttribute('aria-hidden')).toBe('true');
    expect(cockatoo?.getAttribute('style')).toMatch(/background-color: #e8ddd0/);
    expect(cockatoo?.querySelectorAll('span')).toHaveLength(8);
    expect(cockatoo?.textContent).toBe(` ${'██'.repeat(8)} `);
  });

  it('refuses a strip with a colour that is not #rrggbb, drawing nothing for it', async () => {
    const forged: Span = { text: 'x', swatches: { background: 'url(x)' as HexColour, colours: ['#ffffff' as HexColour] } };
    const root = await view([{ type: 'lines', stream: 'stdout', lines: [[forged]] }]);
    expect(root.querySelector('.swatches')).toBeNull();
    expect(root.innerHTML).not.toContain('url(');
  });
});

describe('cathode ls on the screen', () => {
  it('moves its marker to the new mode', async () => {
    const root = await view((await runLine('cathode ls')).blocks);
    expect(listed(root).find((row) => row.current)?.name).toBe('scanlines');
    cathode.set('vintage');
    flushSync();
    const rows = listed(root);
    expect(rows.find((row) => row.current)?.name).toBe('vintage');
    expect(rows.find((row) => row.name === 'vintage')?.marker).toBe('› ');
    expect(rows.find((row) => row.name === 'scanlines')?.marker).toBe('  ');
  });
});
