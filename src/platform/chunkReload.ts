/** sessionStorage key holding the build that last reloaded because of a stale chunk. */
export const CHUNK_RELOAD_KEY = 'vesen:chunk-reload:v1';

export type ReloadTarget = Pick<Window, 'addEventListener' | 'sessionStorage' | 'location'>;

/**
 * Recovers a tab that is still running an old build after a deploy.
 *
 * The old entry chunk asks for lazy chunks that no longer exist, and Vite reports that as
 * `vite:preloadError`. The tab then reloads once to pick up the new build. Each build may
 * reload at most once per tab session, and never when sessionStorage is unavailable, so a
 * chunk that is genuinely missing cannot cause a reload loop. When no reload happens, the
 * error reaches the importer as usual.
 *
 * @param build identifies the running build; the entry chunk's URL changes with every deploy.
 */
export function installChunkReload(target: ReloadTarget, build: string): void {
  target.addEventListener('vite:preloadError', (event) => {
    if (!claimReload(target, build)) return;
    event.preventDefault();
    target.location.reload();
  });
}

/** Records that `build` is reloading. False when it already has, or storage is blocked. */
export function claimReload(target: Pick<Window, 'sessionStorage'>, build: string): boolean {
  try {
    // Reading the property itself throws when site data is blocked.
    const storage = target.sessionStorage;
    if (storage.getItem(CHUNK_RELOAD_KEY) === build) return false;
    storage.setItem(CHUNK_RELOAD_KEY, build);
    return true;
  } catch {
    return false;
  }
}
