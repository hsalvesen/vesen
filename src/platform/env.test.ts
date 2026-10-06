import { describe, expect, it } from 'vitest';
import { coarsePointer, dockWanted, keyPlatform } from './env';

const page = (coarse: boolean, search = '') => ({
  matchMedia: (query: string) => ({ matches: coarse && query === '(pointer: coarse)' }) as MediaQueryList,
  location: { search },
});

describe('dockWanted', () => {
  it('shows the dock on a touch screen, and with ?dock=1 anywhere; ?dock=0 turns it off', () => {
    expect(dockWanted(page(true))).toBe(true);
    expect(dockWanted(page(false))).toBe(false);
    expect(dockWanted(page(false, '?dock=1'))).toBe(true);
    expect(dockWanted(page(true, '?env=ig&dock=0'))).toBe(false);
    expect(dockWanted(undefined)).toBe(false);
  });
});

describe('coarsePointer and keyPlatform', () => {
  it('read the pointer and the platform, never throwing', () => {
    expect(coarsePointer(page(true))).toBe(true);
    expect(coarsePointer({ matchMedia: () => { throw new Error('no'); } })).toBe(false);
    expect(keyPlatform({ platform: 'MacIntel' })).toBe('mac');
    expect(keyPlatform({ userAgent: 'Mozilla/5.0 (Linux; Android 14)' })).toBe('other');
  });
});
