// The tab's session storage, for commands that keep something until the tab closes (git's
// commits, for 10 minutes). Commands are DOM-free, so they never reach sessionStorage
// themselves: the app hands its storage service's session area over here (app/shell.ts), and a
// command reads and writes only the keys registered for it in services/storage-keys.ts. Without
// one, as in most tests, there is none, and a command keeps what it fetched in memory instead.

import type { KV } from '../../services/types';

let store: KV<'session'> | null = null;

/** Sets the tab's session storage, replacing any before it; null leaves none. */
export function provideSessionStore(kv: KV<'session'> | null): void {
  store = kv;
}

/** The tab's session storage, or null when the app has given none. */
export function sessionStore(): KV<'session'> | null {
  return store;
}
