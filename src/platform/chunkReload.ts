import { STORAGE_KEYS } from '../services/storage-keys';
import type { KV } from '../services/types';

/** sessionStorage key holding the build that last reloaded because of a stale chunk. */
export const CHUNK_RELOAD_KEY = STORAGE_KEYS.chunkReload.key;

export type ReloadTarget = Pick<
  Window,
  'addEventListener' | 'removeEventListener' | 'location' | 'requestAnimationFrame' | 'setTimeout' | 'fetch'
> & { readonly navigator?: { readonly onLine: boolean } };

/** What the visitor reads just before the reload. */
export const UPDATE_NOTICE = 'vesen was updated, reloading...';

/**
 * Recovers a tab that is still running an old build after a deploy.
 *
 * The old entry chunk asks for lazy chunks that no longer exist, and Vite reports that as
 * `vite:preloadError`. A chunk fails for other reasons too, though: the connection drops, or the
 * visitor leaves while one is loading (WebKit cancels the page's loads as soon as Back starts,
 * before the page before it has arrived), and a reload then would undo the visitor's Back and
 * bring vesen back. So the error only raises the question. It reaches the importer as usual (each
 * says that its command or card could not load), and the tab asks the server whether its own
 * entry chunk is still there. Only a 404 or 410 means a deploy has replaced this build; then the
 * tab says so through `announce` and reloads once, after the next paint, to pick up the new build.
 *
 * Each build may reload at most once per tab session, and never when sessionStorage is
 * unavailable, so a chunk that is genuinely missing cannot cause a reload loop. Offline nothing
 * is asked: a reload would only swap the terminal for the browser's offline page.
 *
 * The transcript is not restored after the reload: the session snapshot (`vesen:session:v1`)
 * comes back only after Back or Forward, so a reload starts fresh.
 *
 * @param session the tab's sessionStorage, through the storage service.
 * @param build identifies the running build: the entry chunk's URL, which changes with every deploy.
 * @param announce shows `UPDATE_NOTICE` to the visitor, for example in the transcript.
 * @returns a function that removes the listener and drops an answer still to come.
 */
export function installChunkReload(
  target: ReloadTarget,
  session: KV<'session'>,
  build: string,
  announce: (message: string) => void = () => {},
): () => void {
  let asking = false;
  let stopped = false;
  const onPreloadError = () => {
    if (asking || target.navigator?.onLine === false) return;
    asking = true;
    void buildGone(target, build).then((gone) => {
      asking = false;
      if (stopped || !gone || !claimReload(session, build)) return;
      announce(UPDATE_NOTICE);
      // A frame callback runs before that frame paints; the timeout lets the notice paint first.
      target.requestAnimationFrame(() => target.setTimeout(() => target.location.reload(), 0));
    });
  };
  target.addEventListener('vite:preloadError', onPreloadError);
  return () => {
    stopped = true;
    target.removeEventListener('vite:preloadError', onPreloadError);
  };
}

/**
 * Whether the server no longer has `build`, the running build's entry chunk: a 404 or 410 from a
 * HEAD request past the browser's cache, which would otherwise answer for the old build for a
 * year. The request is keepalive, so a page that is being left does not cut it off (WebKit
 * reports a cut-off fetch as an error of the page's). False whenever it cannot tell.
 */
export async function buildGone(target: Pick<Window, 'fetch'>, build: string): Promise<boolean> {
  try {
    const response = await target.fetch(build, { method: 'HEAD', cache: 'no-store', credentials: 'same-origin', keepalive: true });
    return response.status === 404 || response.status === 410;
  } catch {
    return false;
  }
}

/**
 * Records that `build` is reloading. False when it already has, or when the record cannot
 * survive the reload because storage is blocked or full.
 */
export function claimReload(session: KV<'session'>, build: string): boolean {
  if (session.get(CHUNK_RELOAD_KEY) === build) return false;
  return session.set(CHUNK_RELOAD_KEY, build);
}
