// The show's warm-up (app/bootstrap.ts runs it at idle): the track's element made and loading,
// kept for the show to take once; the frames fetched to the end and dropped; nothing played, and a
// host without an audio element or fetch left alone. And the unlock, inside the key press that
// answers sudo's password: that element (or one made then) played muted and paused at once, so a
// browser that starts sound only from a gesture lets the show play it.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SHOW_FRAMES, SHOW_FRAMES_PORTRAIT, SHOW_TRACK } from '../lib/show-files';
import { RICK_FRAMES, RICK_FRAMES_PORTRAIT, RICK_TRACK } from '../commands/lib/rick';
import { audioElement } from './track';
import { resetWarmShow, takeWarmedAudio, unlockAudio, warmShow, type WarmHost } from './warm-show';

interface FakeElement {
  src: string;
  preload: string;
  muted: boolean;
  loads: number;
  plays: number;
  /** Whether it was muted at each play(), and each play() and pause() in order. */
  playedMuted: boolean[];
  calls: string[];
  load(): void;
  play(): Promise<void>;
  pause(): void;
}

function host(upright = false): { host: WarmHost; made: FakeElement[]; fetched: string[]; read: () => number } {
  const made: FakeElement[] = [];
  const fetched: string[] = [];
  let read = 0;
  const chunks = [new Uint8Array([1]), new Uint8Array([2])];
  return {
    made,
    fetched,
    read: () => read,
    host: {
      matchMedia: (query: string) => ({ matches: upright && query === '(orientation: portrait)' }),
      document: {
        createElement: (tag: string) => {
          expect(tag).toBe('audio');
          const element: FakeElement = {
            src: '',
            preload: '',
            muted: false,
            loads: 0,
            plays: 0,
            playedMuted: [],
            calls: [],
            load: () => (element.loads += 1),
            play: () => {
              element.plays += 1;
              element.playedMuted.push(element.muted);
              element.calls.push('play');
              // Paused before it began, as a browser rejects it.
              return Promise.reject(new DOMException('The play() request was interrupted by a call to pause().', 'AbortError'));
            },
            pause: () => void element.calls.push('pause'),
          };
          made.push(element);
          return element as unknown as HTMLElement;
        },
      } as unknown as Pick<Document, 'createElement'>,
      fetch: async (input: string, init?: RequestInit) => {
        fetched.push(input);
        expect(init).toEqual({ credentials: 'same-origin', priority: 'low' });
        let i = 0;
        const body = new ReadableStream<Uint8Array>({
          pull(controller) {
            if (i < chunks.length) {
              read += 1;
              controller.enqueue(chunks[i++] as Uint8Array);
            } else controller.close();
          },
        });
        return new Response(body, { status: 200 });
      },
    },
  };
}

afterEach(() => resetWarmShow());

describe('warmShow', () => {
  it('names the files the show plays', () => {
    expect(SHOW_TRACK).toBe(RICK_TRACK);
    expect(SHOW_FRAMES).toBe(RICK_FRAMES);
    expect(SHOW_FRAMES_PORTRAIT).toBe(RICK_FRAMES_PORTRAIT);
  });

  it('loads the track into an element it keeps for the show, and reads the frames to the end, once', async () => {
    const h = host();
    warmShow(h.host);
    warmShow(h.host);
    expect(h.made).toHaveLength(1);
    expect(h.made[0]).toMatchObject({ src: SHOW_TRACK, preload: 'auto', loads: 1, plays: 0 });
    expect(h.fetched).toEqual([SHOW_FRAMES]);
    await vi.waitFor(() => expect(h.read()).toBe(2));
    // The show takes the element, once; a second asker makes its own.
    expect(takeWarmedAudio(SHOW_TRACK)).toBe(h.made[0]);
    expect(takeWarmedAudio(SHOW_TRACK)).toBeNull();
    expect(h.made[0]?.plays).toBe(0);
  });

  it('warms the portrait cut on a screen taller than wide, the one the show will play there', async () => {
    const h = host(true);
    warmShow(h.host);
    expect(h.fetched).toEqual([SHOW_FRAMES_PORTRAIT]);
    await vi.waitFor(() => expect(h.read()).toBe(2));
  });

  it('hands the warmed element to the track, which keeps its download', () => {
    const h = host();
    warmShow(h.host);
    const element = audioElement(SHOW_TRACK);
    expect(element).toBe(h.made[0]);
    // Another track, or no source named, gets nothing warmed (and here, with no document, nothing at all).
    expect(audioElement('/audio/other.mp3')).toBeNull();
    expect(audioElement()).toBeNull();
  });

  it('unlocks the warmed element inside the gesture: played muted and paused at once, then handed to the show', () => {
    const h = host();
    warmShow(h.host);
    const element = h.made[0] as FakeElement;
    unlockAudio(SHOW_TRACK, h.host.document);
    expect(h.made).toHaveLength(1);
    expect(element.calls).toEqual(['play', 'pause']);
    expect(element.playedMuted).toEqual([true]);
    // Left as it was found, still loading.
    expect(element).toMatchObject({ muted: false, src: SHOW_TRACK, loads: 1 });
    expect(takeWarmedAudio(SHOW_TRACK)).toBe(element);
  });

  it('makes the element inside the gesture where nothing was warmed, and the warm-up keeps it', async () => {
    const h = host();
    unlockAudio(SHOW_TRACK, h.host.document);
    expect(h.made).toHaveLength(1);
    const element = h.made[0] as FakeElement;
    expect(element).toMatchObject({ src: SHOW_TRACK, preload: 'auto', muted: false, calls: ['play', 'pause'], playedMuted: [true] });
    // The warm-up later makes no second element, and still warms the frames.
    warmShow(h.host);
    expect(h.made).toHaveLength(1);
    expect(h.fetched).toEqual([SHOW_FRAMES]);
    await vi.waitFor(() => expect(h.read()).toBe(2));
    expect(takeWarmedAudio(SHOW_TRACK)).toBe(element);
  });

  it('unlocks nothing without a document, and never throws, whatever play() does', () => {
    expect(() => unlockAudio(SHOW_TRACK)).not.toThrow();
    expect(takeWarmedAudio(SHOW_TRACK)).toBeNull();
    const h = host();
    warmShow(h.host);
    const element = h.made[0] as FakeElement;
    element.play = () => {
      throw new Error('no');
    };
    expect(() => unlockAudio(SHOW_TRACK, h.host.document)).not.toThrow();
    expect(element.muted).toBe(false);
    const refusing: WarmHost = {
      document: {
        createElement: () => {
          throw new Error('no audio');
        },
      } as unknown as Pick<Document, 'createElement'>,
    };
    expect(() => unlockAudio('/audio/other.mp3', refusing.document)).not.toThrow();
    expect(takeWarmedAudio('/audio/other.mp3')).toBeNull();
  });

  it('leaves a host without an audio element or fetch alone, and never throws', () => {
    expect(() => warmShow({})).not.toThrow();
    expect(takeWarmedAudio(SHOW_TRACK)).toBeNull();
    resetWarmShow();
    const throwing: WarmHost = {
      document: {
        createElement: () => {
          throw new Error('no audio');
        },
      } as unknown as Pick<Document, 'createElement'>,
      fetch: () => Promise.reject(new Error('offline')),
    };
    expect(() => warmShow(throwing)).not.toThrow();
    expect(takeWarmedAudio(SHOW_TRACK)).toBeNull();
  });
});
