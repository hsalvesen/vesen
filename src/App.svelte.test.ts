import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App.svelte';

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
  await tick();
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('App', () => {
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

    await fireEvent.click(cancel);
    await settle();

    expect(screen.queryByRole('button', { name: 'Cancel running command' })).not.toBeInTheDocument();
    expect(screen.getByText('Stock request cancelled')).toBeInTheDocument();
    vi.useRealTimers();
  });
});
