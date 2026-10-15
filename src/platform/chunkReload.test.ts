import { describe, expect, it, vi } from 'vitest';
import { createStorage, type StorageHost } from '../services/storage';
import type { KV } from '../services/types';
import { CHUNK_RELOAD_KEY, UPDATE_NOTICE, buildGone, installChunkReload, type ReloadTarget } from './chunkReload';

class MemoryStorage {
  readonly items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
}

/** The tab's sessionStorage through the storage service, as bootstrap builds it. */
function sessionArea(storage: () => MemoryStorage): KV<'session'> {
  const host = {
    get sessionStorage() {
      return storage();
    },
    get localStorage() {
      return storage();
    },
  } as unknown as StorageHost;
  return createStorage(host).session;
}

/** What the server says of the build's entry chunk: a status, or a fetch that fails. */
type Server = number | 'unreachable';

function fakeWindow(storage: () => MemoryStorage, server: Server = 404) {
  const events = new EventTarget();
  const reload = vi.fn();
  const session = sessionArea(storage);
  const fetch = vi.fn(async (_input: string, _init?: RequestInit) => {
    if (server === 'unreachable') throw new TypeError('Load failed');
    return new Response(null, { status: server });
  });
  const target = {
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    location: { reload },
    fetch,
    // Frames and timeouts run at once, so each test sees the reload once the answer is in.
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    },
    setTimeout: (callback: () => void) => {
      callback();
      return 1;
    },
  } as unknown as ReloadTarget;

  /** Dispatches a preload error the way Vite's preload helper does; true if it was swallowed. */
  const preloadError = () => {
    const event = new Event('vite:preloadError', { cancelable: true });
    events.dispatchEvent(event);
    return event.defaultPrevented;
  };
  return { target, session, reload, fetch, preloadError };
}

