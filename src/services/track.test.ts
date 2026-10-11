// The track (sudo's show) over a fake audio element: the element is set to loop at a modest
// volume and given its source last; play() resolves true when the browser plays and false while
// it waits for a gesture; any other failure, and an error from the element, reports once through
// onFail and releases the element; mute and unmute mute the element; stop fades it out and
// releases it; position follows the element's time.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTrack, TRACK_FADE_MS, TRACK_VOLUME, type TrackElement } from './track';

type Mode = 'ok' | 'blocked' | 'fails' | 'legacy' | 'throws' | 'pending';

/** An audio element by hand: play() does what `mode` says; the calls and the events are recorded. */
class FakeAudio implements TrackElement {
  src = '';
  loop = false;
  volume = 1;
  muted = false;
  preload = 'none';
  paused = true;
  currentTime = 0;
  error: { code: number; message?: string } | null = null;
  mode: Mode = 'ok';
  readonly calls: string[] = [];
  readonly volumes: number[] = [];
  /** The pending play()'s settlers, in 'pending' mode. */
  settle: { resolve(): void; reject(error: unknown): void } | null = null;
  private readonly listeners = new Map<string, Set<() => void>>();

  play(): Promise<void> | undefined {
    this.calls.push('play');
    if (this.mode === 'throws') throw new Error('no play here');
    if (this.mode === 'legacy') {
      this.paused = false;
      return undefined;
    }
    if (this.mode === 'blocked') return Promise.reject(new DOMException('a gesture first', 'NotAllowedError'));
    if (this.mode === 'fails') return Promise.reject(new DOMException('The operation is not supported.', 'NotSupportedError'));
    if (this.mode === 'pending') {
      return new Promise<void>((resolve, reject) => {
        this.settle = { resolve, reject };
      });
    }
    this.paused = false;
    return Promise.resolve();
  }

  pause(): void {
    this.calls.push('pause');
    this.paused = true;
  }

  load(): void {
    this.calls.push('load');
  }

  removeAttribute(name: string): void {
    this.calls.push(`removeAttribute:${name}`);
    if (name === 'src') this.src = '';
  }

  remove(): void {
    this.calls.push('remove');
  }

  addEventListener(type: string, listener: () => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)?.add(listener);
  }

  removeEventListener(type: string, listener: () => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }

  listening(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
}

/** The calls that let the element go: silent, its download stopped, out of the page. */
const RELEASED = ['pause', 'removeAttribute:src', 'load', 'remove'];

