// nano's unsaved buffers, kept where Back cannot lose them. The editor hands its buffer over when
// Back makes it ask 'Save modified buffer?' and when the page is put away with changes (a Back
// that leaves vesen, an app switch, a tab the phone discards), and lets go of it once the buffer
// is saved or discarded. The next nano of that file offers it back, as nano offers what it wrote
// to FILE.save. They are in local storage, so they outlast an in-app browser that Back closes;
// reset forgets them (app/shell.ts), and so does a month.

import { STORAGE_KEYS } from '../../services/storage-keys';
import { localStore } from './local-store';

/** How long a kept buffer is offered. */
export const KEEP_MS = 30 * 86_400_000;
/** The most buffers kept; the oldest gives way. */
export const MAX_KEPT = 8;
/** The most characters kept in all, well inside what a browser stores for a page. */
export const MAX_KEPT_CHARS = 1_000_000;

interface Kept {
  readonly text: string;
  readonly at: number;
}

interface Stored {
  readonly v: 1;
  /** By absolute path; '' is a buffer with no name. */
  readonly buffers: Readonly<Record<string, Kept>>;
}

function readStored(raw: unknown): Stored | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const { v, buffers } = raw as Partial<Record<keyof Stored, unknown>>;
  if (v !== 1 || typeof buffers !== 'object' || buffers === null) return undefined;
  const found: Record<string, Kept> = {};
  for (const [path, entry] of Object.entries(buffers)) {
    const { text, at } = (typeof entry === 'object' && entry !== null ? entry : {}) as Partial<Record<keyof Kept, unknown>>;
    if (typeof text === 'string' && typeof at === 'number' && Number.isFinite(at)) found[path] = { text, at };
  }
  return { v: 1, buffers: found };
}

/** What is kept and still fresh at `now`, newest first. */
function fresh(now: number): [string, Kept][] {
  const stored = localStore()?.getJson(STORAGE_KEYS.nano.key, readStored);
  return Object.entries(stored?.buffers ?? {})
    .filter(([, kept]) => kept.at <= now && now - kept.at < KEEP_MS)
    .sort(([, a], [, b]) => b.at - a.at);
}

function store(buffers: readonly [string, Kept][]): void {
  const kv = localStore();
  if (kv === null) return;
  if (buffers.length === 0) kv.remove(STORAGE_KEYS.nano.key);
  else kv.setJson(STORAGE_KEYS.nano.key, { v: 1, buffers: Object.fromEntries(buffers) } satisfies Stored);
}

/** The buffer kept for `path` ('' for one with no name), or null. */
export function keptBuffer(path: string, now: number): string | null {
  return fresh(now).find(([kept]) => kept === path)?.[1].text ?? null;
}

/** Keeps `text` for `path`, or forgets what is kept for it when `text` is null. Never throws. */
export function keepBuffer(path: string, text: string | null, now: number): void {
  try {
    const others = fresh(now).filter(([kept]) => kept !== path);
    if (text === null || text.length > MAX_KEPT_CHARS) {
      store(others);
      return;
    }
    const kept: [string, Kept][] = [[path, { text, at: now }]];
    let size = text.length;
    for (const entry of others) {
      if (kept.length >= MAX_KEPT || size + entry[1].text.length > MAX_KEPT_CHARS) break;
      kept.push(entry);
      size += entry[1].text.length;
    }
    store(kept);
  } catch {
    // Storage that refuses is no worse than none.
  }
}
