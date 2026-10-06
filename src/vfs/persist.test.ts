import { describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '../services/storage-keys';
import { createStorage } from '../services/storage';
import type { KV } from '../services/types';
import { applyOverlay, createPersistence, diffOverlay, MEMORY_NOTICE, readPersisted, TOO_LARGE_NOTICE, type Timers } from './persist';
import { seedTree, seedVersion } from './seed';
import type { PersistedFs, VirtualFile } from './types';
import { adopt, Vfs } from './vfs';

const NOW = Date.UTC(2026, 9, 7, 12, 0, 0);
const KEY = STORAGE_KEYS.fs.key;

/** localStorage as a Map; `blocked` makes every access throw, as Safari's private mode can. */
function fakeStorage(options: { blocked?: boolean; quotaChars?: number } = {}) {
  const items = new Map<string, string>();
  const area = {
    get length() {
      return items.size;
    },
    key: (i: number) => [...items.keys()][i] ?? null,
    getItem(key: string) {
      if (options.blocked) throw new DOMException('denied', 'SecurityError');
      return items.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      if (options.blocked) throw new DOMException('denied', 'SecurityError');
      if (options.quotaChars !== undefined && value.length > options.quotaChars) throw new DOMException('full', 'QuotaExceededError');
      items.set(key, value);
    },
    removeItem(key: string) {
      if (options.blocked) throw new DOMException('denied', 'SecurityError');
      items.delete(key);
    },
    clear: () => items.clear(),
  } as unknown as Storage;
  const kv = createStorage({ localStorage: area, sessionStorage: area } as unknown as Window).local;
  return { kv, items };
}

/** Timers run by hand. */
function manualTimers(): Timers & { run(): void; pending(): number } {
  const queue = new Map<number, () => void>();
  let next = 0;
  return {
    set(run) {
      next += 1;
      queue.set(next, run);
      return next;
    },
    clear(handle) {
      queue.delete(handle as number);
    },
    run() {
      const runs = [...queue.values()];
      queue.clear();
      for (const run of runs) run();
    },
    pending: () => queue.size,
  };
}

interface Session {
  fs: Vfs;
  persist: ReturnType<typeof createPersistence>;
  timers: ReturnType<typeof manualTimers>;
  notices: string[];
}

const SEED_OPTIONS = { version: '2.0.0', commands: [{ name: 'ls', summary: 'list directory contents' }] };

/** A page load: a fresh VFS from `seed`, with the saved overlay put back. */
function boot(storage: KV<'local'> | null, seed: () => VirtualFile = () => seedTree(SEED_OPTIONS)): Session {
  const fs = new Vfs({ seed, now: () => NOW });
  const timers = manualTimers();
  const notices: string[] = [];
  const persist = createPersistence({
    vfs: fs,
    storage,
    seed,
    seedVersion: seedVersion(seed()),
    now: () => NOW,
    timers,
    onNotice: (message) => notices.push(message),
  });
  persist.load();
  persist.start();
  return { fs, persist, timers, notices };
}

describe('the overlay', () => {
  it('records only what changed under ~, with whiteouts for what went', () => {
    const seed = adopt(seedTree(SEED_OPTIONS), 0);
    const fs = new Vfs({ seed: () => seedTree(SEED_OPTIONS), now: () => NOW });
    expect(diffOverlay(seed, fs.root)).toEqual({});

    fs.writeFile('/home/guest/notes.txt', 'hello\n');
    fs.rm('/home/guest/music', { recursive: true });
    fs.mkdir('/home/guest/a/b', { parents: true });
    fs.symlink('notes.txt', '/home/guest/n');
    fs.writeFile('/tmp/scratch', 'not saved');
    fs.writeFile('/home/guest/.bashrc', 'alias x=y\n');
    expect(diffOverlay(seed, fs.root)).toEqual({
      '/home/guest/notes.txt': { type: 'file', mode: 0o644, mtime: NOW, content: 'hello\n' },
      '/home/guest/music': { whiteout: true },
      '/home/guest/a': { type: 'directory', mode: 0o755, mtime: NOW },
      '/home/guest/a/b': { type: 'directory', mode: 0o755, mtime: NOW },
      '/home/guest/n': { type: 'symlink', mode: 0o777, mtime: NOW, target: 'notes.txt' },
      '/home/guest/.bashrc': { type: 'file', mode: 0o644, mtime: NOW, content: 'alias x=y\n' },
    });
  });

  it('applies shallowest first, makes missing folders, and drops entries outside ~', () => {
    const tree = applyOverlay(adopt(seedTree(SEED_OPTIONS), 0), {
      '/home/guest/deep/er/file': { type: 'file', mode: 0o600, mtime: 5, content: 'x' },
      '/home/guest/README.md': { whiteout: true },
      '/etc/passwd': { type: 'file', mode: 0o644, mtime: 5, content: 'root::0:0::/:/bin/sh' },
      '/home/guest/../../etc/x': { type: 'file', mode: 0o644, mtime: 5, content: 'escape' },
      '/home/guest': { whiteout: true },
    });
    const fs = new Vfs({ seed: () => tree, now: () => NOW });
    expect(fs.readFile('/home/guest/deep/er/file')).toBe('x');
    expect(fs.stat('/home/guest/deep/er/file')).toMatchObject({ mode: 0o600, owner: 'guest' });
    expect(fs.exists('/home/guest/README.md')).toBe(false);
    expect(fs.readFile('/etc/passwd')).toContain('guest:x:1000');
    expect(fs.exists('/etc/x')).toBe(false);
  });

  it('reads only well-formed saves of version 1', () => {
    expect(readPersisted(null)).toBeUndefined();
    expect(readPersisted({ v: 2, seedVersion: 'a', savedAt: 1, overlay: {} })).toBeUndefined();
    expect(readPersisted({ v: 1, seedVersion: 'a', savedAt: 1, overlay: 'nope' })).toBeUndefined();
    expect(
      readPersisted({
        v: 1,
        seedVersion: 'a',
        savedAt: 1,
        overlay: { '/home/guest/a': { type: 'file', mode: 420, mtime: 1, content: 'ok' }, '/home/guest/b': { type: 'device', mode: 1, mtime: 1 }, '/home/guest/c': { whiteout: true } },
      })?.overlay,
    ).toEqual({ '/home/guest/a': { type: 'file', mode: 420, mtime: 1, content: 'ok' }, '/home/guest/c': { whiteout: true } });
  });

  it('drops values Date and the permission bits cannot hold, and never lets a file replace ~', () => {
    const entry = (extra: Record<string, unknown>) => ({ type: 'file', mode: 420, mtime: 1, content: 'x', ...extra });
    const read = readPersisted({
      v: 1,
      seedVersion: 'a',
      savedAt: 1,
      overlay: {
        '/home/guest/ok': entry({}),
        '/home/guest/far': entry({ mtime: 1e20 }),
        '/home/guest/nan': entry({ mtime: Number.NaN }),
        '/home/guest/mode': entry({ mode: 0o70000 }),
        '/home/guest/half': entry({ mode: 4.5 }),
      },
    });
    expect(Object.keys(read?.overlay ?? {})).toEqual(['/home/guest/ok']);

    const tree = seedTree(SEED_OPTIONS);
    applyOverlay(tree, { '/home/guest': { type: 'file', mode: 420, mtime: 1, content: 'x' } }, '/home/guest');
    const fs = new Vfs({ seed: () => tree, now: () => NOW });
    expect(fs.stat('/home/guest').type).toBe('directory');
    expect(fs.exists('/home/guest/README.md')).toBe(true);
  });
});

describe('persistence across reloads', () => {
  it('round-trips: changes under ~ survive a reload, and /tmp does not', () => {
    const { kv, items } = fakeStorage();
    const first = boot(kv);
    first.fs.writeFile('/home/guest/notes.txt', 'remember me\n');
    first.fs.rm('/home/guest/videos', { recursive: true });
    first.fs.chmod('/home/guest/documents', 0o700);
    first.fs.writeFile('/tmp/scratch', 'gone after reload');
    expect(items.has(KEY)).toBe(false);
    expect(first.timers.pending()).toBe(1);
    first.timers.run();
    const saved = JSON.parse(items.get(KEY) ?? 'null') as PersistedFs;
    expect(saved).toMatchObject({ v: 1, savedAt: NOW, seedVersion: seedVersion(seedTree(SEED_OPTIONS)) });

    const second = boot(kv);
    expect(second.fs.readFile('/home/guest/notes.txt')).toBe('remember me\n');
    expect(second.fs.exists('/home/guest/videos')).toBe(false);
    expect(second.fs.stat('/home/guest/documents').mode).toBe(0o700);
    expect(second.fs.readFile('/home/guest/documents/linux.txt')).toContain('Arch Linux');
    expect(second.fs.exists('/tmp/scratch')).toBe(false);
    expect(second.notices).toEqual([]);
  });

  it('waits 300 ms after the last change, and flush saves at once', () => {
    vi.useFakeTimers();
    try {
      const { kv, items } = fakeStorage();
      const fs = new Vfs({ seed: () => seedTree(SEED_OPTIONS), now: () => NOW });
      const persist = createPersistence({ vfs: fs, storage: kv, seed: () => seedTree(SEED_OPTIONS), seedVersion: 'v' });
      persist.start();
      fs.writeFile('/home/guest/a', '1');
      vi.advanceTimersByTime(299);
      fs.writeFile('/home/guest/b', '2');
      vi.advanceTimersByTime(299);
      expect(items.has(KEY)).toBe(false);
      vi.advanceTimersByTime(1);
      expect(Object.keys((JSON.parse(items.get(KEY) ?? '{}') as PersistedFs).overlay)).toEqual(['/home/guest/a', '/home/guest/b']);
      fs.writeFile('/home/guest/c', '3');
      persist.flush();
      expect(Object.keys((JSON.parse(items.get(KEY) ?? '{}') as PersistedFs).overlay)).toContain('/home/guest/c');
      persist.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('removes the save once the files are back to the seed, as after reset', () => {
    const { kv, items } = fakeStorage();
    const session = boot(kv);
    session.fs.writeFile('/home/guest/x', 'x');
    session.timers.run();
    expect(items.has(KEY)).toBe(true);
    session.fs.restore();
    session.timers.run();
    expect(items.has(KEY)).toBe(false);
  });

  it('replays the overlay onto a new seed, the visitor\'s files winning', () => {
    const { kv, items } = fakeStorage();
    const first = boot(kv);
    first.fs.writeFile('/home/guest/README.md', 'my own readme\n');
    first.fs.writeFile('/home/guest/mine.txt', 'mine\n');
    first.fs.rm('/home/guest/pictures', { recursive: true });
    first.timers.run();
    const oldVersion = (JSON.parse(items.get(KEY) ?? '{}') as PersistedFs).seedVersion;

    // The next deploy changes README.md and history.txt, and adds a file.
    const newSeed = (): VirtualFile => {
      const tree = seedTree(SEED_OPTIONS);
      const home = tree.children?.home?.children?.guest;
      if (home?.children) {
        const readme = home.children['README.md'];
        const history = home.children['history.txt'];
        if (readme) readme.content = 'the new seed readme\n';
        if (history) history.content = 'new history\n';
        home.children['CHANGELOG.md'] = { name: 'CHANGELOG.md', type: 'file', content: 'v2\n' };
      }
      return tree;
    };
    const second = boot(kv, newSeed);
    expect(second.fs.readFile('/home/guest/README.md')).toBe('my own readme\n');
    expect(second.fs.readFile('/home/guest/mine.txt')).toBe('mine\n');
    expect(second.fs.exists('/home/guest/pictures')).toBe(false);
    expect(second.fs.readFile('/home/guest/history.txt')).toBe('new history\n');
    expect(second.fs.readFile('/home/guest/CHANGELOG.md')).toBe('v2\n');
    // Saved again at once against the new seed.
    const resaved = JSON.parse(items.get(KEY) ?? '{}') as PersistedFs;
    expect(resaved.seedVersion).not.toBe(oldVersion);
    expect(resaved.seedVersion).toBe(seedVersion(newSeed()));
  });

  it('ignores a corrupt save and starts from the seed', () => {
    const { kv, items } = fakeStorage();
    items.set(KEY, '{not json');
    const session = boot(kv);
    expect(session.fs.exists('/home/guest/README.md')).toBe(true);
    expect(session.notices).toEqual([]);
  });

  it('falls back to memory with one notice when storage throws', () => {
    const { kv } = fakeStorage({ blocked: true });
    const session = boot(kv);
    expect(kv.persistent).toBe(false);
    session.fs.writeFile('/home/guest/a', '1');
    session.timers.run();
    session.fs.writeFile('/home/guest/b', '2');
    session.timers.run();
    // Everything still works for the session.
    expect(session.fs.readFile('/home/guest/a')).toBe('1');
    expect(session.notices).toEqual([MEMORY_NOTICE]);
  });

  it('says so once when there is no storage at all, or a save does not fit', () => {
    const none = boot(null);
    none.fs.writeFile('/home/guest/a', '1');
    none.timers.run();
    expect(none.notices).toEqual([MEMORY_NOTICE]);

    const { kv } = fakeStorage({ quotaChars: 2000 });
    const full = boot(kv);
    full.fs.writeFile('/home/guest/big', 'x'.repeat(5000));
    full.timers.run();
    full.fs.writeFile('/home/guest/big2', 'y');
    full.timers.run();
    expect(full.notices).toEqual([MEMORY_NOTICE]);
  });

  it('tries every save again after one fails, so freeing space saves again', () => {
    const { kv, items } = fakeStorage({ quotaChars: 4000 });
    const session = boot(kv);
    session.fs.writeFile('/home/guest/one', '1');
    session.timers.run();
    expect(items.get(KEY)).toContain('/home/guest/one');
    session.fs.writeFile('/home/guest/big', 'x'.repeat(5000));
    session.timers.run();
    expect(items.get(KEY)).not.toContain('/home/guest/big');
    expect(kv.persistent).toBe(true);
    session.fs.rm('/home/guest/big');
    session.fs.writeFile('/home/guest/two', '2');
    session.timers.run();
    expect(items.get(KEY)).toContain('/home/guest/two');
    expect(boot(kv).fs.readFile('/home/guest/two')).toBe('2');
    expect(session.notices).toEqual([MEMORY_NOTICE]);
  });

  it('says the files are too large, not that storage is missing, when the overlay outgrows the cap', () => {
    const { kv, items } = fakeStorage();
    const fs = new Vfs({ seed: () => seedTree(SEED_OPTIONS), now: () => NOW });
    const notices: string[] = [];
    const seed = () => seedTree(SEED_OPTIONS);
    const persist = createPersistence({ vfs: fs, storage: kv, seed, seedVersion: seedVersion(seed()), now: () => NOW, timers: manualTimers(), maxBytes: 2000, onNotice: (m) => notices.push(m) });
    persist.load();
    persist.start();
    fs.writeFile('/home/guest/big', 'x'.repeat(3000));
    persist.flush();
    expect(notices).toEqual([TOO_LARGE_NOTICE]);
    expect(items.has(KEY)).toBe(false);
  });

  it('keeps what another tab saved: each tab replaces only the paths it changed', () => {
    const { kv } = fakeStorage();
    const a = boot(kv);
    const b = boot(kv);
    a.fs.writeFile('/home/guest/a.txt', 'from a');
    a.persist.flush();
    b.fs.writeFile('/home/guest/b.txt', 'from b');
    b.fs.rm('/home/guest/history.txt');
    b.persist.flush();
    a.fs.writeFile('/home/guest/a.txt', 'from a, again');
    a.persist.flush();
    const c = boot(kv);
    expect(c.fs.readFile('/home/guest/a.txt')).toBe('from a, again');
    expect(c.fs.readFile('/home/guest/b.txt')).toBe('from b');
    expect(c.fs.exists('/home/guest/history.txt')).toBe(false);
    // A file a tab removes goes from storage too, even one another tab made.
    c.fs.rm('/home/guest/b.txt');
    c.persist.flush();
    expect(boot(kv).fs.exists('/home/guest/b.txt')).toBe(false);
  });

  it('keeps the 512 KB cap: a write past it fails with ENOSPC, and the save still fits', () => {
    const { kv, items } = fakeStorage();
    const session = boot(kv);
    const out = session.fs.openWrite('/home/guest/big', { append: false, noclobber: false });
    expect(() => {
      for (;;) out.write('z'.repeat(32 * 1024));
    }).toThrow(expect.objectContaining({ code: 'ENOSPC' }));
    session.timers.run();
    expect((items.get(KEY) ?? '').length).toBeLessThanOrEqual(512 * 1024);
    expect(session.notices).toEqual([]);
  });
});