function make(mode: Mode = 'ok', volume?: number) {
  const element = new FakeAudio();
  element.mode = mode;
  const onChange = vi.fn();
  const onFail = vi.fn();
  const track = createTrack('/audio/incident-report.mp3', element, { onChange, onFail, ...(volume !== undefined ? { volume } : {}) });
  return { element, track, onChange, onFail };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('the track', () => {
  it('sets the element up to loop at a modest volume, preloading, and gives it the source last', () => {
    const { element, track } = make();
    expect(element.loop).toBe(true);
    expect(element.volume).toBe(TRACK_VOLUME);
    expect(TRACK_VOLUME).toBe(0.6);
    expect(element.muted).toBe(false);
    expect(element.preload).toBe('auto');
    expect(element.src).toBe('/audio/incident-report.mp3');
    expect(element.calls).toEqual([]);
    expect(track).toMatchObject({ available: true, playing: false, muted: false, failed: false, released: false });
    expect(make('ok', 0.25).element.volume).toBe(0.25);
    expect(make('ok', 7).element.volume).toBe(1);
  });

  it('plays: resolves true, reports playing, and says how far in it is', async () => {
    const { element, track, onChange, onFail } = make();
    expect(track.position()).toBe(0);
    await expect(track.play()).resolves.toBe(true);
    expect(track.playing).toBe(true);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onFail).not.toHaveBeenCalled();
    element.currentTime = 12.5;
    expect(track.position()).toBe(12.5);
    element.currentTime = Number.NaN;
    expect(track.position()).toBe(0);
    // Playing again changes nothing.
    await expect(track.play()).resolves.toBe(true);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('resolves false while the browser waits for a gesture, and plays at the next try', async () => {
    const { element, track, onChange, onFail } = make('blocked');
    await expect(track.play()).resolves.toBe(false);
    expect(track).toMatchObject({ playing: false, available: true, failed: false });
    expect(onFail).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    element.mode = 'ok';
    await expect(track.play()).resolves.toBe(true);
    expect(track.playing).toBe(true);
  });

  it('fails once, releasing the element, when play() rejects for another reason', async () => {
    const { element, track, onFail } = make('fails');
    await expect(track.play()).resolves.toBe(false);
    expect(onFail).toHaveBeenCalledTimes(1);
    expect(onFail).toHaveBeenCalledWith('NotSupportedError: The operation is not supported.');
    expect(track).toMatchObject({ failed: true, released: true, available: false, playing: false });
    expect(element.calls.slice(1)).toEqual(RELEASED);
    expect(element.listening('error')).toBe(0);
    // Nothing more comes of it.
    await expect(track.play()).resolves.toBe(false);
    element.emit('error');
    expect(onFail).toHaveBeenCalledTimes(1);
  });

  it("fails when the element reports an error, with the error's code or message", async () => {
    const { element, track, onFail, onChange } = make();
    await track.play();
    element.error = { code: 4 };
    element.emit('error');
    expect(onFail).toHaveBeenCalledWith('MediaError 4');
    expect(track).toMatchObject({ failed: true, released: true, playing: false });
    // It was playing: the change is reported before the failure.
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange.mock.invocationCallOrder[1]).toBeLessThan(onFail.mock.invocationCallOrder[0] ?? 0);
    expect(element.calls.slice(1)).toEqual(RELEASED);

    const other = make();
    other.element.error = { code: 2, message: 'MEDIA_ELEMENT_ERROR: Format error' };
    other.element.emit('error');
    expect(other.onFail).toHaveBeenCalledWith('MEDIA_ELEMENT_ERROR: Format error');
    const bare = make();
    bare.element.emit('error');
    expect(bare.onFail).toHaveBeenCalledWith('MediaError 0');
  });

  it('fails when play() throws', async () => {
    const { track, onFail } = make('throws');
    await expect(track.play()).resolves.toBe(false);
    expect(onFail).toHaveBeenCalledWith('Error: no play here');
    expect(track.failed).toBe(true);
  });

  it("takes an old browser's play() with no promise as playing", async () => {
    const { track, onChange } = make('legacy');
    await expect(track.play()).resolves.toBe(true);
    expect(track.playing).toBe(true);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('mutes and unmutes the element, saying so once each', async () => {
    const { element, track, onChange } = make();
    await track.play();
    track.mute();
    track.mute();
    expect(element.muted).toBe(true);
    expect(track.muted).toBe(true);
    expect(onChange).toHaveBeenCalledTimes(2);
    track.unmute();
    track.unmute();
    expect(element.muted).toBe(false);
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it('stops with a short fade, then releases the element, and plays no more', async () => {
    vi.useFakeTimers();
    const { element, track, onChange } = make();
    await track.play();
    track.stop();
    expect(track.playing).toBe(false);
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(element.calls).toEqual(['play']);
    vi.advanceTimersByTime(TRACK_FADE_MS / 2);
    expect(element.volume).toBeLessThan(TRACK_VOLUME);
    expect(element.volume).toBeGreaterThan(0);
    expect(track.released).toBe(false);
    vi.advanceTimersByTime(TRACK_FADE_MS);
    expect(element.volume).toBe(0);
    expect(track.released).toBe(true);
    expect(element.calls.slice(1)).toEqual(RELEASED);
    track.stop();
    expect(element.calls.slice(1)).toEqual(RELEASED);
    await expect(track.play()).resolves.toBe(false);
    expect(element.calls.filter((call) => call === 'play')).toHaveLength(1);
  });

  it('stops at once when nothing plays', async () => {
    const { element, track, onChange } = make('blocked');
    await track.play();
    track.stop();
    expect(track.released).toBe(true);
    expect(element.calls.slice(1)).toEqual(RELEASED);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('is no failure when stop() cuts a pending play() short', async () => {
    const { element, track, onFail } = make('pending');
    const played = track.play();
    track.stop();
    element.settle?.reject(new DOMException('The play() request was interrupted by a call to pause().', 'AbortError'));
    await expect(played).resolves.toBe(false);
    expect(onFail).not.toHaveBeenCalled();
    expect(track).toMatchObject({ playing: false, released: true, failed: false });
  });

  it("follows the element's own word: a pause from outside, and playing again", async () => {
    const { element, track, onChange } = make();
    await track.play();
    element.emit('pause');
    expect(track.playing).toBe(false);
    expect(onChange).toHaveBeenCalledTimes(2);
    element.emit('pause');
    expect(onChange).toHaveBeenCalledTimes(2);
    element.emit('playing');
    expect(track.playing).toBe(true);
    expect(onChange).toHaveBeenCalledTimes(3);
  });
});
