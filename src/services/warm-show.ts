// Warming sudo's show once the page is idle (app/bootstrap.ts calls warmShow after its idle
// prefetch, and not on Data Saver or mobile data), so a visitor's first `sudo` starts its track
// and its frames at once instead of after their downloads: the track's audio element is made
// here, told to load (preload=auto) and kept, out of the page and never played, for the show to
// take when it opens (services/track.ts audioElement); the frames file is fetched once, at low
// priority, and its body dropped, so the browser's cache answers the show's own fetch of it
// (services/frames.ts). Nothing here plays, shows or throws; a browser without an audio element
// or fetch is left alone.

import { SHOW_FRAMES, SHOW_TRACK } from '../lib/show-files';
import type { TrackElement } from './track';

/** What warming needs of the window: a document to make the element in, and fetch. */
export interface WarmHost {
  readonly document?: Pick<Document, 'createElement'>;
  fetch?(input: string, init?: RequestInit): Promise<Response>;
}

const warmed = new Map<string, TrackElement>();
let started = false;

/** Warms the show's files, once. */
export function warmShow(host: WarmHost): void {
  if (started) return;
  started = true;
  if (host.document !== undefined && typeof host.document.createElement === 'function') {
    try {
      const element = host.document.createElement('audio') as TrackElement;
      element.preload = 'auto';
      element.src = SHOW_TRACK;
      element.load();
      warmed.set(SHOW_TRACK, element);
    } catch {
      // No audio element here: the show makes its own.
    }
  }
  if (typeof host.fetch === 'function') {
    try {
      void host
        .fetch(SHOW_FRAMES, { credentials: 'same-origin', priority: 'low' })
        .then(async (response) => {
          // Read to the end so the cache keeps it, holding none of it.
          const reader = response.body?.getReader();
          if (reader === undefined) return;
          while (!(await reader.read()).done) {
            // Dropped.
          }
        })
        .catch(() => {});
    } catch {
      // fetch refused the call: the show fetches for itself.
    }
  }
}

/** The warmed element for a track, once: the show takes it; null where none was warmed. */
export function takeWarmedAudio(src: string): TrackElement | null {
  const element = warmed.get(src) ?? null;
  warmed.delete(src);
  return element;
}

/** Forgets what was warmed, for tests. */
export function resetWarmShow(): void {
  warmed.clear();
  started = false;
}
