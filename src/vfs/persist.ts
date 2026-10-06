// Files under ~ survive a reload (docs/plan/designs/shell-architecture.md, "Persistence"). What
// is saved is an overlay: only what the visitor changed in /home/guest, as paths to nodes, or
// whiteouts for what they deleted, on top of the seed. So:
//
// - a new deploy's seed still reaches a returning visitor: when the seed's version changes, the
//   overlay is replayed onto the new seed, and the visitor's own files win;
// - the save is small, and the VFS quota (512 KB) keeps it so;
// - it is written through the storage service under `vesen:fs:v1`, 300 ms after the last change;
// - when storage is blocked or full, everything keeps working in memory, and the visitor is told
//   once per session; every later save still tries, so freeing space starts saving again;
// - two tabs do not overwrite each other: a save reads what is stored, and replaces only the
//   paths this tab changed since it loaded;
// - stored values are checked before they are believed: an mtime out of Date's range, a mode
//   that is not a permission, or a file where the home folder should be are dropped.

import { STORAGE_KEYS } from '../services/storage-keys';
import type { KV } from '../services/types';
import { GUEST } from './identity';
import { fromSegments, isWithin, normalise, segments } from './path';
import type { NodeType, PersistedFs, VirtualFile } from './types';
import { adopt, validateName, type Vfs } from './vfs';

/** How long after the last change the overlay is saved. */
export const SAVE_DELAY_MS = 300;

/** The most the saved overlay may take, serialised. */
export const MAX_PERSISTED_BYTES = 512 * 1024;

/** Said once per session when nothing can be saved. */
export const MEMORY_NOTICE = 'vesen: storage is unavailable here, so your files and history last for this session only.';

/** Said once per session when the files under ~ are too big to save. */
export const TOO_LARGE_NOTICE = 'vesen: the files under ~ are too large to keep across reloads; remove some and they will be saved again.';

/** The latest time Date can hold, in milliseconds either side of 1970. */
const MAX_TIME = 8.64e15;

/** A changed path list longer than this is treated as a change to everything. */
const MAX_TRACKED_CHANGES = 1000;

type Entry = PersistedFs['overlay'][string];
type NodeEntry = Exclude<Entry, { readonly whiteout: true }>;
type Overlay = Record<string, Entry>;

const SAVED_TYPES: ReadonlySet<NodeType> = new Set(['file', 'directory', 'symlink']);

function child(node: VirtualFile | undefined, name: string): VirtualFile | undefined {
  const children = node?.children;
  if (children === undefined || !Object.prototype.hasOwnProperty.call(children, name)) return undefined;
  return children[name];
}

function nodeAt(tree: VirtualFile, path: string): VirtualFile | undefined {
  let node: VirtualFile | undefined = tree;
  for (const part of segments(path)) node = child(node, part);
  return node;
}

function entryOf(node: VirtualFile): NodeEntry {
  const base = { type: node.type, mode: node.mode ?? 0, mtime: node.mtime ?? 0 };
  if (node.type === 'file') return { ...base, content: node.content ?? '' };
  if (node.type === 'symlink') return { ...base, target: node.target ?? '' };
  return base;
}

/** Records `node` and everything under it as new. */
function addAll(overlay: Overlay, path: string, node: VirtualFile): void {
  if (!SAVED_TYPES.has(node.type) || node.generate !== undefined) return;
  overlay[path] = entryOf(node);
  for (const name of Object.keys(node.children ?? {})) {
    const next = child(node, name);
    if (next !== undefined) addAll(overlay, `${path}/${name}`, next);
  }
}

/**
 * What changed under `under` between the seed and the current tree: new or changed nodes, and a
 * whiteout for each seed node that is gone. A folder is recorded only when it is new or its mode
 * changed; its mtime moves with every change inside it, so it is not compared.
 */
export function diffOverlay(seed: VirtualFile, current: VirtualFile, under: string = GUEST.home): Overlay {
  const overlay: Overlay = {};
  const compare = (path: string, before: VirtualFile | undefined, after: VirtualFile | undefined): void => {
    if (after === undefined) {
      if (before !== undefined) overlay[path] = { whiteout: true };
      return;
    }
    if (before === undefined || before.type !== after.type) {
      // A replaced node hides the seed's: record the new one and all of its contents.
      addAll(overlay, path, after);
      return;
    }
    if (after.type === 'directory') {
      if ((before.mode ?? 0) !== (after.mode ?? 0)) overlay[path] = entryOf(after);
      const names = new Set([...Object.keys(before.children ?? {}), ...Object.keys(after.children ?? {})]);
      for (const name of names) compare(`${path}/${name}`, child(before, name), child(after, name));
      return;
    }
    const changed =
      (before.content ?? '') !== (after.content ?? '') ||
      (before.target ?? '') !== (after.target ?? '') ||
      (before.mode ?? 0) !== (after.mode ?? 0) ||
      (before.mtime ?? 0) !== (after.mtime ?? 0);
    if (changed) overlay[path] = entryOf(after);
  };
  compare(normalise(under), nodeAt(seed, under), nodeAt(current, under));
  return overlay;
}

