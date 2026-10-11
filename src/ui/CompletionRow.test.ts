import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import type { Chip, CompletionResult } from '../shell/complete/types';
import CompletionRow from './CompletionRow.svelte';

const result = { state: { text: '', cursor: 0 } } as CompletionResult;
const chip = (label: string, extra: Partial<Chip> = {}): Chip => ({
  id: `value:${label}`,
  label,
  matchLen: 1,
  kind: 'value',
  action: { kind: 'apply', result, candidate: { value: label, label, kind: 'value', terminal: true } },
  ...extra,
});

/** The column width the row set from its chips, in ch. */
const column = (): string => screen.getByRole('listbox').style.getPropertyValue('--column');

describe('CompletionRow', () => {
  it('draws chips as options in a listbox, with the typed part bold, swatches and a count of the rest', () => {
    const { container } = render(CompletionRow, {
      props: { chips: [chip('kangaroo', { swatch: '#262626', summary: 'kangaroo' }), chip('kookaburra')], more: 3 },
    });
    const list = screen.getByRole('listbox', { name: 'Suggestions' });
    const options = screen.getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['kangaroo', 'kookaburra']);
    expect(list.id).toBe('completion-list');
    expect(options[0]?.id).toBe('completion-list-0');
    expect(options[0]?.getAttribute('tabindex')).toBe('-1');
    expect(options[0]?.querySelector('b')?.textContent).toBe('k');
    expect((options[0]?.querySelector('.swatch') as HTMLElement | null)?.style.background).toBe('#262626');
    expect(options[0]?.getAttribute('title')).toBe('kangaroo');
    expect(container.querySelector('.more')?.textContent).toBe('+3 more');
    // The quiet row has no descriptions and no line for a choice.
    expect(container.querySelector('.summary')).toBeNull();
    expect(container.querySelector('.choice')).toBeNull();
    // Text only: a label is never markup.
    expect(container.innerHTML).not.toContain('<img');
  });

  it('shows a short list with each description beside its name after Tab, in columns sized from the names, and marks the menu choice', () => {
    const { container } = render(CompletionRow, {
      props: { chips: [chip('--all', { summary: 'do not hide entries starting with .' }), chip('--almost-all', { selected: true })], listed: true },
    });
    screen.getByRole('listbox', { name: 'Completions' });
    const [first, second] = screen.getAllByRole('option');
    expect(first?.textContent).toBe('--alldo not hide entries starting with .');
    expect(first?.querySelector('.summary')?.textContent).toBe('do not hide entries starting with .');
    expect(first?.getAttribute('aria-selected')).toBe('false');
    expect(second?.getAttribute('aria-selected')).toBe('true');
    // The widest name, --almost-all, and the chip's padding: 12 + 1.
    expect(column()).toBe('13ch');
    expect(container.querySelector('.completion-row')?.classList.contains('long')).toBe(false);
    // The descriptions are beside the names: no line under the list repeats the choice's.
    expect(container.querySelector('.choice')).toBeNull();
  });

  it('shows a long list as names only, each still named and described for a screen reader, with the choice named under it', () => {
    const chips = Array.from({ length: 17 }, (_, i) => chip(`cmd${i}`, { summary: `does ${i}` }));
    const selected = { ...(chips[3] as Chip), selected: true };
    chips[3] = selected;
    const { container } = render(CompletionRow, { props: { chips, listed: true, choice: selected } });
    expect(container.querySelector('.completion-row')?.classList.contains('long')).toBe(true);
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(17);
    expect(options.map((o) => o.textContent)).toEqual(chips.map((c) => c.label));
    expect(container.querySelector('.summary')).toBeNull();
    // Its name is the label itself: nothing else labels it (the test DOM reads the bold part as a word of its own).
    expect(options[3]?.getAttribute('aria-label')).toBeNull();
    expect(options[3]?.textContent).toBe('cmd3');
    expect(options[3]?.getAttribute('aria-selected')).toBe('true');
    expect(options[3]?.getAttribute('title')).toBe('does 3');
    // cmd10 to cmd16 are 5 wide, and the padding.
    expect(column()).toBe('6ch');
    const choice = container.querySelector('.choice');
    expect(choice?.querySelector('.choice-name')?.textContent).toBe('cmd3');
    expect(choice?.querySelector('.choice-summary')?.textContent).toBe('does 3');
  });

  it('counts the run mark and a swatch in the column, and names the choice on its own where the dock draws the chips', async () => {
    const { container, rerender } = render(CompletionRow, {
      props: { chips: [chip('help', { kind: 'starter', action: { kind: 'run', line: 'help' } }), chip('kangaroo', { swatch: '#262626' })], listed: true },
    });
    // kangaroo (8) with its swatch (2.1) and the padding, wider than help (4) with its > (2).
    expect(column()).toBe('11.1ch');
    // On a phone the dock draws the chips: the choice comes alone, and is still named.
    await rerender({ chips: [], listed: true, choice: chip('date', { selected: true, summary: 'print the date and time' }) });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(container.querySelector('.choice')?.textContent).toBe('dateprint the date and time');
    // A choice with nothing to say, or one while the list is not open, has no line.
    await rerender({ chips: [], listed: true, choice: chip('f001', { selected: true }) });
    expect(container.querySelector('.choice')).toBeNull();
    await rerender({ chips: [], listed: false, choice: chip('date', { selected: true, summary: 'print the date and time' }) });
    expect(container.querySelector('.choice')).toBeNull();
  });

  it('keeps focus on the prompt: mousedown and a mouse pointerdown are cancelled, a touch pointerdown is not', async () => {
    const onchoose = vi.fn();
    render(CompletionRow, { props: { chips: [chip('help')], onchoose } });
    const option = screen.getByRole('option');
    expect(await fireEvent.mouseDown(option)).toBe(false);
    expect(await fireEvent.pointerDown(option, { pointerType: 'mouse' })).toBe(false);
    // WebKit on iOS drops the tap when pointerdown is cancelled.
    expect(await fireEvent.pointerDown(option, { pointerType: 'touch' })).toBe(true);
    await fireEvent.click(option);
    expect(onchoose).toHaveBeenCalledWith(expect.objectContaining({ label: 'help' }));
  });

  it('names chips that run by what they do, and marks them with a leading >', () => {
    render(CompletionRow, {
      props: { chips: [chip('help', { kind: 'starter', action: { kind: 'run', line: 'help' } }), chip('pwd', { kind: 'didyoumean', action: { kind: 'run', line: 'pwd' } })] },
    });
    const help = screen.getByRole('option', { name: 'Run: help' });
    expect(help.textContent).toBe('>help');
    expect(help.querySelector('.run')?.getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByRole('option', { name: 'Did you mean pwd?' })).toBeInTheDocument();
  });

  it('asks before a long list, and says what happened to screen readers', () => {
    const { container } = render(CompletionRow, { props: { question: 'Display all 150 possibilities? (y or n)', announce: 'No completions' } });
    expect(container.querySelector('.question')?.textContent).toBe('Display all 150 possibilities? (y or n)');
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe('No completions');
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
