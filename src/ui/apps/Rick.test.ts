// The Rick app (sudo): when it opens it makes the audio element for the owner's track, looping at
// a modest volume, and plays it, with the synth as the fallback where the track cannot load or
// play; where the browser holds the sound back until a gesture, the first key or tap starts it,
// with nothing said. The owner's frames file takes the stage when it comes, fitted to its size and
// started with the track, stepping on animation frames and resting while the page is hidden, and
// the other cut takes over when the screen turns; until then, and where the file is missing or
// malformed, the stage is empty. Nothing is shown but the frames and, on a keyboard, how to leave,
// three seconds into the show; a touch screen shows the frames alone, and a tap leaves. Esc, q,
// ^C and Back end it with the same result, stopping the sound with a short fade; m mutes whichever
// plays, unannounced; under reduced motion the frames still play.
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RICK_ALT,
  RICK_CLOSED,
  RICK_ELEVATE,
  RICK_FINGERPRINT,
  RICK_FRAMES,
  RICK_FRAMES_PORTRAIT,
  RICK_HINT_AFTER_MS,
  RICK_KEYS_HINT,
  RICK_TAP_HINT,
  RICK_TITLE,
  RICK_TRACK,
  rickView,
  type RickView,
} from '../../commands/lib/rick';
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

/** A screen taller than wide: a phone held upright. */
function portrait(): void {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(orientation: portrait)' }));
}