/** The folder at `path`, made (as the visitor's) where it is missing or is not a folder. */
function ensureDirectory(tree: VirtualFile, path: string, mtime: number): VirtualFile {
  let node = tree;
  for (const name of segments(path)) {
    node.children ??= Object.create(null) as Record<string, VirtualFile>;
    let next = child(node, name);
    if (next === undefined || next.type !== 'directory') {
      next = { name, type: 'directory', children: Object.create(null) as Record<string, VirtualFile>, mode: 0o755, owner: GUEST.name, group: GUEST.name, mtime };
      node.children[name] = next;
    }
    node = next;
  }
  return node;
}

/**
 * Applies an overlay to a fresh seed tree, shallowest paths first; the overlay wins wherever the
 * two disagree. Entries outside `under`, or that are not well formed, are dropped.
 */
export function applyOverlay(tree: VirtualFile, overlay: Readonly<Overlay>, under: string = GUEST.home): VirtualFile {
  const root = normalise(under);
  const paths = Object.keys(overlay)
    .filter((path) => path === normalise(path) && isWithin(path, root) && path !== '/')
    .sort((a, b) => segments(a).length - segments(b).length || (a < b ? -1 : a > b ? 1 : 0));
  for (const path of paths) {
    const entry = overlay[path];
    if (entry === undefined) continue;
    const parts = segments(path);
    const name = parts.pop() as string;
    try {
      validateName(name);
    } catch {
      continue;
    }
    if ('whiteout' in entry) {
      const parent = nodeAt(tree, fromSegments(parts));
      if (parent?.children !== undefined && child(parent, name) !== undefined && path !== root) delete parent.children[name];
      continue;
    }
    // The home folder itself is always a folder: a stored file or link there is corrupt.
    if (path === root && entry.type !== 'directory') continue;
    const parent = ensureDirectory(tree, fromSegments(parts), entry.mtime);
    const children = (parent.children ??= Object.create(null) as Record<string, VirtualFile>);
    const existing = child(parent, name);
    if (existing !== undefined && existing.type === 'directory' && entry.type === 'directory') {
      existing.mode = entry.mode;
      existing.mtime = entry.mtime;
      continue;
    }
    const node: VirtualFile = { name, type: entry.type, mode: entry.mode, mtime: entry.mtime, owner: GUEST.name, group: GUEST.name };
    if (entry.type === 'directory') node.children = Object.create(null) as Record<string, VirtualFile>;
    if (entry.type === 'file') node.content = entry.content ?? '';
    if (entry.type === 'symlink') node.target = entry.target ?? '';
    children[name] = node;
  }
  return tree;
}

function isEntry(value: unknown): value is Entry {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  if (entry.whiteout === true) return true;
  if (typeof entry.type !== 'string' || !SAVED_TYPES.has(entry.type as NodeType)) return false;
  if (typeof entry.mode !== 'number' || !Number.isInteger(entry.mode) || entry.mode < 0 || entry.mode > 0o7777) return false;
  if (typeof entry.mtime !== 'number' || !Number.isFinite(entry.mtime) || Math.abs(entry.mtime) > MAX_TIME) return false;
  if (entry.content !== undefined && typeof entry.content !== 'string') return false;
  if (entry.target !== undefined && typeof entry.target !== 'string') return false;
  return true;
}

/** What `vesen:fs:v1` holds, checked; undefined for anything unreadable or of another version. */
export function readPersisted(raw: unknown): PersistedFs | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const value = raw as Record<string, unknown>;
  if (value.v !== 1 || typeof value.seedVersion !== 'string' || typeof value.savedAt !== 'number') return undefined;
  if (typeof value.overlay !== 'object' || value.overlay === null) return undefined;
  const overlay: Overlay = {};
  for (const [path, entry] of Object.entries(value.overlay as Record<string, unknown>)) {
    if (isEntry(entry)) overlay[path] = entry;
  }
  return { v: 1, seedVersion: value.seedVersion, savedAt: value.savedAt, overlay };
}

