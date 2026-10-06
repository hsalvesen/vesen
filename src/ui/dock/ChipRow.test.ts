import { fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Chip, CompletionResult } from '../../shell/complete/types';
import ChipRow from './ChipRow.svelte';
import { LONG_PRESS_MS } from './press';

const result = { state: { text: 'theme set w', cursor: 11 } } as CompletionResult;
const apply = (label: string, extra: Partial<Chip> = {}): Chip => ({
  id: `value:${label}`,
  label,
  matchLen: 1,
  kind: 'value',
  action: { kind: 'apply', result, candidate: { value: label, label, kind: 'value', terminal: true } },
  ...extra,
});
const run = (line: string, kind: Chip['kind'] = 'starter'): Chip => ({ id: `${kind}:${line}`, label: line, matchLen: 0, kind, action: { kind: 'run', line }, line });

afterEach(() => vi.useRealTimers());

describe('ChipRow', () => {
  it('is a listbox of chips labelled with their word and named by what a tap does', () => {
    const wombat = apply('wombat', { swatch: '#1c1814', line: 'theme set wombat', action: { ...apply('w').action, run: true } as Chip['action'] });
    render(ChipRow, { props: { chips: [run('theme', 'current'), wombat, apply('documents/', { kind: 'dir' }), run('help')], more: 2 } });
    const list = screen.getByRole('listbox', { name: 'Suggestions' });
    expect(list.id).toBe('completion-list');
    const options = screen.getAllByRole('option');
    expect(options.map((o) => o.getAttribute('aria-label'))).toEqual(['Run: theme', 'Run: theme set wombat', 'Insert: documents/', 'Run: help']);
    expect(options.map((o) => o.textContent)).toEqual(['⏎theme', 'wombat⏎', 'documents/', 'help⏎']);
    expect(options[1]?.querySelector('b')?.textContent).toBe('w');
    expect(options.every((o) => o.getAttribute('tabindex') === '-1')).toBe(true);
    expect(list.textContent).toContain('+2');
  });

  it('shows one large cancel chip while a command runs, and Cancel at a password', () => {
    const stop: Chip = { id: 'control:stop', label: 'cancel ^C', matchLen: 0, kind: 'control', action: { kind: 'interrupt' } };
    const { rerender } = render(ChipRow, { props: { chips: [stop] } });
    const option = screen.getByRole('option', { name: 'Cancel the running command (Control C)' });
    expect(option.classList.contains('emphasis')).toBe(true);
    expect(option.textContent).toBe('✕cancel ^C');
    rerender({ chips: [{ id: 'control:cancel', label: 'Cancel', matchLen: 0, kind: 'control', action: { kind: 'cancel' } }] });
    expect(screen.getByRole('option', { name: 'Cancel the password prompt' })).toBeInTheDocument();
  });

  it('never takes focus from the prompt, and a tap chooses the chip', async () => {
    const onchoose = vi.fn();
    render(ChipRow, { props: { chips: [run('help')], onchoose } });
    const input = document.body.appendChild(document.createElement('input'));
    input.focus();
    const option = screen.getByRole('option');
    expect(await fireEvent.mouseDown(option)).toBe(false);
    expect(await fireEvent.pointerDown(option, { pointerType: 'mouse' })).toBe(false);
    await fireEvent.pointerDown(option, { pointerType: 'touch' });
    await fireEvent.pointerUp(option, { pointerType: 'touch' });
    await fireEvent.click(option, { detail: 1 });
    expect(document.activeElement).toBe(input);
    expect(onchoose).toHaveBeenCalledWith(expect.objectContaining({ label: 'help' }));
    expect(onchoose.mock.calls[0]?.[1]).toBeUndefined();
    input.remove();
  });

  it('puts a chip that runs at the prompt instead on a long press; one that edits has none', async () => {
    vi.useFakeTimers();
    const onchoose = vi.fn();
    render(ChipRow, { props: { chips: [run('cat README.md'), apply('wombat')], onchoose } });
    const [runs, edits] = screen.getAllByRole('option');
    if (runs === undefined || edits === undefined) throw new Error('no chips');
    await fireEvent.pointerDown(runs, { pointerType: 'touch' });
    vi.advanceTimersByTime(LONG_PRESS_MS);
    await fireEvent.pointerUp(runs, { pointerType: 'touch' });
    await fireEvent.click(runs, { detail: 1 });
    expect(onchoose).toHaveBeenCalledTimes(1);
    expect(onchoose).toHaveBeenCalledWith(expect.objectContaining({ label: 'cat README.md' }), { insert: true });

    await fireEvent.pointerDown(edits, { pointerType: 'touch' });
    vi.advanceTimersByTime(LONG_PRESS_MS);
    await fireEvent.pointerUp(edits, { pointerType: 'touch' });
    await fireEvent.click(edits, { detail: 1 });
    expect(onchoose).toHaveBeenCalledTimes(2);
    expect(onchoose.mock.calls[1]?.[1]).toBeUndefined();
  });

  it('draws no listbox when there is nothing to offer', () => {
    render(ChipRow, { props: { chips: [] } });
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
