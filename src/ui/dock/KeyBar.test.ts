import { fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import KeyBar from './KeyBar.svelte';
import { CLOSED_KEYS, COMPACT_KEYS, FULL_KEYS, SYMBOL_KEYS, runKey, type KeyTarget } from './keys';
import { LONG_PRESS_MS, REPEAT_DELAY_MS, REPEAT_EVERY_MS } from './press';

function target(): KeyTarget & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    pressKey: (key) => calls.push(`key:${key}`),
    interrupt: () => calls.push('interrupt'),
    clearScreen: () => calls.push('clear'),
    insertText: (text) => calls.push(`insert:${text}`),
    blur: () => calls.push('blur'),
    focus: (options) => calls.push(`focus:${options?.keyboard === true ? 'keyboard' : ''}`),
  };
}

const labels = () => screen.getAllByRole('button').map((key) => key.textContent);
const tap = async (name: string) => {
  const key = screen.getByRole('button', { name });
  await fireEvent.pointerDown(key, { pointerType: 'touch' });
  await fireEvent.pointerUp(key, { pointerType: 'touch' });
  await fireEvent.click(key, { detail: 1 });
};

afterEach(() => vi.useRealTimers());

describe('the keys', () => {
  it('are unique, and each does what it says through the controller', () => {
    const all = [...FULL_KEYS, ...COMPACT_KEYS, ...SYMBOL_KEYS, ...CLOSED_KEYS];
    for (const set of [FULL_KEYS, SYMBOL_KEYS, CLOSED_KEYS]) expect(new Set(set.map((k) => k.id)).size).toBe(set.length);
    const t = target();
    for (const key of all) runKey(key.action, t);
    expect(t.calls).toContain('key:Tab');
    expect(t.calls).toContain('key:ArrowUp');
    expect(t.calls).toContain('key:ArrowDown');
    expect(t.calls).toContain('key:Escape');
    expect(t.calls).toContain('interrupt');
    expect(t.calls).toContain('blur');
    expect(t.calls).toContain('focus:keyboard');
    expect(t.calls).toContain('insert:|');
  });
});

describe('KeyBar', () => {
  it('is a toolbar of tab ↑ ↓ ^C clear ••• ⌄, each driving the controller as the hardware key does', async () => {
    const t = target();
    render(KeyBar, { props: { target: t } });
    expect(screen.getByRole('toolbar', { name: 'Terminal keys' })).toBeInTheDocument();
    expect(labels()).toEqual(['tab', '↑', '↓', '^C', 'clear', '•••', '⌄']);
    for (const name of ['Tab: complete', 'Previous command (hold for history)', 'Next command', 'Control C: cancel', 'Clear the screen', 'Hide the keyboard']) {
      await tap(name);
    }
    expect(t.calls).toEqual(['key:Tab', 'key:ArrowUp', 'key:ArrowDown', 'interrupt', 'clear', 'blur']);
  });

  it('never takes focus from the prompt', async () => {
    render(KeyBar, { props: { target: target() } });
    const input = document.body.appendChild(document.createElement('input'));
    input.focus();
    const tab = screen.getByRole('button', { name: 'Tab: complete' });
    expect(await fireEvent.mouseDown(tab)).toBe(false);
    expect(await fireEvent.pointerDown(tab, { pointerType: 'mouse' })).toBe(false);
    expect(document.activeElement).toBe(input);
    input.remove();
  });

  it('turns ••• into a page of symbols, which type at the cursor, and back', async () => {
    const t = target();
    render(KeyBar, { props: { target: t } });
    await tap('Symbols');
    expect(screen.getByRole('toolbar', { name: 'Symbols' })).toBeInTheDocument();
    expect(labels()).toEqual(['esc', '|', '>', '/', '-', '~', '*', '"', '$', '←', '→', '•••']);
    expect(screen.getByRole('button', { name: 'Symbols' }).getAttribute('aria-pressed')).toBe('true');
    await tap('Pipe');
    await tap('Escape');
    await tap('Cursor left');
    expect(t.calls).toEqual(['insert:|', 'key:Escape', 'key:ArrowLeft']);
    await tap('Symbols');
    expect(labels()).toEqual(['tab', '↑', '↓', '^C', 'clear', '•••', '⌄']);
  });

  it('repeats ← and → while held', async () => {
    vi.useFakeTimers();
    const t = target();
    render(KeyBar, { props: { target: t } });
    await tap('Symbols');
    const right = screen.getByRole('button', { name: 'Cursor right' });
    await fireEvent.pointerDown(right, { pointerType: 'touch' });
    vi.advanceTimersByTime(REPEAT_DELAY_MS + REPEAT_EVERY_MS * 4);
    await fireEvent.pointerUp(right, { pointerType: 'touch' });
    await fireEvent.click(right, { detail: 1 });
    expect(t.calls).toEqual(Array.from({ length: 5 }, () => 'key:ArrowRight'));
  });

  it('opens the history sheet when ↑ is held, without stepping history', async () => {
    vi.useFakeTimers();
    const t = target();
    const onhistory = vi.fn();
    render(KeyBar, { props: { target: t, onhistory } });
    const up = screen.getByRole('button', { name: 'Previous command (hold for history)' });
    await fireEvent.pointerDown(up, { pointerType: 'touch' });
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(onhistory).toHaveBeenCalledTimes(1);
    await fireEvent.pointerUp(up, { pointerType: 'touch' });
    await fireEvent.click(up, { detail: 1 });
    expect(t.calls).toEqual([]);
  });

  it('outlines ^C while a command runs; the compact bar has tab ↑ ^C; the closed bar brings the keyboard back', async () => {
    const t = target();
    const { rerender } = render(KeyBar, { props: { target: t, busy: true } });
    expect(screen.getByRole('button', { name: 'Control C: cancel' }).classList.contains('emphasis')).toBe(true);
    rerender({ variant: 'compact' });
    expect(labels()).toEqual(['tab', '↑', '^C']);
    rerender({ variant: 'closed', busy: false });
    expect(labels()).toEqual(['⌨ Type a command…', '↑', 'clear']);
    await tap('Type a command');
    expect(t.calls).toEqual(['focus:keyboard']);
  });
});
