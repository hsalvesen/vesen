import { fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import StatusLine from './StatusLine.svelte';
import { DEFAULT_LABEL, formatElapsed, SPINNER, STILL } from './status-line';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** The status line's text, its spaces collapsed. */
const words = (button: HTMLElement) => (button.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('the status line', () => {
  it('spins, says what is running, and how to stop it with the keys', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    const onstop = vi.fn();
    const view = render(StatusLine, { props: { label: 'sleeping 5', startedAt: Date.now(), onstop } });
    const button = view.getByRole('button', { name: 'Stop: sleeping 5' });
    expect(words(button)).toBe(`${SPINNER[0]} sleeping 5 (Ctrl+C or Esc to stop)`);
    expect(button.querySelector('.spinner')?.getAttribute('aria-hidden')).toBe('true');
    expect(view.container.querySelector('.stop-chip')).toBeNull();
  });

  it('shows the seconds once the command has run three', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    const view = render(StatusLine, { props: { label: 'fetching AAPL…', startedAt: Date.now(), onstop: () => {} } });
    const button = view.getByRole('button');
    await vi.advanceTimersByTimeAsync(2900);
    expect(button.querySelector('.elapsed')).toBeNull();
    expect(button.querySelector('.spinner')?.textContent).not.toBe(SPINNER[0]);
    await vi.advanceTimersByTimeAsync(200);
    expect(button.querySelector('.elapsed')?.textContent).toBe(' · 3s');
    await vi.advanceTimersByTimeAsync(62_000);
    expect(button.querySelector('.elapsed')?.textContent).toBe(' · 1m 05s');
  });

  it("says 'Processing…' for a command that says nothing about itself", () => {
    const view = render(StatusLine, { props: { label: null, onstop: () => {} } });
    expect(view.getByRole('button', { name: `Stop: ${DEFAULT_LABEL}` })).toBeTruthy();
  });

  it('is still under reduced motion: a … in place of the spinner', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduced-motion'), media: query }));
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    const view = render(StatusLine, { props: { label: 'sleeping 5', startedAt: Date.now(), onstop: () => {} } });
    const spinner = () => view.container.querySelector('.spinner')?.textContent;
    expect(spinner()).toBe(STILL);
    await vi.advanceTimersByTimeAsync(3000);
    expect(spinner()).toBe(STILL);
    expect(view.container.querySelector('.elapsed')?.textContent).toBe(' · 3s');
  });

  it('has a Stop chip on touch, and stops the command on a tap anywhere on it without taking focus', async () => {
    const onstop = vi.fn();
    const view = render(StatusLine, { props: { label: 'sleeping 5', touch: true, onstop } });
    const button = view.getByRole('button', { name: 'Stop: sleeping 5' });
    expect(view.container.querySelector('.stop-chip')?.textContent).toBe('■ Stop');
    expect(view.container.querySelector('.hint')).toBeNull();
    // A tap must not be cancelled at pointerdown: WebKit on iOS then never sends the click.
    expect(await fireEvent.pointerDown(button)).toBe(true);
    // Cancelling mousedown keeps focus, and the phone keyboard, on the prompt.
    expect(await fireEvent.mouseDown(button)).toBe(false);
    await fireEvent.click(button);
    expect(onstop).toHaveBeenCalledTimes(1);
  });

  it('writes minutes past the first one', () => {
    expect([0, 3, 59, 60, 65, 600].map(formatElapsed)).toEqual(['0s', '3s', '59s', '1m 00s', '1m 05s', '10m 00s']);
  });
});
