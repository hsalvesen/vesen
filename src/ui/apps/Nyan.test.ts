// The Nyan app (nyancat): all twelve frames drawn once, the one showing stepped on animation
// frames, twelve to two beats of the track from its first beat, and kept to where the track is;
// the track played at once on a keyboard, and where the browser holds it back the next key starts
// it; on a touch screen the cat stands still over 'Tap to nyan' until a tap starts it, sound and
// all, and the next tap leaves. The count at the foot says how long it has shown, unless -n left it
// out; -f closes it after that many frames. Esc, q, ^C and Back end it, handing back how long it
// showed; m mutes; the frames rest while the page is hidden.
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NYAN_ALT, NYAN_HINT_AFTER_MS, NYAN_KEYS_HINT, NYAN_START, NYAN_TAP_HINT, NYAN_TITLE, NYAN_TRACK, nyanView, type NyanView } from '../../commands/lib/nyancat';
import { NYAN_BEAT_S, NYAN_FPS } from '../../lib/nyancat';
import { TRACK_FADE_MS, type TrackElement } from '../../services/track';
import AppHost from '../AppHost.svelte';
import Nyan from './Nyan.svelte';

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

type AudioMode = 'plays' | 'blocked' | 'none';

/** Real <audio> elements whose play() plays, or is blocked until a gesture; or none at all. */
function fakeAudio(mode: AudioMode) {
  const state = { mode, time: 0 };
  const made: HTMLAudioElement[] = [];
  const play = vi.fn((): Promise<void> => (state.mode === 'blocked' ? Promise.reject(new DOMException('a gesture first', 'NotAllowedError')) : Promise.resolve()));
  const factory = vi.fn((): TrackElement | null => {
    if (state.mode === 'none') return null;
    const element = document.createElement('audio');
    Object.defineProperties(element, {
      play: { value: play },
      pause: { value: vi.fn() },
      load: { value: vi.fn() },
      currentTime: { get: () => state.time },
    });
    made.push(element);
    return element;
  });
  return {
    factory,
    play,
    made,
    setMode(next: AudioMode): void {
      state.mode = next;
    },
    /** Where the track is, in seconds. */
    at(seconds: number): void {
      state.time = seconds;
    },
  };
}

function setVisibility(state: 'hidden' | 'visible'): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

/** Lets play() and the DOM after it settle. */
async function settle(): Promise<void> {
  await tick();
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
  await tick();
}

function open(view: Partial<NyanView> = {}, audio = fakeAudio('plays')) {
  const close = vi.fn();
  render(Nyan, { props: { props: { ...nyanView(false), ...view }, close, audio: audio.factory } });
  const root = (): HTMLElement => document.querySelector('[data-nyan]') as HTMLElement;
  const shown = (): number => Array.from(document.querySelectorAll('.frame')).findIndex((frame) => frame.classList.contains('shown'));
  return { close, audio, root, shown };
}

/** ms into the show at which frame `n` (counted from the first beat) is on the screen. */
const atFrame = (n: number): number => (NYAN_BEAT_S + (n + 0.5) / NYAN_FPS) * 1000;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
});

