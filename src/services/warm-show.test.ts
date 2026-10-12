// The show's warm-up (app/bootstrap.ts runs it at idle): the track's element made and loading,
// kept for the show to take once; the frames fetched to the end and dropped; nothing played, and a
// host without an audio element or fetch left alone.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SHOW_FRAMES, SHOW_TRACK } from '../lib/show-files';
import { RICK_FRAMES, RICK_TRACK } from '../commands/lib/rick';
import { audioElement } from './track';
import { resetWarmShow, takeWarmedAudio, warmShow, type WarmHost } from './warm-show';

interface FakeElement {
  src: string;
  preload: string;
  loads: number;
  plays: number;
  load(): void;
  play(): Promise<void>;
}

function host(): { host: WarmHost; made: FakeElement[]; fetched: string[]; read: () => number } {
  const made: FakeElement[] = [];
  const fetched: string[] = [];
  let read = 0;
  const chunks = [new Uint8Array([1]), new Uint8Array([2])];
  return {
    made,
    fetched,
    read: () => read,
    host: {
      document: {
        createElement: (tag: string) => {
          expect(tag).toBe('audio');
          const element: FakeElement = {
            src: '',
            preload: '',
            loads: 0,
            plays: 0,
            load: () => (element.loads += 1),
            play: async () => void (element.plays += 1),
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

  it('hands the warmed element to the track, which keeps its download', () => {
    const h = host();
    warmShow(h.host);
    const element = audioElement(SHOW_TRACK);
    expect(element).toBe(h.made[0]);
    // Another track, or no source named, gets nothing warmed (and here, with no document, nothing at all).
    expect(audioElement('/audio/other.mp3')).toBeNull();
    expect(audioElement()).toBeNull();
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
