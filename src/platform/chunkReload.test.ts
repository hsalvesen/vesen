import { describe, expect, it, vi } from 'vitest';
import { CHUNK_RELOAD_KEY, installChunkReload, type ReloadTarget } from './chunkReload';

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