/** A screen that turns: `turn(true)` holds it upright, `turn(false)` on its side, telling who listens. */
function turnable(upright: boolean) {
  let matches = upright;
  const listeners = new Set<() => void>();
  const list = {
    get matches() {
      return matches;
    },
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  };
  vi.stubGlobal('matchMedia', (query: string) => (query === '(orientation: portrait)' ? list : { matches: false }));
  return {
    listeners,
    turn(next: boolean): void {
      matches = next;
      for (const listener of [...listeners]) listener();
    },
  };
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
/** Its portrait cut: the same two frames, 2 by 3. */
const UPRIGHT = parseFramesFile('vesen-frames fps=2 cols=2 rows=3\nab\ncd\nef\n===\ngh\nij\nkl\n') as FramesFile;

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
  const fetchFrames = vi.fn((url: string, signal?: AbortSignal): Promise<FramesFile | null> => {
    void url;
    void signal;
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
/** The line under the picture on a keyboard; null where there is none (a touch screen). */
const status = (dialog: HTMLElement): string | null => dialog.querySelector('.status')?.textContent ?? null;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
});

describe('the Rick app', () => {
  it('shows an empty stage with a text alternative, and nothing else, until the file comes', async () => {
    frames();
    const { dialog, fake } = await show();
    expect(dialog.getAttribute('aria-label')).toBe(RICK_TITLE);
    expect(dialog.querySelector('.title')).toBeNull();
    expect(dialog.textContent?.replace(/\s+/g, ' ').trim()).toBe(RICK_ALT);
    const frame = frameOf(dialog);
    expect(frame.getAttribute('aria-hidden')).toBe('true');
    expect(drawn(dialog)).toBe('');
    expect(dialog.querySelector('.sr-only')?.textContent).toBe(RICK_ALT);
    // The line for how to leave is there, empty, until the show has played a few seconds.
    expect(status(dialog)).toBe('');
    expect(dialog.dataset.motion).toBe('still');
    expect(dialog.dataset.frames).toBe('none');
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
    expect(fetchFrames).toHaveBeenCalledWith(RICK_FRAMES, expect.any(AbortSignal));
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

  it('starts the track at the first key when the browser holds it back, saying nothing of it', async () => {
    frames();
    const { dialog, sound, fake, close } = await show({ audio: 'blocked' });
    expect(dialog.dataset).toMatchObject({ sound: 'waiting', source: 'track' });
    expect(status(dialog)).toBe('');
    expect(fake.synth.play).not.toHaveBeenCalled();
    // The browser is satisfied by the next gesture.
    sound.setMode('plays');
    await fireEvent.keyDown(window, { key: 'x' });
    await settle();
    expect(sound.play).toHaveBeenCalledTimes(2);
    expect(dialog.dataset.sound).toBe('on');
    expect(status(dialog)).toBe('');
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
    expect(status(dialog)).toBe('');
  });

  it("steps through the file's frames at its pace on animation frames, and rests while the page is hidden", async () => {
    const raf = frames();
    // The browser holds the sound back, so the frames start at once from the first.
    const { dialog } = await show({ file: FILE, audio: 'blocked' });
    raf.frame(0);
    await tick();
    const first = drawn(dialog);
    expect(first).toBe('abc\ndef');
    // Two frames a second, stepped a quarter of a second at a time (a step never advances more).
    raf.frame(250);
    await tick();
    expect(drawn(dialog)).toBe(first);
    raf.frame(500);
    await tick();
    expect(drawn(dialog)).toBe('ghi\njkl');
    raf.frame(750);
    raf.frame(1000);
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
      const { close, sound, dialog } = await show({ file: FILE });
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

  it('mutes and unmutes the track with m, saying nothing of it', async () => {
    frames();
    const { dialog, sound } = await show();
    await fireEvent.keyDown(window, { key: 'm' });
    expect(sound.element?.muted).toBe(true);
    expect(dialog.dataset.sound).toBe('muted');
    expect(status(dialog)).toBe('');
    await fireEvent.keyDown(window, { key: 'M' });
    expect(sound.element?.muted).toBe(false);
    expect(dialog.dataset.sound).toBe('on');
    expect(status(dialog)).toBe('');
  });

  it('on a touch screen asks for the right thumb under a fingerprint, starts at the touch, and the next tap leaves', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const raf = frames();
    const { dialog, close, sound } = await show({ touch: true, file: FILE });
    // Before the touch: the fingerprint, hidden from screen readers, over the two lines asking
    // for it; no picture, no sound, not even an element made.
    const print = dialog.querySelector('.elevate .print');
    expect(print?.textContent).toBe(RICK_FINGERPRINT);
    expect(print?.getAttribute('aria-hidden')).toBe('true');
    expect(dialog.querySelector('.elevate .scan')?.textContent).toBe(RICK_ELEVATE);
    expect(RICK_ELEVATE).toBe('Scan your right thumb\nto elevate privileges');
    expect(dialog.querySelector('.stage')?.classList.contains('waiting')).toBe(true);
    expect(dialog.dataset).toMatchObject({ motion: 'waiting', sound: 'off', frames: 'file' });
    expect(sound.factory).not.toHaveBeenCalled();
    expect(raf.request).not.toHaveBeenCalled();
    expect(dialog.querySelectorAll('button')).toHaveLength(0);
    // The tap: the sound starts inside it, and the picture with it.
    await fireEvent.click(dialog);
    expect(sound.factory).toHaveBeenCalledTimes(1);
    expect(sound.play).toHaveBeenCalledTimes(1);
    await settle();
    expect(dialog.dataset).toMatchObject({ motion: 'running', sound: 'on' });
    expect(dialog.querySelector('.elevate')).toBeNull();
    expect(dialog.querySelector('.stage')?.classList.contains('waiting')).toBe(false);
    expect(close).not.toHaveBeenCalled();
    // No line under the picture, now or later: the picture fills the screen, as a screen reader hears.
    vi.advanceTimersByTime(RICK_HINT_AFTER_MS * 2);
    await tick();
    expect(status(dialog)).toBeNull();
    expect(dialog.textContent).not.toContain(RICK_KEYS_HINT);
    expect([...dialog.querySelectorAll('.sr-only')].map((line) => line.textContent)).toEqual([RICK_ALT, RICK_TAP_HINT]);
    await fireEvent.click(dialog);
    expect(close).toHaveBeenCalledWith(RICK_CLOSED);
  });

  it('on a touch screen a key elevates too, and Esc leaves before or after', async () => {
    frames();
    const first = await show({ touch: true });
    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(first.close).toHaveBeenCalledWith(RICK_CLOSED);
    expect(first.sound.factory).not.toHaveBeenCalled();
    const second = await show({ touch: true });
    await fireEvent.keyDown(window, { key: 'Enter' });
    await settle();
    expect(second.dialog.dataset.sound).toBe('on');
    expect(second.close).not.toHaveBeenCalled();
  });

  it('on a keyboard a click on the stage does not leave', async () => {
    frames();
    const { dialog, close } = await show();
    await fireEvent.click(dialog);
    expect(close).not.toHaveBeenCalled();
  });

  it('on a touch screen a browser that holds the sound back even at the tap gets the next one, and the one after leaves', async () => {
    frames();
    const { dialog, sound, close } = await show({ touch: true, audio: 'blocked' });
    expect(dialog.dataset.sound).toBe('off');
    await fireEvent.click(dialog);
    await settle();
    expect(dialog.dataset.sound).toBe('waiting');
    expect(status(dialog)).toBeNull();
    sound.setMode('plays');
    await fireEvent.click(dialog);
    await settle();
    expect(dialog.dataset.sound).toBe('on');
    expect(close).not.toHaveBeenCalled();
    await fireEvent.click(dialog);
    expect(close).toHaveBeenCalledWith(RICK_CLOSED);
  });

  it('plays under reduced motion too, as a video does, with the track, and leaves the same way', async () => {
    reducedMotion();
    const raf = frames();
    const { dialog, close, sound } = await show({ file: FILE });
    expect(dialog.dataset).toMatchObject({ motion: 'running', sound: 'on' });
    expect(sound.play).toHaveBeenCalledTimes(1);
    raf.frame(0);
    await tick();
    expect(drawn(dialog)).toBe('abc\ndef');
    raf.frame(250);
    raf.frame(500);
    await tick();
    expect(drawn(dialog)).toBe('ghi\njkl');
    await fireEvent.keyDown(window, { key: 'q' });
    expect(close).toHaveBeenCalledWith(RICK_CLOSED);
  });

  it('plays the portrait cut on a screen taller than wide, and the whole picture otherwise', async () => {
    frames();
    const wide = await show();
    expect(wide.fetchFrames).toHaveBeenCalledWith(RICK_FRAMES, expect.any(AbortSignal));
    expect(wide.dialog.dataset.cut).toBe('landscape');
    portrait();
    const upright = await show();
    expect(upright.fetchFrames).toHaveBeenCalledTimes(1);
    expect(upright.fetchFrames).toHaveBeenCalledWith(RICK_FRAMES_PORTRAIT, expect.any(AbortSignal));
    expect(upright.dialog.dataset.cut).toBe('portrait');
    // A view with no portrait cut plays the whole picture upright too.
    const whole = await show({ view: { portraitFramesFile: '' } });
    expect(whole.fetchFrames).toHaveBeenCalledWith(RICK_FRAMES, expect.any(AbortSignal));
    expect(whole.dialog.dataset.cut).toBe('landscape');
  });

  it('changes cut when the screen turns, going on from where the picture had got to', async () => {
    const raf = frames();
    const screenNow = turnable(true);
    // Sound held back, so the frames keep their own time.
    const { dialog, fetchFrames, deliver } = await show({ file: 'later', audio: 'blocked' });
    expect(fetchFrames).toHaveBeenLastCalledWith(RICK_FRAMES_PORTRAIT, expect.any(AbortSignal));
    deliver(UPRIGHT);
    await settle();
    expect(dialog.dataset.cut).toBe('portrait');
    expect(frameOf(dialog).style.getPropertyValue('--cols')).toBe('2');
    raf.frame(0);
    raf.frame(250);
    raf.frame(500);
    await tick();
    expect(drawn(dialog)).toBe('gh\nij\nkl');

    // On its side: the whole picture is fetched, and the portrait cut plays until it comes.
    screenNow.turn(false);
    await settle();
    expect(fetchFrames).toHaveBeenCalledTimes(2);
    expect(fetchFrames).toHaveBeenLastCalledWith(RICK_FRAMES, expect.any(AbortSignal));
    expect(dialog.dataset.cut).toBe('portrait');
    deliver(FILE);
    await settle();
    expect(dialog.dataset.cut).toBe('landscape');
    expect(frameOf(dialog).style.getPropertyValue('--cols')).toBe('3');
    // Half a second in, still: the second frame, in the new cut.
    expect(drawn(dialog)).toBe('ghi\njkl');

    // Upright and back again before the portrait cut comes: that fetch stops, and the stage keeps what fits.
    screenNow.turn(true);
    await settle();
    expect(fetchFrames).toHaveBeenCalledTimes(3);
    const stopped = fetchFrames.mock.calls[2]?.[1] as AbortSignal | undefined;
    screenNow.turn(false);
    await settle();
    expect(fetchFrames).toHaveBeenCalledTimes(3);
    expect(stopped?.aborted).toBe(true);
    deliver(UPRIGHT);
    await settle();
    expect(dialog.dataset.cut).toBe('landscape');

    // Closed, it listens no more.
    cleanup();
    expect(screenNow.listeners.size).toBe(0);
  });

  it('stops fetching the frames when it closes', async () => {
    frames();
    const { fetchFrames, close } = await show({ file: 'later' });
    const signal = fetchFrames.mock.calls[0]?.[1] as AbortSignal | undefined;
    expect(signal?.aborted).toBe(false);
    await fireEvent.keyDown(window, { key: 'q' });
    expect(close).toHaveBeenCalledWith(RICK_CLOSED);
    expect(signal?.aborted).toBe(true);
  });

  describe('how to leave, on a keyboard', () => {
    it('says Press q or Esc to exit three seconds after the frames take the stage, and not before', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      frames();
      // The sound held back and the frames on their way: the show has not begun.
      const { dialog, deliver } = await show({ audio: 'blocked', file: 'later' });
      vi.advanceTimersByTime(RICK_HINT_AFTER_MS * 2);
      await tick();
      expect(status(dialog)).toBe('');
      deliver(FILE);
      await settle();
      vi.advanceTimersByTime(RICK_HINT_AFTER_MS - 1);
      await tick();
      expect(status(dialog)).toBe('');
      vi.advanceTimersByTime(1);
      await tick();
      expect(status(dialog)).toBe(RICK_KEYS_HINT);
      expect(RICK_KEYS_HINT).toBe('Press q or Esc to exit');
      expect(status(dialog)).toMatch(/^[\x20-\x7e]*$/);
      expect(dialog.querySelector('.status')?.classList.contains('shown')).toBe(true);
      expect(dialog.querySelector('.status')?.getAttribute('role')).toBe('status');
    });

    it('counts from the sound where it starts before the frames, and from the start where no frames will come', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      frames();
      const playing = await show({ file: 'later' });
      expect(playing.dialog.dataset.sound).toBe('on');
      vi.advanceTimersByTime(RICK_HINT_AFTER_MS);
      await tick();
      expect(status(playing.dialog)).toBe(RICK_KEYS_HINT);
      // Nothing to play at all, and no file: it still says how to leave.
      const silent = await show({ audio: 'none', starts: false, synthAvailable: false, file: null });
      expect(silent.dialog.dataset).toMatchObject({ sound: 'off', frames: 'none' });
      vi.advanceTimersByTime(RICK_HINT_AFTER_MS);
      await tick();
      expect(status(silent.dialog)).toBe(RICK_KEYS_HINT);
    });

    it('never comes once the show has closed', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      frames();
      const { dialog, close } = await show({ file: FILE });
      vi.advanceTimersByTime(RICK_HINT_AFTER_MS / 2);
      await fireEvent.keyDown(window, { key: 'Escape' });
      expect(close).toHaveBeenCalledWith(RICK_CLOSED);
      vi.advanceTimersByTime(RICK_HINT_AFTER_MS);
      await tick();
      expect(status(dialog)).toBe('');
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe("the owner's frames", () => {
    it('take the stage when the file is there, fitted to their size, from where the track is', async () => {
      const raf = frames();
      // The track has been playing for a second and a half when the file arrives.
      const { dialog, deliver } = await show({ file: 'later', onElement: (element) => (element.currentTime = 1.5) });
      expect(dialog.dataset).toMatchObject({ sound: 'on', frames: 'none', motion: 'still' });
      expect(drawn(dialog)).toBe('');
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

    it('leave the stage empty when the file is missing or malformed, or the fetch fails', async () => {
      const raf = frames();
      const missing = await show({ file: null });
      expect(missing.dialog.dataset).toMatchObject({ frames: 'none', motion: 'still' });
      expect(drawn(missing.dialog)).toBe('');
      expect(missing.fetchFrames).toHaveBeenCalledTimes(1);
      expect(raf.request).not.toHaveBeenCalled();
      const failed = await show({ file: 'rejects' });
      expect(failed.dialog.dataset.frames).toBe('none');
      expect(drawn(failed.dialog)).toBe('');
    });

    it('are not asked for when the view names no file', async () => {
      frames();
      const { fetchFrames, dialog } = await show({ view: { framesFile: '' } });
      expect(fetchFrames).not.toHaveBeenCalled();
      expect(dialog.dataset.frames).toBe('none');
    });

    it('stand still where the browser cannot animate, on the most detailed frame, not a black first one', async () => {
      vi.stubGlobal('requestAnimationFrame', undefined);
      const { dialog } = await show({ file: FILE });
      expect(dialog.dataset).toMatchObject({ frames: 'file', motion: 'still' });
      expect(drawn(dialog)).toBe('abc\ndef');
      const black = parseFramesFile('vesen-frames fps=2 cols=3 rows=2\n   \n   \n===\nab.\n.cd\n===\naaa\naaa\n') as FramesFile;
      const fades = await show({ file: black });
      expect(drawn(fades.dialog)).toBe('ab.\n.cd');
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
