// Present mode (docs/plan/06-qr.md, "Present mode and actions"): a labelled modal dialog with the
// code as a black-on-white PNG, closed by ✕, Esc, q, Enter, a tap outside the code and Back (the
// history entry AppHost or the card holds for it); focus stays inside; the screen stays awake;
// Save is hidden in in-app browsers, which say how to save instead.
import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { qrView } from '../../testing/qr-view';
import AppHost from '../AppHost.svelte';
import QrPresenter from './QrPresenter.svelte';

const view = qrView('vesen.app');

let back: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // Back is the test's to give; happy-dom would otherwise try to navigate.
  back = vi.spyOn(history, 'back').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  history.replaceState(null, '');
});

function present(props: unknown = view) {
  const close = vi.fn();
  const result = render(QrPresenter, { props: { props, close } });
  return { ...result, close };
}

describe('QrPresenter', () => {
  it('is a labelled modal dialog with the code as a PNG, the payload and the meta line', () => {
    present();
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.getElementById(dialog.getAttribute('aria-labelledby') ?? '')?.textContent).toBe('QR code for https://vesen.app');
    const image = screen.getByRole('img', { name: 'QR code for https://vesen.app' });
    expect(image.getAttribute('src')?.startsWith('data:image/png;base64,iVBORw0KGgo')).toBe(true);
    expect(screen.getByText('https://vesen.app')).toBeInTheDocument();
    const meta = dialog.querySelector('.meta');
    expect(meta?.textContent).toBe(`v2 · 25×25 · EC Q · 17/22 B · mask ${view.mask}`);
    // Each label stays with its value: the line wraps only between the parts.
    expect(Array.from(meta?.querySelectorAll('.together') ?? []).map((part) => part.textContent)).toEqual([
      'v2',
      '25×25',
      'EC Q',
      '17/22 B',
      `mask ${view.mask}`,
    ]);
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['✕', 'Save image', 'Copy link']);
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('takes a card\'s request too, and inside an in-app browser says how to save instead of offering Save', () => {
    present({ view: qrView('hello'), env: { inApp: true, canShareFiles: true } });
    expect(screen.getByText('Press and hold the code to save it, or take a screenshot')).toBeInTheDocument();
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['✕', 'Share', 'Copy text']);
  });

  it('leaves the history to whatever shows it, and closes once on Back', async () => {
    const push = vi.spyOn(history, 'pushState');
    const { close, component } = present();
    expect(push).not.toHaveBeenCalled();
    // AppHost, or the card, calls back() when Back leaves the entry it holds.
    component.back();
    component.back();
    expect(close).toHaveBeenCalledTimes(1);
    expect(back).not.toHaveBeenCalled();
  });

  it.each(['Escape', 'q', 'Enter'])('closes on %s', async (key) => {
    const { close } = present();
    await fireEvent.keyDown(screen.getByRole('dialog'), { key });
    expect(close).toHaveBeenCalledTimes(1);
    expect(back).not.toHaveBeenCalled();
  });

  it('lets Enter press a button rather than close', async () => {
    const { close } = present();
    await fireEvent.keyDown(screen.getByRole('button', { name: 'Copy link' }), { key: 'Enter' });
    expect(close).not.toHaveBeenCalled();
  });

  it('closes on ✕ and on a tap outside the code, but not on a tap on it', async () => {
    const first = present();
    await fireEvent.click(screen.getByRole('img'));
    expect(first.close).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByRole('dialog'));
    expect(first.close).toHaveBeenCalledTimes(1);
    first.unmount();
    const second = present();
    await fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(second.close).toHaveBeenCalledTimes(1);
  });

  it('starts with focus on ✕ and keeps Tab inside', async () => {
    vi.useFakeTimers();
    present();
    await vi.advanceTimersByTimeAsync(1);
    const buttons = screen.getAllByRole('button');
    expect(document.activeElement).toBe(buttons[0]);
    buttons[buttons.length - 1]!.focus();
    await fireEvent.keyDown(buttons[buttons.length - 1]!, { key: 'Tab' });
    expect(document.activeElement).toBe(buttons[0]);
    await fireEvent.keyDown(buttons[0]!, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(buttons[buttons.length - 1]);
  });

  it('keeps the screen awake while it shows', async () => {
    const release = vi.fn(async () => {});
    const sentinel = Object.assign(new EventTarget(), { release });
    const request = vi.fn(async () => sentinel);
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } });
    try {
      const { unmount } = present();
      await vi.waitFor(() => expect(request).toHaveBeenCalledWith('screen'));
      await tick();
      unmount();
      expect(release).toHaveBeenCalledTimes(1);
    } finally {
      delete (navigator as { wakeLock?: unknown }).wakeLock;
    }
  });

  it('copies, and says so politely for four seconds', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    try {
      present();
      await fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
      await vi.advanceTimersByTimeAsync(0);
      expect(writeText).toHaveBeenCalledWith('https://vesen.app');
      const status = screen.getByRole('status');
      expect(status.getAttribute('aria-live')).toBe('polite');
      expect(status.textContent).toBe('Copied.');
      await vi.advanceTimersByTimeAsync(4000);
      expect(status.textContent).toBe('');
    } finally {
      delete (navigator as { clipboard?: unknown }).clipboard;
    }
  });

  it('is what qr -f shows through AppHost', async () => {
    const onclose = vi.fn();
    render(AppHost, { props: { request: { id: 3, view: 'qr-present', props: view }, onclose } });
    await vi.dynamicImportSettled();
    await tick();
    expect(await screen.findByRole('img', { name: 'QR code for https://vesen.app' })).toBeInTheDocument();
    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(onclose).toHaveBeenCalledWith(3, undefined);
    // It closed itself, so AppHost took its history entry off.
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('closes on Back through AppHost, which holds its history entry', async () => {
    const push = vi.spyOn(history, 'pushState');
    const onclose = vi.fn();
    render(AppHost, { props: { request: { id: 4, view: 'qr-present', props: view }, onclose } });
    await vi.dynamicImportSettled();
    await tick();
    await screen.findByRole('img', { name: 'QR code for https://vesen.app' });
    expect(push).toHaveBeenCalledTimes(1);
    // Back: the entry before AppHost's is current again.
    history.replaceState(null, '');
    window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
    expect(onclose).toHaveBeenCalledWith(4, undefined);
    expect(back).not.toHaveBeenCalled();
  });

  it('says so when it has no code to show', () => {
    present({ nonsense: true });
    expect(screen.getByText('This code could not be shown.')).toBeInTheDocument();
  });
});
