// A recorded track for sudo's show (public/audio/incident-report.mp3), played through an
// HTMLAudioElement behind the Chiptune interface, so the Rick app (ui/apps/Rick.svelte) drives the
// track and the synth alike and falls back from one to the other. The app makes the element when
// the show opens and never before: the file must not be fetched at boot or on `sudo --help`. The
// track loops at a modest volume; m mutes it; stop() fades it out and releases the element, so
// nothing plays on after the show; position() says how far in it is, so frames can follow it.
//
// Autoplay: a browser that has seen no gesture of its own rejects play() with NotAllowedError;
// then play() resolves false and the app asks for a key or a tap, and plays again inside it. Any
// other failure (an error event: the file is missing, cannot be decoded or will not play; or
// play() rejecting for another reason) is reported through onFail, so the app can fall back to
// the synth.

import type { Chiptune } from './chiptune';

/** The track's volume: modest, under the terminal's own sounds. */
export const TRACK_VOLUME = 0.6;
/** The fade when the track stops, so nothing clicks. */
export const TRACK_FADE_MS = 150;
/** How many steps the fade takes. */
const FADE_STEPS = 6;

/** What the track needs of an audio element: an HTMLAudioElement, or a stand-in in tests. */
export interface TrackElement {
  src: string;
  loop: boolean;
  volume: number;
  muted: boolean;
  preload: string;
  readonly paused: boolean;
  /** Seconds into the track. */
  readonly currentTime: number;
  /** Resolves when playback starts; rejects with NotAllowedError until the browser has seen a gesture. Older browsers return nothing. */
  play(): Promise<void> | undefined;
  pause(): void;
  /** Resets the element after its source was removed, so the download stops. */
  load(): void;
  removeAttribute(name: string): void;
  remove(): void;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

export interface TrackOptions {
  readonly volume?: number;
  /** Called whenever `playing` or `muted` changes. */
  readonly onChange?: () => void;
  /** The file cannot be loaded or played: the caller falls back. Called at most once. */
  readonly onFail?: (reason: string) => void;
}

export interface Track extends Chiptune {
  /** The file could not be loaded or played. */
  readonly failed: boolean;
  /** stop() has run: the element is released and nothing will play. */
  readonly released: boolean;
  /** Seconds into the track, so frames can start with it; 0 before it plays or after it is released. */
  position(): number;
}

/** A fresh audio element, or null where there is no document (and so no sound). */
export function audioElement(): TrackElement | null {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
  try {
    return document.createElement('audio');
  } catch {
    return null;
  }
}

/** The browser wants a gesture before it plays: play() again inside one. */
function isAutoplayBlock(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'NotAllowedError';
}

/** The failure in a few words: a DOMException's name and message, or a MediaError's code. */
function reasonOf(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const { name, message, code } = error as { name?: unknown; message?: unknown; code?: unknown };
    if (typeof message === 'string' && message !== '') return typeof name === 'string' ? `${name}: ${message}` : message;
    if (typeof name === 'string') return name;
    if (typeof code === 'number') return `MediaError ${code}`;
  }
  return 'the track cannot be played';
}

/** Plays `src` through `element`, looping, from the first play() on. */
export function createTrack(src: string, element: TrackElement, options: TrackOptions = {}): Track {
  const volume = Math.min(1, Math.max(0, options.volume ?? TRACK_VOLUME));
  let playing = false;
  let muted = false;
  let failed = false;
  let released = false;
  /** play() was called, and stop() has not been since. */
  let wanted = false;
  let fade: ReturnType<typeof setInterval> | null = null;

  const changed = (): void => options.onChange?.();

  /** The element's own word on whether it plays: a pause from outside (a call, the lock screen) counts. */
  const onPause = (): void => {
    if (!playing) return;
    playing = false;
    changed();
  };
  const onPlaying = (): void => {
    if (playing || !wanted || released) return;
    playing = true;
    changed();
  };

  function fail(error: unknown): void {
    if (failed || released) return;
    failed = true;
    const was = playing;
    playing = false;
    wanted = false;
    release();
    if (was) changed();
    options.onFail?.(reasonOf(error));
  }
  const onError = (): void => fail((element as { error?: unknown }).error ?? { code: 0 });

  /** Lets the element go: silent, its download stopped, out of the page. */
  function release(): void {
    if (released) return;
    released = true;
    if (fade !== null) {
      clearInterval(fade);
      fade = null;
    }
    element.removeEventListener('error', onError);
    element.removeEventListener('pause', onPause);
    element.removeEventListener('playing', onPlaying);
    try {
      element.pause();
    } catch {
      // Already gone.
    }
    try {
      element.removeAttribute('src');
      element.load();
    } catch {
      // The browser refused: the element goes anyway.
    }
    try {
      element.remove();
    } catch {
      // Not in the page.
    }
  }

  function setVolume(level: number): void {
    try {
      element.volume = Math.min(1, Math.max(0, level));
    } catch {
      // iOS keeps the volume to itself.
    }
  }

  element.addEventListener('error', onError);
  element.addEventListener('pause', onPause);
  element.addEventListener('playing', onPlaying);
  element.loop = true;
  element.muted = false;
  setVolume(volume);
  // Set last: the browser may start the download as soon as it has a source.
  element.preload = 'auto';
  element.src = src;

  return {
    get available() {
      return !failed && !released;
    },
    get playing() {
      return playing;
    },
    get muted() {
      return muted;
    },
    get failed() {
      return failed;
    },
    get released() {
      return released;
    },
    position() {
      if (released) return 0;
      const time = element.currentTime;
      return typeof time === 'number' && Number.isFinite(time) && time > 0 ? time : 0;
    },
    async play() {
      if (failed || released) return false;
      wanted = true;
      if (fade !== null) {
        clearInterval(fade);
        fade = null;
        setVolume(volume);
      }
      let started: Promise<void> | undefined;
      try {
        started = element.play();
      } catch (error) {
        fail(error);
        return false;
      }
      if (started === undefined || typeof started.then !== 'function') {
        // An old browser, with no promise: take it as playing.
        if (!wanted || released) return false;
        if (!playing) {
          playing = true;
          changed();
        }
        return true;
      }
      try {
        await started;
      } catch (error) {
        // stop() came first: its pause() aborts the play, which is no failure.
        if (!wanted || released) return false;
        if (isAutoplayBlock(error)) return false;
        fail(error);
        return false;
      }
      if (!wanted || released) return false;
      if (!playing) {
        playing = true;
        changed();
      }
      return true;
    },
    stop() {
      wanted = false;
      if (released || fade !== null) return;
      if (!playing) {
        release();
        return;
      }
      playing = false;
      changed();
      // Down in steps to silence, then let go.
      let step = 0;
      fade = setInterval(() => {
        step += 1;
        setVolume(volume * (1 - step / FADE_STEPS));
        if (step >= FADE_STEPS) release();
      }, TRACK_FADE_MS / FADE_STEPS);
    },
    mute() {
      if (muted) return;
      muted = true;
      element.muted = true;
      changed();
    },
    unmute() {
      if (!muted) return;
      muted = false;
      element.muted = false;
      changed();
    },
  };
}
