// The browser's local storage, for commands that keep something across visits (nano's unsaved
// buffers). Commands are DOM-free, so they never reach localStorage themselves: the app hands its
// storage service's local area over here (app/shell.ts), as it does the session area
// (session-store.ts), and a command reads and writes only the keys registered for it in
// services/storage-keys.ts. Without one, as in most tests, there is none, and nothing is kept.

import type { KV } from '../../services/types';

let store: KV<'local'> | null = null;

/** Sets the browser's local storage, replacing any before it; null leaves none. */
export function provideLocalStore(kv: KV<'local'> | null): void {
  store = kv;
}

/** The browser's local storage, or null when the app has given none. */
export function localStore(): KV<'local'> | null {
  return store;
}
