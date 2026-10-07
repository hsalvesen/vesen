// The session snapshot (docs/plan/04-phone-and-instagram.md, "Inside Instagram's browser";
// 02, section 8): inside an in-app browser a tapped link opens in the same view, so Back reloads
// vesen. On pagehide the screen (its last 50 entries, as text and styles, with no tap actions),
// the line being typed (never a secret), the folder and the scroll position go to sessionStorage
// under `vesen:session:v1`; they come back only when the page is reached by Back or Forward, and
// only for 30 minutes. A reload starts fresh.
//
// This file is what every page needs: the snapshot's shape, and deciding whether to restore.
// Saving is in session-save.ts, which loads just after the first paint; restoring, which
// rebuilds what was saved from scratch, is in session-restore.ts and loads only after Back.

import type { Block, Line } from '../output/model';
import { STORAGE_KEYS } from './storage-keys';
import type { KV } from './types';

export const SNAPSHOT_KEY = STORAGE_KEYS.session.key;
/** The most a snapshot may take in storage, in characters; the oldest entries go first. */
export const SNAPSHOT_MAX_CHARS = 1_000_000;

export interface SnapshotEntry {
  readonly prompt: Line | null;
  readonly line: string;
  readonly blocks: readonly Block[];
  readonly status?: number;
  readonly state: 'done' | 'interrupted';
}

export interface SessionSnapshot {
  readonly v: 1;
  readonly savedAt: number;
  readonly entries: readonly SnapshotEntry[];
  /** The line at the prompt; never a secret. */
  readonly line: string;
  readonly cwd: string;
  readonly scroll: { readonly top: number; readonly atBottom: boolean };
}

/** What the page has when it is put away. */
export interface SnapshotSource {
  readonly entries: readonly {
    readonly prompt: Line | null;
    readonly line: string;
    readonly blocks: readonly Block[];
    readonly status?: number;
    readonly state: 'running' | 'done' | 'interrupted';
  }[];
  /** The line at the prompt, or null while it holds a secret. */
  readonly line: string | null;
  readonly cwd: string;
  readonly scroll: { readonly top: number; readonly atBottom: boolean };
}

// ── When to restore ────────────────────────────────────────────────────────────────────────

export interface NavigationHost {
  readonly performance?: {
    getEntriesByType?(type: string): readonly unknown[];
    readonly navigation?: { readonly type?: number };
  };
}

/** How the page was reached: 'navigate', 'reload', 'back_forward' or 'prerender'; null if unknown. */
export function navigationType(host: NavigationHost): string | null {
  try {
    const entry = host.performance?.getEntriesByType?.('navigation')[0] as { readonly type?: unknown } | undefined;
    if (typeof entry?.type === 'string') return entry.type;
    // Older WebKit: PerformanceNavigation, where 2 is TYPE_BACK_FORWARD.
    const legacy = host.performance?.navigation?.type;
    if (legacy === 2) return 'back_forward';
    if (legacy === 1) return 'reload';
    if (legacy === 0) return 'navigate';
  } catch {
    // No performance timeline: nothing to go on.
  }
  return null;
}

/**
 * The saved snapshot's text when the page was reached by Back or Forward, for session-restore.ts
 * to rebuild; null for any other arrival, or when there is none.
 */
export function pendingSnapshot(host: NavigationHost, storage: KV<'session'>): string | null {
  return navigationType(host) === 'back_forward' ? storage.get(SNAPSHOT_KEY) : null;
}
