import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App.svelte';
import { history } from './stores/history';

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
  await tick();
}

afterEach(() => {
  vi.unstubAllGlobals();
  // The transcript is a module store, so each test starts from an empty screen.
  history.set([]);
});

describe('App', () => {
  it('has one hidden heading, a labelled input and a polite log that is busy while a command runs', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
    const { container } = render(App);

    const headings = container.querySelectorAll('h1');
    expect(headings).toHaveLength(1);
    expect(headings[0]?.textContent).toBe('Vesen terminal');
    expect(headings[0]?.classList.contains('sr-only')).toBe(true);

    const prompt = screen.getByRole('textbox', { name: 'Terminal command' });
    expect(prompt.getAttribute('enterkeyhint')).toBe('go');

    const log = screen.getByRole('log');
    expect(log.getAttribute('aria-live')).toBe('polite');
    expect(log.getAttribute('aria-relevant')).toBe('additions');
    expect(log.getAttribute('aria-busy')).toBe('false');
    expect(log.textContent).toContain('to see all available commands.');

    await fireEvent.input(prompt, { target: { value: 'stock AAPL' } });
    await fireEvent.keyDown(prompt, { key: 'Enter' });
    await settle();
    expect(log.getAttribute('aria-busy')).toBe('true');

    await fireEvent.click(screen.getByRole('button', { name: 'Cancel running command' }));
    await settle();
    expect(log.getAttribute('aria-busy')).toBe('false');
    vi.useRealTimers();
  });


  it('cancels a running command when the processing line is tapped', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
    render(App);
    const prompt = screen.getByRole('textbox');

    await fireEvent.input(prompt, { target: { value: 'stock AAPL' } });
    await fireEvent.keyDown(prompt, { key: 'Enter' });
    await settle();
    // The spinner draws its first frame straight away.
    const cancel = screen.getByRole('button', { name: 'Cancel running command' });
    expect(cancel).toHaveTextContent(/Processing… \((tap|Ctrl\+C) to cancel\)/);

    // A tap must not be cancelled at pointerdown: WebKit on iOS then never sends the click.
    expect(await fireEvent.pointerDown(cancel)).toBe(true);
    // Cancelling mousedown keeps focus, and the phone keyboard, on the prompt.
    expect(await fireEvent.mouseDown(cancel)).toBe(false);

    await fireEvent.click(cancel);
    await settle();

    expect(screen.queryByRole('button', { name: 'Cancel running command' })).not.toBeInTheDocument();
    expect(screen.getByText('Stock request cancelled')).toBeInTheDocument();
    vi.useRealTimers();
  });
});
