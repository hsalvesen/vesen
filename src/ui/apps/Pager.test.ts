// The pager (wave F): less's keys move a screen, half a screen or a line; /text and ?text search,
// highlighting every match, n and N go on; h shows the keys and q goes back; q and Esc close it;
// more leaves at the end; on a touch screen a toolbar of buttons and swipes do the same.
import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PAGER_CLOSED, type PagerView } from '../../lib/pager';
import type { Line } from '../../output/model';
import Pager from './Pager.svelte';

const numbered = (count: number): Line[] => Array.from({ length: count }, (_, i) => [{ text: `line ${i + 1}` }]);

function view(extra: Partial<PagerView> = {}): PagerView {
  // 11 rows: 10 of text and the status line.
  return { title: 'notes.txt', lines: numbered(100), mode: 'less', touch: false, columns: 80, rows: 11, ...extra };
}

function open(extra: Partial<PagerView> = {}) {
  const close = vi.fn();
  const result = render(Pager, { props: { props: view(extra), close } });
  const rows = () => Array.from(result.container.querySelectorAll('.row')).map((row) => row.textContent ?? '');
  const status = () => result.container.querySelector('.status .where')?.textContent ?? '';
  return { ...result, close, rows, status };
}

const press = async (key: string, init: KeyboardEventInit = {}) => {
  await fireEvent.keyDown(window, { key, ...init });
  await tick();
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Pager', () => {
  it('shows the first screen, with the name, the lines on screen and how far through', () => {
    const { rows, status } = open();
    expect(rows()).toEqual(numbered(10).map((line) => line[0]?.text));
    expect(status()).toBe('notes.txt lines 1-10/100 10%');
    expect(screen.getByText('h help · q quit')).toBeInTheDocument();
  });

  it("moves with less's keys", async () => {
    const { rows, status } = open();
    await press(' ');
    expect(rows()[0]).toBe('line 11');
    await press('b');
    expect(rows()[0]).toBe('line 1');
    await press('j');
    await press('ArrowDown');
    expect(rows()[0]).toBe('line 3');
    await press('k');
    expect(rows()[0]).toBe('line 2');
    await press('d');
    expect(rows()[0]).toBe('line 7');
    await press('u');
    expect(rows()[0]).toBe('line 2');
    await press('PageDown');
    expect(rows()[0]).toBe('line 12');
    await press('G');
    expect(rows()[0]).toBe('line 91');
    expect(rows()).toHaveLength(10);
    expect(status()).toBe('notes.txt lines 91-100/100 (END)');
    await press('g');
    expect(rows()[0]).toBe('line 1');
    await press('End');
    await press('Home');
    expect(rows()[0]).toBe('line 1');
  });

  it('searches forward with /, highlights every match, and n and N go on', async () => {
    const { container, rows, status } = open({ lines: [...numbered(40), [{ text: 'the end of line 40' }]] });
    await press('/');
    const box = screen.getByRole('textbox', { name: 'Search forward for' });
    expect(document.activeElement).toBe(box);
    // While typing, letters are the search's, not the pager's keys.
    await fireEvent.input(box, { target: { value: 'line 4' } });
    await fireEvent.keyDown(box, { key: 'q' });
    await fireEvent.keyDown(box, { key: 'Enter' });
    await tick();
    expect(rows()[0]).toBe('line 4');
    expect(screen.queryByRole('textbox')).toBeNull();
    // Every match on the screen is marked, case and all.
    expect(Array.from(container.querySelectorAll('.hit')).map((hit) => hit.textContent)).toEqual(['line 4']);
    // line 40: on the last screen, where the top stops so the end shows, both matches marked.
    await press('n');
    expect(rows()[0]).toBe('line 32');
    expect(status()).toBe('notes.txt lines 32-41/41 (END)');
    expect(Array.from(container.querySelectorAll('.hit')).map((hit) => hit.textContent)).toEqual(['line 4', 'line 4']);
    // The last line, then no more: less does not go round.
    await press('n');
    await press('n');
    expect(status()).toBe('Pattern not found');
    // N goes back the other way.
    await press('N');
    await press('N');
    expect(rows()[0]).toBe('line 4');
  });

  it('says when nothing matches, and searches back with ?', async () => {
    const { rows, status } = open();
    await press('/');
    await fireEvent.input(screen.getByRole('textbox'), { target: { value: 'nowhere' } });
    await fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    await tick();
    expect(status()).toBe('Pattern not found');
    expect(screen.getByRole('status').textContent).toBe('Pattern not found');
    await press('G');
    await press('?');
    await fireEvent.input(screen.getByRole('textbox', { name: 'Search back for' }), { target: { value: 'line 5' } });
    await fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    await tick();
    expect(rows()[0]).toBe('line 59');
    // An empty search repeats the last one, and Esc leaves the box.
    await press('/');
    await fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    await tick();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('shows the keys with h, and q goes back to the text where it was', async () => {
    const { rows, status, close } = open();
    await press(' ');
    await press('h');
    expect(rows()[0]).toContain('SUMMARY OF PAGER COMMANDS');
    expect(status()).toBe('HELP -- press q when done');
    await press('q');
    expect(rows()[0]).toBe('line 11');
    expect(close).not.toHaveBeenCalled();
  });

  it.each(['q', 'Q', 'Escape'])('closes on %s, handing back that it showed', async (key) => {
    const { close } = open();
    await press(key);
    expect(close).toHaveBeenCalledWith(PAGER_CLOSED);
  });

  it('leaves the browser its own shortcuts', async () => {
    const { rows } = open();
    const event = new KeyboardEvent('keydown', { key: 'c', metaKey: true, cancelable: true, bubbles: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(rows()[0]).toBe('line 1');
  });

  it('as more, says --More-- and leaves when a screen forward goes past the end', async () => {
    const { status, close } = open({ mode: 'more', lines: numbered(15) });
    expect(status()).toBe('--More--(66%)');
    await press(' ');
    expect(status()).toBe('(END)');
    expect(close).not.toHaveBeenCalled();
    await press(' ');
    expect(close).toHaveBeenCalledWith(PAGER_CLOSED);
  });

  it('says what the command noted, such as input cut short', () => {
    const { status } = open({ note: 'Only the first 5,000 lines are shown.' });
    expect(status()).toBe('Only the first 5,000 lines are shown.');
  });

  it('wraps long lines at the edge, and numbers lines with -N', async () => {
    const { rows } = open({ lines: [[{ text: 'x'.repeat(100) }], [{ text: 'short' }]], columns: 40, numbers: true });
    // Two cells for the number and its space: 38 to a row.
    expect(rows()).toEqual([`1 ${'x'.repeat(38)}`, `  ${'x'.repeat(38)}`, `  ${'x'.repeat(24)}`, '2 short']);
  });

  it('draws spans in their styles', () => {
    const { container } = open({ lines: [[{ text: 'bold', style: { bold: true, fg: 'accent' } }, { text: ' plain' }]] });
    const bold = Array.from(container.querySelectorAll('.row span')).find((span) => span.textContent === 'bold');
    expect(bold?.className).toContain('b');
    expect(bold?.getAttribute('style')).toContain('--role-accent');
  });
});

describe('Pager on a touch screen', () => {
  it('has a toolbar of buttons for a screen back, a screen on, Search and Close, and no key hint', async () => {
    const { rows, close } = open({ touch: true });
    const toolbar = screen.getByRole('toolbar', { name: 'Pager' });
    expect(Array.from(toolbar.querySelectorAll('button')).map((button) => button.getAttribute('aria-label') ?? button.textContent)).toEqual([
      'Back a screen',
      'On a screen',
      'Search',
      'Close',
    ]);
    expect(screen.queryByText('h help · q quit')).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'On a screen' }));
    expect(rows()[0]).toBe('line 11');
    await fireEvent.click(screen.getByRole('button', { name: 'Back a screen' }));
    expect(rows()[0]).toBe('line 1');
    await fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await tick();
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Search forward for' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(close).toHaveBeenCalledWith(PAGER_CLOSED);
  });

  it('scrolls with a swipe, a row for each line height the finger moves', async () => {
    const { container, rows } = open({ touch: true });
    const body = container.querySelector('.rows') as HTMLElement;
    await fireEvent.pointerDown(body, { pointerId: 1, pointerType: 'touch', clientY: 400 });
    // The default line height, 18px, until the pager has measured one.
    await fireEvent.pointerMove(body, { pointerId: 1, pointerType: 'touch', clientY: 400 - 18 * 5 });
    expect(rows()[0]).toBe('line 6');
    await fireEvent.pointerMove(body, { pointerId: 1, pointerType: 'touch', clientY: 400 - 18 * 2 });
    expect(rows()[0]).toBe('line 3');
    await fireEvent.pointerUp(body, { pointerId: 1, pointerType: 'touch' });
    // A mouse drag selects text instead.
    await fireEvent.pointerDown(body, { pointerId: 2, pointerType: 'mouse', clientY: 400 });
    await fireEvent.pointerMove(body, { pointerId: 2, pointerType: 'mouse', clientY: 100 });
    expect(rows()[0]).toBe('line 3');
  });

  it('scrolls with the wheel', async () => {
    const { container, rows } = open();
    await fireEvent.wheel(container.querySelector('.rows') as HTMLElement, { deltaY: 18 * 4, deltaMode: 0 });
    expect(rows()[0]).toBe('line 5');
  });
});
