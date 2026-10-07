// The session snapshot (docs/plan/04-phone-and-instagram.md, "Inside Instagram's browser";
// 02, section 8): inside an in-app browser a tapped link opens in the same view, so Back reloads
// vesen. On pagehide the screen (its last 50 entries, as text and styles, with no tap actions),
// the line being typed (never a secret), the folder and the scroll position go to sessionStorage
// under `vesen:session:v1`; they come back only when the page is reached by Back or Forward, and
// only for 30 minutes. A reload starts fresh.
//
// This file is what every page needs: saving, and deciding whether to restore. Restoring, which
// rebuilds what was saved from scratch, is in session-restore.ts and loads only after Back.

import type { Block, Line } from '../output/model';
import { STORAGE_KEYS, STORAGE_LIMITS } from './storage-keys';
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

/**
 * What never goes into a snapshot: tap actions, live bindings, swatches and a rich card's view
 * model. Chips are only actions, so they go whole. The restore checks everything again.
 */
const DROPPED = new Set(['action', 'live', 'swatches', 'props']);

function strip(key: string, value: unknown): unknown {
  if (DROPPED.has(key)) return undefined;
  if (key === 'blocks' && Array.isArray(value)) return value.filter((block: { type?: unknown }) => block?.type !== 'chips');
  return value;
}

/** The snapshot as JSON: the last 50 finished entries, stripped, and the rest of the page's state. */
export function snapshotJson(source: SnapshotSource, now: number): string | null {
  let entries = source.entries
    .filter((entry) => entry.state !== 'running')
    .slice(-STORAGE_LIMITS.sessionEntries)
    .map(({ prompt, line, blocks, status, state }) => ({ prompt, line, blocks, status, state }));
  const rest = {
    v: 1,
    savedAt: now,
    line: source.line ?? '',
    cwd: source.cwd,
    scroll: { top: Math.max(0, Math.round(source.scroll.top)), atBottom: source.scroll.atBottom },
  };
  for (;;) {
    let text: string;
    try {
      text = JSON.stringify({ ...rest, entries }, strip);
    } catch {
      return null;
    }
    if (text.length <= SNAPSHOT_MAX_CHARS) return text;
    if (entries.length === 0) return null;
    entries = entries.slice(Math.max(1, Math.ceil(entries.length / 4)));
  }
}

/** Saves the snapshot; false when it could not be. */
export function saveSnapshot(storage: KV<'session'>, source: SnapshotSource, now: number): boolean {
  const text = snapshotJson(source, now);
  return text !== null && storage.set(SNAPSHOT_KEY, text);
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