describe('Nyan on a keyboard', () => {
  it('draws all twelve frames once, shows the first, and plays the track at once', async () => {
    frames();
    const { root, shown, audio } = open();
    await settle();
    expect(document.querySelectorAll('.frame')).toHaveLength(12);
    expect(document.querySelectorAll('.frame.shown')).toHaveLength(1);
    expect(shown()).toBe(0);
    expect(root()).toHaveAttribute('aria-label', NYAN_TITLE);
    expect(root().dataset.motion).toBe('running');
    expect(audio.factory).toHaveBeenCalledWith(NYAN_TRACK);
    expect(audio.play).toHaveBeenCalledTimes(1);
    expect(root().dataset.sound).toBe('on');
    expect(screen.getByText(NYAN_ALT)).toBeInTheDocument();
    // The frames are text, in ASCII: two characters a cell, 128 to a row.
    const first = document.querySelector('.frame')?.textContent?.split('\n') ?? [];
    expect(first).toHaveLength(64);
    for (const row of first) expect(row).toHaveLength(128);
    expect(document.querySelector('.frame')?.textContent).toMatch(/^[\x20-\x7e\n]+$/);
  });

  it('steps twelve frames to two beats, from the first beat, round and round', async () => {
    const raf = frames();
    const { shown } = open({}, fakeAudio('none'));
    await settle();
    let now = 0;
    raf.frame(now);
    /** Steps on to `ms`, 50 ms at a time, as a page that is drawing does. */
    const until = (ms: number): void => {
      while (now + 50 < ms) raf.frame((now += 50));
      raf.frame((now = ms));
    };
    for (const [ms, frame] of [
      [atFrame(1), 1],
      [atFrame(5), 5],
      [atFrame(11), 11],
      [atFrame(12), 0],
      [atFrame(15), 3],
    ] as const) {
      until(ms);
      await tick();
      expect(shown(), `${ms} ms`).toBe(frame);
    }
  });

  it('keeps the frames to where the track is', async () => {
    const raf = frames();
    const { shown, audio } = open();
    await settle();
    raf.frame(0);
    // Two seconds in the frames are set to where the track is. On their own clock they would show
    // frame 3 at 2.1 s; the track says frame 6.
    audio.at((atFrame(6) - 100) / 1000);
    for (let t = 50; t <= 2100; t += 50) raf.frame(t);
    await tick();
    expect(shown()).toBe(6);
  });

  it('counts how long it has shown at the foot, and says how to leave a few seconds in', async () => {
    vi.useFakeTimers();
    const raf = frames();
    open({}, fakeAudio('none'));
    await settle();
    expect(screen.getByText('You have nyaned for 0 seconds!')).toBeInTheDocument();
    raf.frame(0);
    for (let t = 50; t <= 2000; t += 50) raf.frame(t);
    await tick();
    expect(screen.getByText('You have nyaned for 2 seconds!')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('');
    vi.advanceTimersByTime(NYAN_HINT_AFTER_MS);
    await tick();
    expect(screen.getByRole('status')).toHaveTextContent(NYAN_KEYS_HINT);
  });

  it('leaves the count out when nyancat -n asked', async () => {
    frames();
    open({ counter: false }, fakeAudio('none'));
    await settle();
    expect(screen.queryByText(/You have nyaned/)).toBeNull();
  });

  it('closes itself after the frames nyancat -f asked for, handing back how long it showed', async () => {
    const raf = frames();
    const { close } = open({ frames: 28 }, fakeAudio('none'));
    await settle();
    raf.frame(0);
    for (let t = 50; t < 1950; t += 50) raf.frame(t);
    expect(close).not.toHaveBeenCalled();
    raf.frame(2000);
    expect(close).toHaveBeenCalledWith({ seconds: 2 });
  });

  it.each([
    ['q', {}],
    ['Escape', {}],
    ['c', { ctrlKey: true }],
  ])('ends on %s, stopping the sound, and hands back how long it showed', async (key, init) => {
    const raf = frames();
    const { close, audio } = open();
    await settle();
    expect(audio.made[0]?.isConnected).toBe(true);
    // Timeouts by hand, for the fade; the frames stay on the queue above.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    raf.frame(0);
    for (let t = 50; t <= 3000; t += 50) raf.frame(t);
    await fireEvent.keyDown(window, { key, ...init });
    expect(close).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledWith({ seconds: 3 });
    // The sound fades out, and its element is let go: out of the page.
    vi.advanceTimersByTime(TRACK_FADE_MS + 50);
    expect(audio.made[0]?.isConnected).toBe(false);
  });

  it('mutes and unmutes on m', async () => {
    frames();
    const { root } = open();
    await settle();
    await fireEvent.keyDown(window, { key: 'm' });
    expect(root().dataset.sound).toBe('muted');
    await fireEvent.keyDown(window, { key: 'm' });
    expect(root().dataset.sound).toBe('on');
  });

  it('starts sound the browser held back on the next key, from where the frames are', async () => {
    frames();
    const audio = fakeAudio('blocked');
    const { root, close } = open({}, audio);
    await settle();
    expect(root().dataset.sound).toBe('waiting');
    audio.setMode('plays');
    await fireEvent.keyDown(window, { key: ' ' });
    await settle();
    expect(audio.play).toHaveBeenCalledTimes(2);
    expect(root().dataset.sound).toBe('on');
    expect(close).not.toHaveBeenCalled();
  });

  it('goes on in silence where there is no audio element', async () => {
    frames();
    const { root } = open({}, fakeAudio('none'));
    await settle();
    expect(root().dataset.sound).toBe('off');
    expect(root().dataset.motion).toBe('running');
  });

  it('rests while the page is hidden, and goes on when it is back', async () => {
    const raf = frames();
    const { root } = open({}, fakeAudio('none'));
    await settle();
    setVisibility('hidden');
    await tick();
    expect(root().dataset.motion).toBe('paused');
    expect(raf.cancel).toHaveBeenCalled();
    setVisibility('visible');
    await tick();
    expect(root().dataset.motion).toBe('running');
  });
});

describe('Nyan on a touch screen', () => {
  it('stands still over Tap to nyan until a tap starts it, sound and all; the next tap leaves', async () => {
    const raf = frames();
    const { root, close, audio, shown } = open({ touch: true });
    await settle();
    expect(root().dataset.motion).toBe('waiting');
    expect(screen.getByText(NYAN_START)).toBeInTheDocument();
    expect(audio.factory).not.toHaveBeenCalled();
    expect(raf.request).not.toHaveBeenCalled();
    expect(shown()).toBe(0);
    // No hint for keys on a touch screen, and no count before it starts.
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByText(/You have nyaned/)).toBeNull();

    await fireEvent.click(root());
    await settle();
    expect(root().dataset.motion).toBe('running');
    expect(audio.play).toHaveBeenCalledTimes(1);
    expect(root().dataset.sound).toBe('on');
    expect(screen.queryByText(NYAN_START)).toBeNull();
    expect(screen.getByText(NYAN_TAP_HINT)).toBeInTheDocument();
    expect(screen.getByText('You have nyaned for 0 seconds!')).toBeInTheDocument();

    await fireEvent.click(root());
    expect(close).toHaveBeenCalledWith({ seconds: 0 });
  });
});

describe('Nyan in AppHost', () => {
  it('opens as the nyan view, and Back closes it with how long it showed', async () => {
    frames();
    const onclose = vi.fn();
    render(AppHost, { props: { request: { id: 21, view: 'nyan', props: { ...nyanView(false), track: '' } }, onclose } });
    await vi.waitFor(() => expect(screen.getByRole('dialog', { name: NYAN_TITLE })).toBeInTheDocument());
    try {
      history.back();
      expect(onclose).toHaveBeenCalledWith(21, { seconds: 0 });
    } finally {
      history.replaceState(null, '');
    }
  });
});
