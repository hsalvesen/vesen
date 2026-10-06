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
    // Text only: a label is never markup.
    expect(container.innerHTML).not.toContain('<img');
  });

  it('shows the full list with descriptions after Tab, and marks the menu choice', () => {
    render(CompletionRow, {
      props: { chips: [chip('--all', { summary: 'do not hide entries starting with .' }), chip('--almost-all', { selected: true })], listed: true },
    });
    screen.getByRole('listbox', { name: 'Completions' });
    const [first, second] = screen.getAllByRole('option');
    expect(first?.textContent).toBe('--alldo not hide entries starting with .');
    expect(first?.getAttribute('aria-selected')).toBe('false');
    expect(second?.getAttribute('aria-selected')).toBe('true');
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

  it('names chips that run by what they do', () => {
    render(CompletionRow, {
      props: { chips: [chip('help', { kind: 'starter', action: { kind: 'run', line: 'help' } }), chip('pwd', { kind: 'didyoumean', action: { kind: 'run', line: 'pwd' } })] },
    });
    expect(screen.getByRole('option', { name: 'Run help' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Did you mean pwd?' })).toBeInTheDocument();
  });

  it('asks before a long list, and says what happened to screen readers', () => {
    const { container } = render(CompletionRow, { props: { question: 'Display all 150 possibilities? (y or n)', announce: 'No completions' } });
    expect(container.querySelector('.question')?.textContent).toBe('Display all 150 possibilities? (y or n)');
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe('No completions');
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
