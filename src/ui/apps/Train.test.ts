// The Train app (sl): it crosses once on animation frames, any key or a tap stops it, and under
// reduced motion it stands still for a moment and goes, never asking for a frame.
import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { trainView } from '../../commands/lib/train';
import AppHost from '../AppHost.svelte';
import Train from './Train.svelte';

/** requestAnimationFrame by hand: each call to `frame(ms)` runs what is waiting at time `ms`. */
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

function reducedMotion(): void {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduced-motion') }));
}

function show() {
  const close = vi.fn();
  render(Train, { props: { props: trainView(), close } });
  return { close, button: screen.getByRole('button', { name: /A steam train crosses the screen/ }) };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('the Train app', () => {
  it('crosses the screen once, moving left with its wheels turning, then closes', async () => {
    const raf = frames();
    const { close, button } = show();
    expect(button.dataset.motion).toBe('running');
    const train = button.querySelector('.train') as HTMLElement;
    raf.frame(0);
    await tick();
    const start = train.style.transform;
    const first = train.textContent;
    let ms = 0;
    for (let i = 0; i < 5; i += 1) raf.frame((ms += 50));
    await tick();
    expect(train.style.transform).not.toBe(start);
    expect(train.textContent).not.toBe(first);
    // happy-dom lays nothing out, so the screen counts as 80 columns: 80 + the train's width at 30 a second.
    for (let i = 0; i < 400 && close.mock.calls.length === 0; i += 1) raf.frame((ms += 50));
    expect(close).toHaveBeenCalledWith('crossed');
    expect(ms / 1000).toBeGreaterThan((80 + trainView().width) / 30 - 0.2);
  });

  it('stops at any key, but not a modifier on its own or a key held down', async () => {
    const raf = frames();
    const { close } = show();
    raf.frame(0);
    await fireEvent.keyDown(window, { key: 'Shift' });
    await fireEvent.keyDown(window, { key: 'Enter', repeat: true });
    expect(close).not.toHaveBeenCalled();
    await fireEvent.keyDown(window, { key: 'q' });
    expect(close).toHaveBeenCalledWith('stopped');
    expect(close).toHaveBeenCalledTimes(1);
    expect(raf.cancel).toHaveBeenCalled();
  });

  it('stops at a tap', async () => {
    frames();
    const { close, button } = show();
    await fireEvent.click(button);
    expect(close).toHaveBeenCalledWith('stopped');
  });

  it('stands still under reduced motion: one frame, no animation, then goes', async () => {
    vi.useFakeTimers();
    reducedMotion();
    const raf = frames();
    const { close, button } = show();
    expect(button.dataset.motion).toBe('still');
    const train = button.querySelector('.train') as HTMLElement;
    expect(train.textContent).toBe(trainView().frames[0]);
    expect(train.style.transform).toBe('');
    await vi.advanceTimersByTimeAsync(1900);
    expect(close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(close).toHaveBeenCalledWith('still');
    expect(raf.request).not.toHaveBeenCalled();
  });

  it('goes at once at a key under reduced motion too', async () => {
    reducedMotion();
    frames();
    const { close } = show();
    await fireEvent.keyDown(window, { key: ' ' });
    expect(close).toHaveBeenCalledWith('still');
  });

  it('opens through AppHost for sl', async () => {
    frames();
    const onclose = vi.fn();
    render(AppHost, { props: { request: { id: 5, view: 'sl', props: trainView() }, onclose } });
    await vi.waitFor(() => expect(screen.getByRole('button', { name: /steam train/ })).toBeInTheDocument());
    await fireEvent.keyDown(window, { key: 'x' });
    expect(onclose).toHaveBeenCalledWith(5, 'stopped');
  });
});
