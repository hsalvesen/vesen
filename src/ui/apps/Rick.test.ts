// The Rick app (sudo): the dancer steps on animation frames at the song's pace and rests while
// the page is hidden; Esc, q, ^C, Back and the Close button end it with the same result, stopping
// the music; m and the Mute button mute; under reduced motion one frame stands still while the
// tune plays; and where the browser keeps the sound back until a gesture, the status line says
// so and the first key or tap starts it.
import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RICK_ALT, RICK_CLOSED, RICK_FPS, RICK_TITLE, rickFrames, rickView } from '../../commands/lib/rick';
import type { Song } from '../../lib/chiptune';
import type { Chiptune, ChiptuneOptions } from '../../services/chiptune';
import AppHost from '../AppHost.svelte';
import Rick from './Rick.svelte';

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

/** A synth that records what the app asks of it; `starts` says what play() resolves with. */
function fakeSynth(starts = true) {
  const state = { playing: false, muted: false, available: true };
  let options: ChiptuneOptions = {};
  const synth = {
    play: vi.fn(() => {
      if (starts) state.playing = true;
      options.onChange?.();
      return Promise.resolve(starts);
    }),
    stop: vi.fn(() => {
      state.playing = false;
    }),
    mute: vi.fn(() => {
      state.muted = true;
      options.onChange?.();
    }),
    unmute: vi.fn(() => {
      state.muted = false;
      options.onChange?.();
    }),
    get playing() {
      return state.playing;
    },
    get muted() {
      return state.muted;
    },
    get available() {
      return state.available;
    },
  } satisfies Chiptune;
  const songs: Song[] = [];
  const make = (song: Song, given: ChiptuneOptions): Chiptune => {
    songs.push(song);
    options = given;
    return synth;
  };
  return { synth, make, songs, state };
}

function reducedMotion(): void {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduced-motion') }));
}

function setVisibility(state: 'hidden' | 'visible'): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

async function show(options: { touch?: boolean; starts?: boolean } = {}) {
  const close = vi.fn();
  const fake = fakeSynth(options.starts ?? true);
  render(Rick, { props: { props: rickView(options.touch ?? false), close, synth: fake.make } });
  await tick();
  await Promise.resolve();
  await tick();
  return { close, fake, dialog: screen.getByRole('dialog', { name: RICK_TITLE }) };
}

const drawn = (dialog: HTMLElement): string => (dialog.querySelector('.frame') as HTMLElement).textContent ?? '';
const status = (dialog: HTMLElement): string => (dialog.querySelector('.status') as HTMLElement).textContent ?? '';

afterEach(() => {
  vi.unstubAllGlobals();
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
});