/** Lets the server's answer arrive and the tab act on it. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('installChunkReload', () => {
  it('reloads once a deploy has taken the build away, once per build', async () => {
    const storage = new MemoryStorage();
    const tab = fakeWindow(() => storage, 404);
    installChunkReload(tab.target, tab.session, '/assets/index-old.js');

    tab.preloadError();
    await settle();
    expect(tab.reload).toHaveBeenCalledTimes(1);
    expect(storage.getItem(CHUNK_RELOAD_KEY)).toBe('/assets/index-old.js');

    tab.preloadError();
    await settle();
    expect(tab.reload).toHaveBeenCalledTimes(1);
  });

  it('takes a 410 as gone too', async () => {
    const tab = fakeWindow(() => new MemoryStorage(), 410);
    installChunkReload(tab.target, tab.session, '/assets/index-old.js');

    tab.preloadError();
    await settle();
    expect(tab.reload).toHaveBeenCalledTimes(1);
  });

  // A chunk cut off by Back, or by a connection that dropped, while the build is still deployed:
  // a reload would undo the visitor's Back, so the error is the importer's alone.
  it('leaves the page alone while the build is still there', async () => {
    const storage = new MemoryStorage();
    const tab = fakeWindow(() => storage, 200);
    const announce = vi.fn();
    installChunkReload(tab.target, tab.session, '/assets/index-old.js', announce);

    tab.preloadError();
    await settle();
    expect(tab.reload).not.toHaveBeenCalled();
    expect(announce).not.toHaveBeenCalled();
    // Still free to reload for this build should a deploy take it away later.
    expect(storage.getItem(CHUNK_RELOAD_KEY)).toBeNull();
  });

  it('leaves the page alone when it cannot ask', async () => {
    const tab = fakeWindow(() => new MemoryStorage(), 'unreachable');
    const announce = vi.fn();
    installChunkReload(tab.target, tab.session, '/assets/index-old.js', announce);

    tab.preloadError();
    await settle();
    expect(tab.reload).not.toHaveBeenCalled();
    expect(announce).not.toHaveBeenCalled();
  });

  it('lets every error through to its importer, which says what could not load', async () => {
    for (const server of [404, 200, 'unreachable'] as const) {
      const tab = fakeWindow(() => new MemoryStorage(), server);
      installChunkReload(tab.target, tab.session, '/assets/index-old.js');
      expect(tab.preloadError()).toBe(false);
      await settle();
    }
  });

  it("asks for the build's entry chunk with HEAD, past the cache, in a request that outlives the page", async () => {
    const tab = fakeWindow(() => new MemoryStorage(), 200);
    installChunkReload(tab.target, tab.session, '/assets/index-old.js');

    tab.preloadError();
    await settle();
    expect(tab.fetch).toHaveBeenCalledTimes(1);
    expect(tab.fetch).toHaveBeenCalledWith('/assets/index-old.js', expect.objectContaining({ method: 'HEAD', cache: 'no-store', keepalive: true }));
  });

  it('asks once for errors that arrive while it is asking', async () => {
    const tab = fakeWindow(() => new MemoryStorage(), 200);
    installChunkReload(tab.target, tab.session, '/assets/index-old.js');

    tab.preloadError();
    tab.preloadError();
    tab.preloadError();
    await settle();
    expect(tab.fetch).toHaveBeenCalledTimes(1);

    // A later error asks again: a deploy may have happened since.
    tab.preloadError();
    await settle();
    expect(tab.fetch).toHaveBeenCalledTimes(2);
  });

  it('tells the visitor before reloading, and reloads only after the next frame', async () => {
    const storage = new MemoryStorage();
    const tab = fakeWindow(() => storage, 404);
    const order: string[] = [];
    const frames: FrameRequestCallback[] = [];
    tab.target.requestAnimationFrame = (callback) => frames.push(callback);
    tab.reload.mockImplementation(() => order.push('reload'));
    installChunkReload(tab.target, tab.session, '/assets/index-old.js', (message) => order.push(message));

    tab.preloadError();
    await settle();
    expect(order).toEqual([UPDATE_NOTICE]);

    for (const frame of frames) frame(0);
    expect(order).toEqual([UPDATE_NOTICE, 'reload']);
    expect(UPDATE_NOTICE).toBe('vesen was updated, reloading...');
  });

  it('says nothing when it will not reload', async () => {
    const storage = new MemoryStorage();
    storage.setItem(CHUNK_RELOAD_KEY, '/assets/index-old.js');
    const tab = fakeWindow(() => storage, 404);
    const announce = vi.fn();
    installChunkReload(tab.target, tab.session, '/assets/index-old.js', announce);

    tab.preloadError();
    await settle();
    expect(tab.reload).not.toHaveBeenCalled();
    expect(announce).not.toHaveBeenCalled();
  });

  it('reloads again for a newer build in the same tab session', async () => {
    const storage = new MemoryStorage();
    storage.setItem(CHUNK_RELOAD_KEY, '/assets/index-old.js');
    const tab = fakeWindow(() => storage, 404);
    installChunkReload(tab.target, tab.session, '/assets/index-new.js');

    tab.preloadError();
    await settle();
    expect(tab.reload).toHaveBeenCalledTimes(1);
  });

  it('never reloads when sessionStorage is blocked', async () => {
    const tab = fakeWindow(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    }, 404);
    installChunkReload(tab.target, tab.session, '/assets/index-old.js');

    tab.preloadError();
    await settle();
    expect(tab.reload).not.toHaveBeenCalled();
  });

  it('never asks or reloads offline, where the reload would fail too', async () => {
    const storage = new MemoryStorage();
    const tab = fakeWindow(() => storage, 404);
    const announce = vi.fn();
    const offline = { ...tab.target, navigator: { onLine: false } };
    installChunkReload(offline, tab.session, '/assets/index-old.js', announce);

    tab.preloadError();
    await settle();
    expect(tab.fetch).not.toHaveBeenCalled();
    expect(tab.reload).not.toHaveBeenCalled();
    expect(announce).not.toHaveBeenCalled();
    // Still free to reload for this build once the connection is back.
    expect(storage.getItem(CHUNK_RELOAD_KEY)).toBeNull();
  });

  it('stops listening once uninstalled', async () => {
    const tab = fakeWindow(() => new MemoryStorage(), 404);
    const uninstall = installChunkReload(tab.target, tab.session, '/assets/index-old.js');
    uninstall();

    tab.preloadError();
    await settle();
    expect(tab.fetch).not.toHaveBeenCalled();
    expect(tab.reload).not.toHaveBeenCalled();
  });

  it('drops an answer that arrives after it was uninstalled', async () => {
    const tab = fakeWindow(() => new MemoryStorage(), 404);
    const announce = vi.fn();
    const uninstall = installChunkReload(tab.target, tab.session, '/assets/index-old.js', announce);

    tab.preloadError();
    uninstall();
    await settle();
    expect(tab.reload).not.toHaveBeenCalled();
    expect(announce).not.toHaveBeenCalled();
  });

  it('never reloads when the flag cannot be written', async () => {
    const storage = new MemoryStorage();
    storage.setItem = () => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    };
    const tab = fakeWindow(() => storage, 404);
    installChunkReload(tab.target, tab.session, '/assets/index-old.js');

    tab.preloadError();
    await settle();
    expect(tab.reload).not.toHaveBeenCalled();
  });
});

describe('buildGone', () => {
  const answering = (answer: () => Promise<Response>) => ({ fetch: vi.fn(answer) }) as unknown as Pick<Window, 'fetch'>;

  it.each([
    [404, true],
    [410, true],
    [200, false],
    [304, false],
    [500, false],
    [503, false],
  ])('a %i says gone: %s', async (status, gone) => {
    expect(await buildGone(answering(async () => new Response(null, { status })), '/assets/index-old.js')).toBe(gone);
  });

  it('is false when the request fails or fetch throws', async () => {
    expect(await buildGone(answering(() => Promise.reject(new TypeError('Load failed'))), '/assets/index-old.js')).toBe(false);
    const throwing = {
      fetch: () => {
        throw new TypeError('fetch is not allowed here');
      },
    } as unknown as Pick<Window, 'fetch'>;
    expect(await buildGone(throwing, '/assets/index-old.js')).toBe(false);
  });
});
