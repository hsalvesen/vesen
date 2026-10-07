import { STORAGE_KEYS } from '../services/storage-keys';
import type { KV } from '../services/types';

/** sessionStorage key holding the build that last reloaded because of a stale chunk. */
export const CHUNK_RELOAD_KEY = STORAGE_KEYS.chunkReload.key;

export type ReloadTarget = Pick<
  Window,
  'addEventListener' | 'removeEventListener' | 'location' | 'requestAnimationFrame' | 'setTimeout'
> & { readonly navigator?: { readonly onLine: boolean } };

/** What the visitor reads just before the reload. */
export const UPDATE_NOTICE = 'vesen was updated, reloading…';

/**
 * Recovers a tab that is still running an old build after a deploy.
 *
 * The old entry chunk asks for lazy chunks that no longer exist, and Vite reports that as
 * `vite:preloadError`. The tab then says so through `announce` and reloads once, after the
 * next paint, to pick up the new build. Each build may reload at most once per tab session,
 * and never when sessionStorage is unavailable, so a chunk that is genuinely missing cannot
 * cause a reload loop. Offline, a chunk fails because the network is down, and a reload would
 * only swap the terminal for the browser's offline page, so none happens. When no reload
 * happens, the error reaches the importer as usual.
 *
 * The transcript is not restored after the reload: the session snapshot (`vesen:session:v1`)
 * comes back only after Back or Forward, so a reload starts fresh.
 *
 * @param session the tab's sessionStorage, through the storage service.
 * @param build identifies the running build; the entry chunk's URL changes with every deploy.
 * @param announce shows `UPDATE_NOTICE` to the visitor, for example in the transcript.
 * @returns a function that removes the listener.
 */
export function installChunkReload(
  target: ReloadTarget,
  session: KV<'session'>,
  build: string,
  announce: (message: string) => void = () => {},
): () => void {
  const onPreloadError = (event: Event) => {
    if (target.navigator?.onLine === false || !claimReload(session, build)) return;
    event.preventDefault();
    announce(UPDATE_NOTICE);
    // A frame callback runs before that frame paints; the timeout lets the notice paint first.
    target.requestAnimationFrame(() => target.setTimeout(() => target.location.reload(), 0));
  };
  target.addEventListener('vite:preloadError', onPreloadError);
  return () => target.removeEventListener('vite:preloadError', onPreloadError);
}

/**
 * Records that `build` is reloading. False when it already has, or when the record cannot
 * survive the reload because storage is blocked or full.
 */
export function claimReload(session: KV<'session'>, build: string): boolean {
  if (session.get(CHUNK_RELOAD_KEY) === build) return false;
  return session.set(CHUNK_RELOAD_KEY, build);
}
