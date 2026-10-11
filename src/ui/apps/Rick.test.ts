// The Rick app (sudo): when it opens it makes the audio element for the owner's track, looping at
// a modest volume, and plays it, with the synth as the fallback where the track cannot load or
// play; where the browser holds the sound back until a gesture, the status line says so and the
// first key or tap starts it. The dancer steps on animation frames and rests while the page is
// hidden; the owner's frames file, when it is there, takes the stage, fitted to its size and
// started with the track; missing or malformed, the drawn dancer plays. Esc, q, ^C, Back and the
// Close button end it with the same result, stopping the sound with a short fade; m and the Mute
// button mute whichever plays; under reduced motion one frame stands still while the sound plays.
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RICK_ALT, RICK_CLOSED, RICK_FPS, RICK_FRAMES, RICK_TITLE, RICK_TRACK, rickFrames, rickView, type RickView } from '../../commands/lib/rick';
import type { Song } from '../../lib/chiptune';
import { parseFramesFile, type FramesFile } from '../../lib/frames';
import type { Chiptune, ChiptuneOptions } from '../../services/chiptune';
import { TRACK_FADE_MS, TRACK_VOLUME, type TrackElement } from '../../services/track';
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
function fakeSynth(starts = true, available = true) {
  const state = { playing: false, muted: false, available };
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

type AudioMode = 'plays' | 'blocked' | 'fails' | 'none';

/**
 * The audio element factory: real <audio> elements (so the app can put them in the page) whose
 * play() does what `mode` says: plays, is blocked until a gesture, or fails outright.
 */
function fakeAudio(mode: AudioMode) {
  const made: HTMLAudioElement[] = [];
  const state = { mode };
  const play = vi.fn((): Promise<void> => {
    if (state.mode === 'blocked') return Promise.reject(new DOMException('a gesture first', 'NotAllowedError'));
    if (state.mode === 'fails') return Promise.reject(new DOMException('The operation is not supported.', 'NotSupportedError'));
    return Promise.resolve();
  });
  const pause = vi.fn();
  const load = vi.fn();
  const factory = vi.fn((): TrackElement | null => {
    if (state.mode === 'none') return null;
    const element = document.createElement('audio');
    Object.defineProperties(element, { play: { value: play }, pause: { value: pause }, load: { value: load } });
    made.push(element);
    return element;
  });
  return {
    factory,
    made,
    play,
    pause,
    load,
    get element(): HTMLAudioElement | null {
      return made[0] ?? null;
    },
    setMode(next: AudioMode): void {
      state.mode = next;
    },
  };
}

function reducedMotion(): void {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduced-motion') }));
}

function setVisibility(state: 'hidden' | 'visible'): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

/** Lets the promises of opening settle: play(), the frames file, and the DOM after them. */
async function settle(): Promise<void> {
  await tick();
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
  await tick();
}

/** The owner's frames file for the tests: two frames of 3 by 2, two a second. */
const FILE = parseFramesFile('vesen-frames fps=2 cols=3 rows=2\nabc\ndef\n===\nghi\njkl\n') as FramesFile;

interface ShowOptions {
  touch?: boolean;
  audio?: AudioMode;
  starts?: boolean;
  synthAvailable?: boolean;
  /** What the frames file fetch gives; 'later' leaves it to the test's `deliver`. */
  file?: FramesFile | null | 'rejects' | 'later';
  view?: Partial<RickView>;
  /** Runs on each audio element as it is made, before play(). */
  onElement?: (element: HTMLAudioElement) => void;
}

/** Opens the show, in place of any shown before. */
async function show(options: ShowOptions = {}) {
  cleanup();
  const close = vi.fn();
  const fake = fakeSynth(options.starts ?? true, options.synthAvailable ?? true);
  const sound = fakeAudio(options.audio ?? 'plays');
  const audio = (): TrackElement | null => {
    const element = sound.factory();
    if (element !== null) options.onElement?.(element as HTMLAudioElement);
    return element;
  };
  let deliver: (file: FramesFile | null) => void = () => {};
  const fetchFrames = vi.fn((url: string): Promise<FramesFile | null> => {
    void url;
    if (options.file === 'rejects') return Promise.reject(new Error('no'));
    if (options.file === 'later') {
      return new Promise((resolve) => {
        deliver = resolve;
      });
    }
    return Promise.resolve(options.file ?? null);
  });
  const view: RickView = { ...rickView(options.touch ?? false), ...options.view };
  render(Rick, { props: { props: view, close, synth: fake.make, audio, fetchFrames } });
  await settle();
  return { close, fake, sound, fetchFrames, deliver: (file: FramesFile | null) => deliver(file), dialog: screen.getByRole('dialog', { name: RICK_TITLE }) };
}

const frameOf = (dialog: HTMLElement): HTMLElement => dialog.querySelector('.frame') as HTMLElement;
const drawn = (dialog: HTMLElement): string => frameOf(dialog).textContent ?? '';
const status = (dialog: HTMLElement): string => (dialog.querySelector('.status') as HTMLElement).textContent ?? '';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
});

