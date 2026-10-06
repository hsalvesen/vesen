import { fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import HistorySheet from './HistorySheet.svelte';
import { LONG_PRESS_MS } from './press';

afterEach(() => vi.useRealTimers());

const press = async (element: Element, hold = 0) => {
  await fireEvent.pointerDown(element, { pointerType: 'touch' });
  if (hold > 0) vi.advanceTimersByTime(hold);
  await fireEvent.pointerUp(element, { pointerType: 'touch' });
  await fireEvent.click(element, { detail: 1 });
};

describe('HistorySheet', () => {
  it('lists recent commands newest first, each once, in a modal dialog that takes focus', () => {
    render(HistorySheet, { props: { history: ['ls', 'help', 'ls', 'theme ls', ' '] } });
    const dialog = screen.getByRole('dialog', { name: 'History' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const lines = screen.getAllByRole('button', { name: /^Insert: / });
    expect(lines.map((line) => line.textContent)).toEqual(['theme ls', 'ls', 'help']);
    expect(document.activeElement).toBe(lines[0]);
  });

  it('puts a tapped line at the prompt, and runs a held one', async () => {
    vi.useFakeTimers();
    const oninsert = vi.fn();
    const onrun = vi.fn();
    render(HistorySheet, { props: { history: ['ls', 'help'], oninsert, onrun } });
    await press(screen.getByRole('button', { name: 'Insert: ls' }));
    expect(oninsert).toHaveBeenCalledWith('ls');
    await press(screen.getByRole('button', { name: 'Insert: help' }), LONG_PRESS_MS);
    expect(onrun).toHaveBeenCalledWith('help');
    expect(oninsert).toHaveBeenCalledTimes(1);
  });

  it('closes with Escape, the close button, a tap outside, or a swipe down', async () => {
    const onclose = vi.fn();
    const { container } = render(HistorySheet, { props: { history: ['ls'], onclose } });
    const dialog = screen.getByRole('dialog');
    expect(await fireEvent.keyDown(dialog, { key: 'Escape' })).toBe(false);
    await press(screen.getByRole('button', { name: 'Close history' }));
    await press(container.querySelector('.backdrop') as Element);
    expect(onclose).toHaveBeenCalledTimes(3);

    const grab = container.querySelector('.grab') as Element;
    await fireEvent.pointerDown(grab, { clientY: 100, pointerId: 1 });
    await fireEvent.pointerMove(grab, { clientY: 130, pointerId: 1 });
    await fireEvent.pointerUp(grab, { clientY: 130, pointerId: 1 });
    // Not far enough.
    expect(onclose).toHaveBeenCalledTimes(3);
    await fireEvent.pointerDown(grab, { clientY: 100, pointerId: 1 });
    await fireEvent.pointerMove(grab, { clientY: 200, pointerId: 1 });
    expect((dialog as HTMLElement).style.transform).toBe('translateY(100px)');
    await fireEvent.pointerUp(grab, { clientY: 200, pointerId: 1 });
    expect(onclose).toHaveBeenCalledTimes(4);
  });

  it('keeps focus inside: Tab from the last goes to the first, Shift+Tab the other way', async () => {
    render(HistorySheet, { props: { history: ['a', 'b'] } });
    const dialog = screen.getByRole('dialog');
    const close = screen.getByRole('button', { name: 'Close history' });
    const last = screen.getByRole('button', { name: 'Insert: a' });
    last.focus();
    await fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(close);
    await fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('says so when there is nothing yet', () => {
    render(HistorySheet, { props: { history: [] } });
    expect(screen.getByText('No commands yet.')).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close history' }));
  });
});
