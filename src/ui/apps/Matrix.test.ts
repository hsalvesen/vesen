// The Matrix app (cmatrix): it rains on animation frames until any key or a tap, rests while the
// page is hidden, and stands still under reduced motion without asking for a single frame.
import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MATRIX_GLYPHS, stepFor, stillRain } from '../../commands/lib/matrix';
import AppHost from '../AppHost.svelte';
import Matrix from './Matrix.svelte';

const VIEW = { glyphs: MATRIX_GLYPHS, stepMs: stepFor(4), touch: false };

function frames() {
  let waiting: FrameRequestCallback[] = [];
  const request = vi.fn((callback: FrameRequestCallback) => {
    waiting.push(callback);
    return waiting.length;
  });
  const cancel = vi.fn();
  vi.stubGlobal('requestAnimationFrame', request);
  vi.stubGlobal('cancelAnimationFrame', cancel);
  return {
    request,
    cancel,
    frame(ms: number): void {
      const now = waiting;
      waiting = [];
      for (const callback of now) callback(ms);
    },
  };
}

function setVisibility(state: 'hidden' | 'visible'): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

function show(view: unknown = VIEW) {
  const close = vi.fn();
  render(Matrix, { props: { props: view, close } });
  return { close, button: screen.getByRole('button', { name: /Characters rain down the screen/ }) };
}

afterEach(() => {
  vi.unstubAllGlobals();
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
});

describe('the Matrix app', () => {
  it('rains on animation frames until any key, then closes once', async () => {
    const raf = frames();
    const { close, button } = show();
    expect(button.dataset.motion).toBe('running');
    expect(raf.request).toHaveBeenCalledTimes(1);
    for (let ms = 0; ms < 500; ms += 16) raf.frame(ms);
    expect(raf.request.mock.calls.length).toBeGreaterThan(20);
    await fireEvent.keyDown(window, { key: 'Alt' });
    expect(close).not.toHaveBeenCalled();
    await fireEvent.keyDown(window, { key: 'Escape' });
    await fireEvent.keyDown(window, { key: 'q' });
    expect(close).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledWith('stopped');
    expect(raf.cancel).toHaveBeenCalled();
  });

  it('ends at a tap, and says so on a touch screen', async () => {
    frames();
    const { close, button } = show({ ...VIEW, touch: true });
    expect(button.textContent).toContain('tap to stop');
    await fireEvent.click(button);
    expect(close).toHaveBeenCalledWith('stopped');
  });

  it('rests while the page is hidden, and goes on when it is back', async () => {
    const raf = frames();
    const { button } = show();
    setVisibility('hidden');
    await tick();
    expect(button.dataset.motion).toBe('paused');
    expect(raf.cancel).toHaveBeenCalled();
    const asked = raf.request.mock.calls.length;
    setVisibility('visible');
    await tick();
    expect(button.dataset.motion).toBe('running');
    expect(raf.request.mock.calls.length).toBe(asked + 1);
  });

  it('stands still under reduced motion, until a key', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduced-motion') }));
    const raf = frames();
    const { close, button } = show();
    expect(button.dataset.motion).toBe('still');
    setVisibility('hidden');
    setVisibility('visible');
    await tick();
    expect(button.dataset.motion).toBe('still');
    expect(raf.request).not.toHaveBeenCalled();
    await fireEvent.keyDown(window, { key: 'a' });
    expect(close).toHaveBeenCalledWith('stopped');
  });

  it('opens through AppHost for cmatrix', async () => {
    frames();
    const onclose = vi.fn();
    render(AppHost, { props: { request: { id: 9, view: 'matrix', props: VIEW }, onclose } });
    await vi.waitFor(() => expect(screen.getByRole('button', { name: /rain/ })).toBeInTheDocument());
    await fireEvent.keyDown(window, { key: 'Enter' });
    expect(onclose).toHaveBeenCalledWith(9, 'stopped');
  });

  it('stops on Back, as a key stops it', async () => {
    const raf = frames();
    const onclose = vi.fn();
    render(AppHost, { props: { request: { id: 10, view: 'matrix', props: VIEW }, onclose } });
    await vi.waitFor(() => expect(screen.getByRole('button', { name: /rain/ })).toBeInTheDocument());
    try {
      history.back();
      expect(onclose).toHaveBeenCalledWith(10, 'stopped');
      expect(raf.cancel).toHaveBeenCalled();
    } finally {
      history.replaceState(null, '');
    }
  });
});

describe('the still rain', () => {
  it('fills the size asked for with streaks of the glyphs, and nothing else', () => {
    let seed = 7;
    const random = (): number => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
    const grid = stillRain(40, 12, random);
    expect(grid).toHaveLength(12);
    const glyphs = new Set(Array.from(MATRIX_GLYPHS));
    for (const row of grid) {
      expect(Array.from(row).length).toBeLessThanOrEqual(40);
      for (const ch of row) if (ch !== ' ') expect(glyphs.has(ch)).toBe(true);
    }
    expect(grid.join('').replace(/ /g, '').length).toBeGreaterThan(20);
  });
});
