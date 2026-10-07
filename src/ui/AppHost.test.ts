// The alternate screen and the Shutdown app (F029): systemd's lines, a fade (at once under reduced
// motion), '● vesen is off' with Power on, and the in-app hint; never window.close.
import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { POWER_ON, type ShutdownView } from '../shell/shutdown';
import AppHost from './AppHost.svelte';

const view = (extra: Partial<ShutdownView> = {}): ShutdownView => ({
  kind: 'poweroff',
  lines: ['[  OK  ] Stopped target Network.', '[  OK  ] Reached target System Power Off.', 'reboot: Power down'],
  inApp: false,
  touch: false,
  ...extra,
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function settle(ms = 5000): Promise<void> {
  await vi.dynamicImportSettled();
  for (let elapsed = 0; elapsed < ms; elapsed += 100) {
    await vi.advanceTimersByTimeAsync(100);
    await tick();
  }
}

describe('AppHost and the Shutdown app', () => {
  it("shows systemd's lines, fades, then offers Power on, which closes with the result", async () => {
    vi.useFakeTimers();
    const close = vi.spyOn(window, 'close');
    const onclose = vi.fn();
    render(AppHost, { props: { request: { id: 7, view: 'shutdown', props: view() }, onclose } });
    expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBe('true');
    await vi.dynamicImportSettled();
    await vi.advanceTimersByTimeAsync(130);
    await tick();
    expect(screen.getByRole('log').textContent).toContain('Stopped target Network.');
    await settle();
    expect(screen.getByRole('status').textContent).toContain('vesen is off');
    expect(screen.getByText('or press any key')).toBeInTheDocument();
    expect(screen.queryByText('Close this page with ✕')).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: /Power on/ }));
    expect(onclose).toHaveBeenCalledWith(7, POWER_ON);
    expect(close).not.toHaveBeenCalled();
  });

  it('powers on at any key on a desktop', async () => {
    vi.useFakeTimers();
    const onclose = vi.fn();
    render(AppHost, { props: { request: { id: 1, view: 'shutdown', props: view() }, onclose } });
    await settle();
    // A modifier alone is not a key press.
    await fireEvent.keyDown(window, { key: 'Shift' });
    expect(onclose).not.toHaveBeenCalled();
    await fireEvent.keyDown(window, { key: 'a' });
    expect(onclose).toHaveBeenCalledWith(1, POWER_ON);
  });

  it('says how to close the page inside an in-app browser, where Power on is a tap', async () => {
    vi.useFakeTimers();
    const onclose = vi.fn();
    render(AppHost, { props: { request: { id: 4, view: 'shutdown', props: view({ inApp: true, touch: true }) }, onclose } });
    await settle();
    expect(screen.getByText('Close this page with ✕')).toBeInTheDocument();
    expect(screen.queryByText('or press any key')).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: /Power on/ }));
    expect(onclose).toHaveBeenCalledTimes(1);
  });

  it('comes straight back from a reboot, and skips the motion when asked to', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduced-motion') }));
    const onclose = vi.fn();
    render(AppHost, { props: { request: { id: 2, view: 'shutdown', props: view({ kind: 'reboot' }) }, onclose } });
    await vi.dynamicImportSettled();
    await tick();
    // Under reduced motion every line is there at once.
    expect(screen.getByRole('log').textContent).toContain('reboot: Power down');
    await settle(200);
    expect(onclose).toHaveBeenCalledWith(2, POWER_ON);
  });

  it('lets the command go on when there is no such app', async () => {
    const onclose = vi.fn();
    render(AppHost, { props: { request: { id: 3, view: 'pager', props: {} }, onclose } });
    await vi.waitFor(() => expect(screen.getByText(/could not load/)).toBeInTheDocument());
    await fireEvent.click(screen.getByRole('button', { name: 'Back to the terminal' }));
    expect(onclose).toHaveBeenCalledWith(3, undefined);
  });
});
