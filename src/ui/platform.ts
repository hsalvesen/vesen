// What the composition root (app/bootstrap.ts) hands the App: the link and clipboard services,
// and the session snapshot's storage and what was restored from it. A test may mount the App
// without them: links then open in a new tab and nothing is snapshotted.

import type { SessionSnapshot } from '../services/session-snapshot';
import type { Clipboard, KV, Opener } from '../services/types';

export interface AppPlatform {
  readonly opener: Opener | null;
  readonly clipboard: Clipboard | null;
  /** Where the session snapshot is saved on pagehide; null keeps none. */
  readonly session: KV<'session'> | null;
  /** After Back, the snapshot boot is restoring the screen from; the App puts back its line and scroll. */
  readonly restored: Promise<SessionSnapshot | null> | null;
}