describe('the Rick app', () => {
  it('shows the title, the first frame in colour with a text alternative, and the keys in the status line', async () => {
    frames();
    const { dialog, fake } = await show();
    expect(dialog.querySelector('.title')?.textContent).toBe('You have been rickrolled');
    const frame = frameOf(dialog);
    expect(frame.getAttribute('aria-hidden')).toBe('true');
    expect(drawn(dialog)).toBe(rickFrames()[0]?.text);
    expect(frame.querySelectorAll('span[style*="--role-accent"]').length).toBeGreaterThan(0);
    expect(frame.querySelectorAll('span[style*="--role-muted"]').length).toBeGreaterThan(0);
    expect(frame.style.getPropertyValue('--cols')).toBe('24');
    expect(frame.style.getPropertyValue('--rows')).toBe('14');
    expect(dialog.querySelector('.sr-only')?.textContent).toBe(RICK_ALT);
    expect(status(dialog)).toBe('Esc, ^C or q to leave; m to mute');
    expect(status(dialog)).toMatch(/^[\x20-\x7e]*$/);
    expect(dialog.dataset.motion).toBe('running');
    expect(dialog.dataset.frames).toBe('drawn');
    expect(dialog.querySelector('.toolbar')).toBeNull();
    // The track plays; the synth is not even made.
    expect(dialog.dataset.sound).toBe('on');
    expect(dialog.dataset.source).toBe('track');
    expect(fake.songs).toEqual([]);
  });

  it('makes the audio element when it opens, in the show, with the track looping at a modest volume, and plays it', async () => {
    frames();
    const { dialog, sound, fetchFrames } = await show();
    expect(sound.factory).toHaveBeenCalledTimes(1);
    const element = sound.element as HTMLAudioElement;
    expect(dialog.contains(element)).toBe(true);
    expect(element.getAttribute('src')).toBe(RICK_TRACK);
    expect(RICK_TRACK).toBe('/audio/incident-report.mp3');
    expect(element.loop).toBe(true);
    expect(element.volume).toBe(TRACK_VOLUME);
    expect(element.preload).toBe('auto');
    expect(element.muted).toBe(false);
    expect(sound.play).toHaveBeenCalledTimes(1);
    // The frames file was asked for once, as the show opened.
    expect(fetchFrames).toHaveBeenCalledTimes(1);
    expect(fetchFrames).toHaveBeenCalledWith(RICK_FRAMES);
  });

  it('plays the synth where the view names no track, and makes no element', async () => {
    frames();
    const { dialog, fake, sound } = await show({ view: { track: '' } });
    expect(sound.factory).not.toHaveBeenCalled();
    expect(fake.synth.play).toHaveBeenCalledTimes(1);
    expect(fake.songs[0]?.title).toBe('Never Logging Out');
    expect(dialog.dataset).toMatchObject({ sound: 'on', source: 'synth' });
    expect(dialog.querySelector('audio')).toBeNull();
  });

  it('plays the synth where no audio element can be made', async () => {
    frames();
    const { dialog, fake } = await show({ audio: 'none' });
    expect(fake.synth.play).toHaveBeenCalledTimes(1);
    expect(dialog.dataset).toMatchObject({ sound: 'on', source: 'synth' });
  });

  it('asks for a key or a tap when the browser holds the track back, and starts it at the first one', async () => {
    frames();
    const { dialog, sound, fake, close } = await show({ audio: 'blocked' });
    expect(dialog.dataset).toMatchObject({ sound: 'waiting', source: 'track' });
    expect(status(dialog)).toBe('tap or press any key for sound; Esc, ^C or q to leave');
    expect(fake.synth.play).not.toHaveBeenCalled();
    // The browser is satisfied by the next gesture.
    sound.setMode('plays');
    await fireEvent.keyDown(window, { key: 'x' });
    await settle();
    expect(sound.play).toHaveBeenCalledTimes(2);
    expect(dialog.dataset.sound).toBe('on');
    expect(status(dialog)).toBe('Esc, ^C or q to leave; m to mute');
    expect(close).not.toHaveBeenCalled();
  });

  it('starts the track at a tap on the stage too, and once playing a tap does nothing more', async () => {
    frames();
    const { dialog, sound } = await show({ audio: 'blocked' });
    sound.setMode('plays');
    await fireEvent.click(dialog);
    await settle();
    expect(sound.play).toHaveBeenCalledTimes(2);
    expect(dialog.dataset.sound).toBe('on');
    await fireEvent.click(dialog);
    expect(sound.play).toHaveBeenCalledTimes(2);
  });

  it('falls back to the synth when the track cannot play, letting the element go', async () => {
    frames();
    const { dialog, sound, fake } = await show({ audio: 'fails' });
    expect(fake.synth.play).toHaveBeenCalledTimes(1);
    expect(dialog.dataset).toMatchObject({ sound: 'on', source: 'synth' });
    expect(sound.pause).toHaveBeenCalled();
    expect(sound.element?.getAttribute('src')).toBeNull();
    expect(dialog.querySelector('audio')).toBeNull();
  });

  it('falls back to the synth when the element reports an error, keeping the mute', async () => {
    frames();
    const { dialog, sound, fake } = await show();
    await fireEvent.keyDown(window, { key: 'm' });
    expect(dialog.dataset.sound).toBe('muted');
    sound.element?.dispatchEvent(new Event('error'));
    await settle();
    expect(fake.synth.play).toHaveBeenCalledTimes(1);
    expect(fake.synth.mute).toHaveBeenCalledTimes(1);
    expect(dialog.dataset).toMatchObject({ sound: 'muted', source: 'synth' });
    expect(status(dialog)).toBe('Esc, ^C or q to leave; m to unmute');
  });

  it('steps through the drawn frames at the song\'s pace on animation frames, and rests while the page is hidden', async () => {
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
    it(`closes at ${name}, stopping the track with a short fade, and only once`, async () => {
      const raf = frames();
      const { close, sound, dialog } = await show();
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
      await fireEvent.keyDown(window, { key: 'Shift' });
      await fireEvent.keyDown(window, { key: 'Escape', repeat: true });
      expect(close).not.toHaveBeenCalled();
      await fireEvent.keyDown(window, key);
      expect(close).toHaveBeenCalledWith(RICK_CLOSED);
      expect(raf.cancel).toHaveBeenCalled();
      // Fading: the element is still there, quieter, until the fade is done.
      const element = sound.element as HTMLAudioElement;
      expect(sound.pause).not.toHaveBeenCalled();
      vi.advanceTimersByTime(TRACK_FADE_MS / 2);
      expect(element.volume).toBeLessThan(TRACK_VOLUME);
      expect(dialog.contains(element)).toBe(true);
      vi.advanceTimersByTime(TRACK_FADE_MS);
      expect(element.volume).toBe(0);
      expect(sound.pause).toHaveBeenCalledTimes(1);
      expect(element.getAttribute('src')).toBeNull();
      expect(sound.load).toHaveBeenCalledTimes(1);
      expect(dialog.contains(element)).toBe(false);
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

  it('mutes and unmutes the track with m, saying so in the status line', async () => {
    frames();
    const { dialog, sound } = await show();
    await fireEvent.keyDown(window, { key: 'm' });
    expect(sound.element?.muted).toBe(true);
    expect(dialog.dataset.sound).toBe('muted');
    expect(status(dialog)).toBe('Esc, ^C or q to leave; m to unmute');
    await fireEvent.keyDown(window, { key: 'M' });
    expect(sound.element?.muted).toBe(false);
    expect(dialog.dataset.sound).toBe('on');
    expect(status(dialog)).toBe('Esc, ^C or q to leave; m to mute');
  });

  it('on a touch screen has a Close and a Mute button of 44 px, and no key hint', async () => {
    frames();
    const { dialog, close, sound } = await show({ touch: true });
    expect(status(dialog)).toBe('');
    const mute = screen.getByRole('button', { name: 'Mute' });
    expect(mute.classList.contains('tool')).toBe(true);
    await fireEvent.click(mute);
    expect(sound.element?.muted).toBe(true);
    expect(screen.getByRole('button', { name: 'Unmute' })).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Unmute' }));
    expect(sound.element?.muted).toBe(false);
    await fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(close).toHaveBeenCalledWith(RICK_CLOSED);
  });

  it('on a touch screen asks for a tap while the browser waits, and says nothing else', async () => {
    frames();
    const { dialog } = await show({ touch: true, audio: 'blocked' });
    expect(status(dialog)).toBe('tap or press any key for sound');
  });

  it('stands still under reduced motion while the track plays, and leaves the same way', async () => {
    reducedMotion();
    const raf = frames();
    const { dialog, close, sound } = await show();
    expect(dialog.dataset.motion).toBe('still');
    expect(drawn(dialog)).toBe(rickFrames()[0]?.text);
    expect(raf.request).not.toHaveBeenCalled();
    expect(sound.play).toHaveBeenCalledTimes(1);
    expect(dialog.dataset.sound).toBe('on');
    setVisibility('hidden');
    setVisibility('visible');
    await tick();
    expect(dialog.dataset.motion).toBe('still');
    await fireEvent.keyDown(window, { key: 'q' });
    expect(close).toHaveBeenCalledWith(RICK_CLOSED);
  });

  it('says nothing about muting where nothing can play, and disables the Mute button', async () => {
    frames();
    const { dialog } = await show({ touch: true, audio: 'none', starts: false, synthAvailable: false });
    expect(dialog.dataset).toMatchObject({ sound: 'off', source: 'synth' });
    expect(status(dialog)).toBe('');
    expect((screen.getByRole('button', { name: 'Mute' }) as HTMLButtonElement).disabled).toBe(true);
    const keys = await show({ audio: 'none', starts: false, synthAvailable: false });
    expect(status(keys.dialog)).toBe('Esc, ^C or q to leave');
  });

  describe("the owner's frames", () => {
    it('take the stage when the file is there, fitted to their size, from where the track is', async () => {
      const raf = frames();
      // The track has been playing for a second and a half when the file arrives.
      const { dialog, deliver } = await show({ file: 'later', onElement: (element) => (element.currentTime = 1.5) });
      expect(dialog.dataset).toMatchObject({ sound: 'on', frames: 'drawn' });
      deliver(FILE);
      await settle();
      expect(dialog.dataset.frames).toBe('file');
      const frame = frameOf(dialog);
      expect(frame.style.getPropertyValue('--cols')).toBe('3');
      expect(frame.style.getPropertyValue('--rows')).toBe('2');
      // 1.5 s into the track at two frames a second: the second frame.
      expect(drawn(dialog)).toBe('ghi\njkl');
      expect(frame.querySelectorAll('span')).toHaveLength(2);
      // The clock goes on from there, at the file's pace, round the loop.
      raf.frame(0);
      raf.frame(250);
      raf.frame(500);
      await tick();
      expect(drawn(dialog)).toBe('abc\ndef');
      expect(dialog.dataset.motion).toBe('running');
    });

    it('start together with the track when the browser lets it play later', async () => {
      const raf = frames();
      const { dialog, sound } = await show({ audio: 'blocked', file: FILE });
      expect(dialog.dataset.frames).toBe('file');
      expect(drawn(dialog)).toBe('abc\ndef');
      raf.frame(0);
      raf.frame(250);
      raf.frame(500);
      await tick();
      expect(drawn(dialog)).toBe('ghi\njkl');
      sound.setMode('plays');
      await fireEvent.keyDown(window, { key: 'x' });
      await settle();
      expect(dialog.dataset.sound).toBe('on');
      expect(drawn(dialog)).toBe('abc\ndef');
    });

    it('stay drawn when the file is missing or malformed, or the fetch fails', async () => {
      frames();
      const missing = await show({ file: null });
      expect(missing.dialog.dataset.frames).toBe('drawn');
      expect(drawn(missing.dialog)).toBe(rickFrames()[0]?.text);
      expect(missing.fetchFrames).toHaveBeenCalledTimes(1);
      const failed = await show({ file: 'rejects' });
      expect(failed.dialog.dataset.frames).toBe('drawn');
    });

    it('are not asked for when the view names no file', async () => {
      frames();
      const { fetchFrames, dialog } = await show({ view: { framesFile: '' } });
      expect(fetchFrames).not.toHaveBeenCalled();
      expect(dialog.dataset.frames).toBe('drawn');
    });

    it('stand still under reduced motion too', async () => {
      reducedMotion();
      const raf = frames();
      const { dialog } = await show({ file: FILE });
      expect(dialog.dataset).toMatchObject({ frames: 'file', motion: 'still' });
      expect(drawn(dialog)).toBe('abc\ndef');
      expect(raf.request).not.toHaveBeenCalled();
    });
  });

  describe('through AppHost', () => {
    /** The real loader would fetch: nothing is there to answer. */
    function noFrames(): void {
      vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('', { status: 404 }))));
    }

    it('opens for rick, and Back closes it as Esc does', async () => {
      frames();
      noFrames();
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

    it('opens and Esc hands sudo its result', async () => {
      frames();
      noFrames();
      const onclose = vi.fn();
      render(AppHost, { props: { request: { id: 12, view: 'rick', props: rickView(false) }, onclose } });
      await vi.waitFor(() => expect(screen.getByRole('dialog', { name: RICK_TITLE })).toBeInTheDocument());
      await fireEvent.keyDown(window, { key: 'Escape' });
      expect(onclose).toHaveBeenCalledWith(12, RICK_CLOSED);
    });
  });
});
