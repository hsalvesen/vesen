import { describe, expect, it } from 'vitest';
import { dropLegacyKeys } from './legacyKeys';

class MemoryStorage {
  readonly items = new Map<string, string>();
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
}

const tab = (storage: () => MemoryStorage) =>
  ({
    get localStorage() {
      return storage();
    },
  }) as unknown as Pick<Window, 'localStorage'>;

describe('dropLegacyKeys', () => {
  it('removes the old session keys and leaves the ones still in use', () => {
    const storage = new MemoryStorage();
    storage.setItem('history', JSON.stringify([{ command: 'echo my secret note', outputs: [] }]));
    storage.setItem('commandHistory', JSON.stringify(['echo my secret note']));
    // The theme and CRT stores still read these until services/storage.ts migrates them.
    storage.setItem('colorscheme', '{"name":"vesen"}');
    storage.setItem('cathode', 'scanlines');

    dropLegacyKeys(tab(() => storage));

    expect([...storage.items.keys()].sort()).toEqual(['cathode', 'colorscheme']);
  });

  it('does nothing when storage is blocked', () => {
    const blocked = tab(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    });
    expect(() => dropLegacyKeys(blocked)).not.toThrow();
  });
});
