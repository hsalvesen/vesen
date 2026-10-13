// Warming sudo's show once the page is idle (app/bootstrap.ts calls warmShow after its idle
// prefetch, and not on Data Saver or mobile data), so a visitor's first `sudo` starts its track
// and its frames at once instead of after their downloads: the track's audio element is made
// here, told to load (preload=auto) and kept out of the page, silent, for the show to take when
// it opens (services/track.ts audioElement); the frames file the screen would play (the
// portrait cut on a screen taller than wide, lib/show-files.ts) is fetched once, at low priority,
// and its body dropped, so the browser's cache answers the show's own fetch of it
// (services/frames.ts). Nothing here shows or throws; a browser without an audio element or fetch
// is left alone.
//
// Unlocking: Safari, every browser on iOS, and in-app browsers (Instagram's, Facebook's) let a page
// start sound only inside a tap or key press, and the show opens after one has passed: sudo's
// password is answered, its show's chunk loads, and only then does it play. Each of them remembers
// an element that has been played inside a gesture, though, and lets it play later. So sudo asks
// for its track to be unlocked inside the key press that answers the password (shell/reader.ts),
// and unlockAudio plays the element the show will take there, muted, and pauses it at once,
// before anything can be heard. Where nothing was warmed (Data Saver, mobile data), it makes the
// element there and starts it loading.

import { PORTRAIT_QUERY, SHOW_TRACK, showFramesFor } from '../lib/show-files';
import type { TrackElement } from './track';

/** What warming needs of the window: a document to make the element in, fetch, and the screen's shape. */
export interface WarmHost {
  readonly document?: Pick<Document, 'createElement'>;
  fetch?(input: string, init?: RequestInit): Promise<Response>;
  matchMedia?(query: string): { readonly matches: boolean };
}

const warmed = new Map<string, TrackElement>();
let started = false;

/** Warms the show's files, once. */
export function warmShow(host: WarmHost): void {
  if (started) return;
  started = true;
  // An element unlocked already, by a password answered before the page was idle, is loading.
  if (!warmed.has(SHOW_TRACK) && host.document !== undefined && typeof host.document.createElement === 'function') {
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
      const portrait = typeof host.matchMedia === 'function' && host.matchMedia(PORTRAIT_QUERY).matches;
      void host
        .fetch(showFramesFor(portrait), { credentials: 'same-origin', priority: 'low' })
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

/**
 * Readies the element `track` will play through, so it may play later without another gesture:
 * must be called synchronously inside the key press or tap. The warmed element, or one made here
 * (which starts loading the track), is played muted and paused at once, so nothing is heard; the
 * show takes it with takeWarmedAudio. Never throws.
 */
export function unlockAudio(track: string, document?: Pick<Document, 'createElement'>): void {
  let element = warmed.get(track) ?? null;
  if (element === null) {
    if (document === undefined || typeof document.createElement !== 'function') return;
    try {
      element = document.createElement('audio') as TrackElement;
      element.preload = 'auto';
      element.src = track;
    } catch {
      // No audio element here: the show makes its own, and asks for a tap where it must.
      return;
    }
    warmed.set(track, element);
  }
  const muted = element.muted;
  try {
    element.muted = true;
    const started = element.play();
    // Paused straight away, the play is abandoned: that is no failure.
    if (started !== undefined && typeof started.catch === 'function') started.catch(() => {});
    element.pause();
  } catch {
    // The browser would not even try: the show asks for a tap, as it always has.
  } finally {
    element.muted = muted;
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
