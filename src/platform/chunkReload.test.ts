import { describe, expect, it, vi } from 'vitest';
import { CHUNK_RELOAD_KEY, UPDATE_NOTICE, installChunkReload, type ReloadTarget } from './chunkReload';

class MemoryStorage {
  readonly items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
}

function fakeWindow(storage: () => MemoryStorage) {
  const events = new EventTarget();
  const reload = vi.fn();
  const target = {
    addEventListener: events.addEventListener.bind(events),
    get sessionStorage() {
      return storage();
    },
    location: { reload },
    // Frames and timeouts run at once, so each test sees the reload synchronously.
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
  return { target, reload, preloadError };
}

describe('installChunkReload', () => {
  it('reloads once per build and then lets the error through', () => {
    const storage = new MemoryStorage();
    const tab = fakeWindow(() => storage);
    installChunkReload(tab.target, '/assets/index-old.js');

    expect(tab.preloadError()).toBe(true);
    expect(tab.reload).toHaveBeenCalledTimes(1);
    expect(storage.getItem(CHUNK_RELOAD_KEY)).toBe('/assets/index-old.js');

    expect(tab.preloadError()).toBe(false);
    expect(tab.reload).toHaveBeenCalledTimes(1);
  });

  it('tells the visitor before reloading, and reloads only after the next frame', () => {
    const storage = new MemoryStorage();
    const tab = fakeWindow(() => storage);
    const order: string[] = [];
    const frames: FrameRequestCallback[] = [];
    tab.target.requestAnimationFrame = (callback) => frames.push(callback);
    tab.reload.mockImplementation(() => order.push('reload'));
    installChunkReload(tab.target, '/assets/index-old.js', (message) => order.push(message));

    expect(tab.preloadError()).toBe(true);
    expect(order).toEqual([UPDATE_NOTICE]);

    for (const frame of frames) frame(0);
    expect(order).toEqual([UPDATE_NOTICE, 'reload']);
    expect(UPDATE_NOTICE).toBe('vesen was updated, reloading…');
  });

  it('says nothing when it will not reload', () => {
    const storage = new MemoryStorage();
    storage.setItem(CHUNK_RELOAD_KEY, '/assets/index-old.js');
    const tab = fakeWindow(() => storage);
    const announce = vi.fn();
    installChunkReload(tab.target, '/assets/index-old.js', announce);

    expect(tab.preloadError()).toBe(false);
    expect(announce).not.toHaveBeenCalled();
  });

  it('reloads again for a newer build in the same tab session', () => {
    const storage = new MemoryStorage();
    storage.setItem(CHUNK_RELOAD_KEY, '/assets/index-old.js');
    const tab = fakeWindow(() => storage);
    installChunkReload(tab.target, '/assets/index-new.js');

    expect(tab.preloadError()).toBe(true);
    expect(tab.reload).toHaveBeenCalledTimes(1);
  });

  it('never reloads when sessionStorage is blocked', () => {
    const tab = fakeWindow(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    });
    installChunkReload(tab.target, '/assets/index-old.js');

    expect(tab.preloadError()).toBe(false);
    expect(tab.reload).not.toHaveBeenCalled();
  });

  it('never reloads when the flag cannot be written', () => {
    const storage = new MemoryStorage();
    storage.setItem = () => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    };
    const tab = fakeWindow(() => storage);
    installChunkReload(tab.target, '/assets/index-old.js');

    expect(tab.preloadError()).toBe(false);
    expect(tab.reload).not.toHaveBeenCalled();
  });
});