describe('the Rick app', () => {
  it('shows the title, the first frame in colour with a text alternative, and the status line with the track and the keys', async () => {
    frames();
    const { dialog, fake } = await show();
    expect(dialog.querySelector('.title')?.textContent).toBe('You have been rickrolled');
    const frame = dialog.querySelector('.frame') as HTMLElement;
    expect(frame.getAttribute('aria-hidden')).toBe('true');
    expect(drawn(dialog)).toBe(rickFrames()[0]?.text);
    expect(frame.querySelectorAll('span[style*="--role-accent"]').length).toBeGreaterThan(0);
    expect(frame.querySelectorAll('span[style*="--role-muted"]').length).toBeGreaterThan(0);
    expect(dialog.querySelector('.sr-only')?.textContent).toBe(RICK_ALT);
    expect(status(dialog)).toBe("Never Logging Out, vesen's own 8-bit number · Esc, ^C or q to leave · m to mute");
    expect(fake.songs[0]?.title).toBe('Never Logging Out');
    expect(fake.synth.play).toHaveBeenCalledTimes(1);
    expect(dialog.dataset.motion).toBe('running');
    expect(dialog.dataset.sound).toBe('on');
    expect(dialog.querySelector('.toolbar')).toBeNull();
  });

  it('steps through the frames at the song\'s pace on animation frames, and rests while the page is hidden', async () => {
    const raf = frames();
    const { dialog } = await show();
    raf.frame(0);
    await tick();
    const first = drawn(dialog);
    const stepMs = 1000 / RICK_FPS;
    raf.frame(stepMs * 0.5);
    await tick();
    expect(drawn(dialog)).toBe(first);
    raf.frame(stepMs * 1.1);
    await tick();
    expect(drawn(dialog)).toBe(rickFrames()[1]?.text);
    for (let i = 2; i <= rickFrames().length; i += 1) raf.frame(stepMs * (i + 0.1));
    await tick();
    // Round the loop, back to the first frame.
    expect(drawn(dialog)).toBe(first);

    setVisibility('hidden');
    await tick();
    expect(dialog.dataset.motion).toBe('paused');
    expect(raf.cancel).toHaveBeenCalled();
    const asked = raf.request.mock.calls.length;
    setVisibility('visible');
    await tick();
    expect(dialog.dataset.motion).toBe('running');
    expect(raf.request.mock.calls.length).toBe(asked + 1);
  });

  for (const [name, key] of [
    ['Esc', { key: 'Escape' }],
    ['q', { key: 'q' }],
    ['Ctrl+C', { key: 'c', ctrlKey: true }],
  ] as const) {
    it(`closes at ${name}, stopping the music, and only once`, async () => {
      const raf = frames();
      const { close, fake } = await show();
      await fireEvent.keyDown(window, { key: 'Shift' });
      await fireEvent.keyDown(window, { key: 'Escape', repeat: true });
      expect(close).not.toHaveBeenCalled();
      await fireEvent.keyDown(window, key);
      expect(close).toHaveBeenCalledWith(RICK_CLOSED);
      expect(fake.synth.stop).toHaveBeenCalledTimes(1);
      expect(raf.cancel).toHaveBeenCalled();
      await fireEvent.keyDown(window, { key: 'Escape' });
      expect(close).toHaveBeenCalledTimes(1);
    });
  }

  it('leaves other keys alone: a letter neither closes it nor is lost', async () => {
    frames();
    const { close } = await show();
    await fireEvent.keyDown(window, { key: 'x' });
    await fireEvent.keyDown(window, { key: 'Enter' });
    expect(close).not.toHaveBeenCalled();
  });

  it('mutes and unmutes with m, saying so in the status line', async () => {
    frames();
    const { dialog, fake } = await show();
    await fireEvent.keyDown(window, { key: 'm' });
    expect(fake.synth.mute).toHaveBeenCalledTimes(1);
    expect(dialog.dataset.sound).toBe('muted');
    expect(status(dialog)).toContain('(muted)');
    expect(status(dialog)).toContain('m to unmute');
    await fireEvent.keyDown(window, { key: 'M' });
    expect(fake.synth.unmute).toHaveBeenCalledTimes(1);
    expect(dialog.dataset.sound).toBe('on');
    expect(status(dialog)).toContain('m to mute');
  });

  it('on a touch screen has a Close and a Mute button of 44 px, and no key hint', async () => {
    frames();
    const { dialog, close, fake } = await show({ touch: true });
    expect(status(dialog)).toBe("Never Logging Out, vesen's own 8-bit number");
    const mute = screen.getByRole('button', { name: 'Mute' });
    expect(mute.classList.contains('tool')).toBe(true);
    await fireEvent.click(mute);
    expect(fake.synth.mute).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Unmute' })).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Unmute' }));
    expect(fake.synth.unmute).toHaveBeenCalledTimes(1);
    await fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(close).toHaveBeenCalledWith(RICK_CLOSED);
    expect(fake.synth.stop).toHaveBeenCalledTimes(1);
  });

  it('stands still under reduced motion while the music plays, and leaves the same way', async () => {
    reducedMotion();
    const raf = frames();
    const { dialog, close, fake } = await show();
    expect(dialog.dataset.motion).toBe('still');
    expect(drawn(dialog)).toBe(rickFrames()[0]?.text);
    expect(raf.request).not.toHaveBeenCalled();
    expect(fake.synth.play).toHaveBeenCalledTimes(1);
    setVisibility('hidden');
    setVisibility('visible');
    await tick();
    expect(dialog.dataset.motion).toBe('still');
    await fireEvent.keyDown(window, { key: 'q' });
    expect(close).toHaveBeenCalledWith(RICK_CLOSED);
    expect(fake.synth.stop).toHaveBeenCalled();
  });

  it('asks for a key or a tap when the browser holds the sound back, and starts it at the first one', async () => {
    frames();
    const { dialog, fake, close } = await show({ starts: false });
    expect(dialog.dataset.sound).toBe('waiting');
    expect(status(dialog)).toBe("Never Logging Out, vesen's own 8-bit number · tap or press any key for sound");
    // The browser is satisfied by the next gesture.
    fake.synth.play.mockImplementation(() => {
      fake.state.playing = true;
      return Promise.resolve(true);
    });
    await fireEvent.keyDown(window, { key: 'x' });
    await Promise.resolve();
    await tick();
    expect(fake.synth.play).toHaveBeenCalledTimes(2);
    expect(dialog.dataset.sound).toBe('on');
    expect(close).not.toHaveBeenCalled();
  });

  it('starts the sound at a tap on the stage too', async () => {
    frames();
    const { dialog, fake } = await show({ starts: false });
    fake.synth.play.mockImplementation(() => {
      fake.state.playing = true;
      return Promise.resolve(true);
    });
    await fireEvent.click(dialog);
    await Promise.resolve();
    await tick();
    expect(fake.synth.play).toHaveBeenCalledTimes(2);
    expect(dialog.dataset.sound).toBe('on');
    // Once playing, a tap does nothing more.
    await fireEvent.click(dialog);
    expect(fake.synth.play).toHaveBeenCalledTimes(2);
  });

  it('says nothing about muting where there is no Web Audio, and disables the Mute button', async () => {
    frames();
    const close = vi.fn();
    const fake = fakeSynth(false);
    fake.state.available = false;
    render(Rick, { props: { props: rickView(true), close, synth: fake.make } });
    await tick();
    await Promise.resolve();
    await tick();
    const dialog = screen.getByRole('dialog', { name: RICK_TITLE });
    expect(dialog.dataset.sound).toBe('off');
    expect(status(dialog)).not.toContain('sound');
    expect((screen.getByRole('button', { name: 'Mute' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('opens through AppHost for rick, and Back closes it as Esc does', async () => {
    frames();
    const onclose = vi.fn();
    render(AppHost, { props: { request: { id: 11, view: 'rick', props: rickView(false) }, onclose } });
    await vi.waitFor(() => expect(screen.getByRole('dialog', { name: RICK_TITLE })).toBeInTheDocument());
    try {
      history.back();
      expect(onclose).toHaveBeenCalledWith(11, RICK_CLOSED);
    } finally {
      history.replaceState(null, '');
    }
  });

  it('opens through AppHost and Esc hands sudo its result', async () => {
    frames();
    const onclose = vi.fn();
    render(AppHost, { props: { request: { id: 12, view: 'rick', props: rickView(false) }, onclose } });
    await vi.waitFor(() => expect(screen.getByRole('dialog', { name: RICK_TITLE })).toBeInTheDocument());
    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(onclose).toHaveBeenCalledWith(12, RICK_CLOSED);
  });
});