export interface Timers {
  set(run: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const defaultTimers: Timers = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface PersistenceOptions {
  readonly vfs: Vfs;
  /** null when there is no storage at all: everything lasts for the session only. */
  readonly storage: KV<'local'> | null;
  /** A fresh seed tree, the base the overlay is a difference from. */
  readonly seed: () => VirtualFile;
  readonly seedVersion: string;
  readonly under?: string;
  readonly now?: () => number;
  readonly delayMs?: number;
  readonly timers?: Timers;
  readonly maxBytes?: number;
  /** Shows the visitor a dim notice: once per session, when nothing can be saved. */
  readonly onNotice?: (message: string) => void;
}

export interface Persistence {
  /** Puts the saved overlay onto the seed. False when nothing was saved, or it was unreadable. */
  load(): boolean;
  /** Saves after each change, SAVE_DELAY_MS after the last one. */
  start(): void;
  /** Saves now, if a save is waiting. */
  flush(): void;
  /** Saves now, whether or not anything changed. */
  save(): void;
  stop(): void;
}

export function createPersistence(options: PersistenceOptions): Persistence {
  const { vfs, storage } = options;
  const under = options.under ?? GUEST.home;
  const timers = options.timers ?? defaultTimers;
  const delay = options.delayMs ?? SAVE_DELAY_MS;
  const maxBytes = options.maxBytes ?? MAX_PERSISTED_BYTES;
  const key = STORAGE_KEYS.fs.key;
  // The seed as the VFS holds it, with every default filled in, so only real changes differ.
  const base = (): VirtualFile => adopt(options.seed(), 0);
  let timer: unknown = null;
  const noticed = new Set<string>();
  let unsubscribe: (() => void) | null = null;
  /** Set while load() replaces the tree, which is not a change to save. */
  let loading = false;
  /** The paths this tab changed since it loaded, or 'all' after a reset. */
  let changed: Set<string> | 'all' = new Set();

  const notice = (message: string): void => {
    if (noticed.has(message)) return;
    noticed.add(message);
    options.onNotice?.(message);
  };

  /**
   * What to store: this tab's changes, on top of what another tab may have stored since this
   * one loaded. A path this tab changed comes from this tab; any other comes from storage.
   */
  const merged = (mine: Overlay): Overlay => {
    if (changed === 'all' || storage === null) return mine;
    const stored = storage.getJson(key, readPersisted);
    if (stored === undefined || stored.seedVersion !== options.seedVersion) return mine;
    const touched = [...changed];
    const ours = (path: string): boolean => touched.some((root) => isWithin(path, root));
    const overlay: Overlay = {};
    for (const [path, entry] of Object.entries(stored.overlay)) if (!ours(path)) overlay[path] = entry;
    for (const [path, entry] of Object.entries(mine)) if (ours(path)) overlay[path] = entry;
    return overlay;
  };

  const save = (): void => {
    if (timer !== null) {
      timers.clear(timer);
      timer = null;
    }
    if (storage === null) {
      notice(MEMORY_NOTICE);
      return;
    }
    // Tried every time, even after a failure: space may have been freed since.
    const overlay = merged(diffOverlay(base(), vfs.root, under));
    if (Object.keys(overlay).length === 0) {
      storage.remove(key);
      return;
    }
    const value: PersistedFs = { v: 1, seedVersion: options.seedVersion, savedAt: options.now?.() ?? Date.now(), overlay };
    if (JSON.stringify(value).length > maxBytes) notice(TOO_LARGE_NOTICE);
    else if (!storage.setJson(key, value)) notice(MEMORY_NOTICE);
  };

  const track = (paths: readonly string[]): void => {
    if (changed === 'all') return;
    for (const path of paths) {
      if (path === '/') {
        changed = 'all';
        return;
      }
      if (isWithin(path, under)) changed.add(path);
    }
    if (changed.size > MAX_TRACKED_CHANGES) changed = 'all';
  };

  return {
    load() {
      const stored = storage?.getJson(key, readPersisted);
      if (stored === undefined) return false;
      loading = true;
      try {
        vfs.replace(applyOverlay(base(), stored.overlay, under));
      } catch {
        // A save that cannot be put back is dropped; the session starts from the seed.
        vfs.restore();
        return false;
      } finally {
        loading = false;
      }
      // A new seed: save the overlay again against it, so entries it now matches drop out.
      if (stored.seedVersion !== options.seedVersion) save();
      return true;
    },
    start() {
      if (unsubscribe !== null) return;
      unsubscribe = vfs.onChange((paths) => {
        if (loading) return;
        // Only changes that can reach the overlay: under ~, or the whole tree (reset).
        if (!paths.some((path) => path === '/' || isWithin(path, under))) return;
        track(paths);
        if (timer !== null) timers.clear(timer);
        timer = timers.set(() => {
          timer = null;
          save();
        }, delay);
      });
    },
    flush() {
      if (timer !== null) save();
    },
    save,
    stop() {
      unsubscribe?.();
      unsubscribe = null;
      if (timer !== null) timers.clear(timer);
      timer = null;
    },
  };
}
