import { describe, expect, it } from 'vitest';
import { coarsePointer, detectInApp, detectOs, dockWanted, keyPlatform, linkEnv } from './env';

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

describe('the in-app browser and the system, for links', () => {
  it('finds Instagram, Facebook and TikTok by their user agent tokens, and nothing else', () => {
    expect(detectInApp('Mozilla/5.0 (iPhone) Mobile/15E148 Instagram 300.0.0.0.0 (iPhone14,5; iOS 17_5)')).toBe('instagram');
    expect(detectInApp('Mozilla/5.0 (Linux; Android 14; wv) Chrome/127 Mobile Safari/537.36 Instagram 343.0.0.38.94 Android')).toBe('instagram');
    expect(detectInApp('Mozilla/5.0 (iPhone) [FBAN/FBIOS;FBAV/450.0.0.0]')).toBe('facebook');
    expect(detectInApp('Mozilla/5.0 (Linux; Android 14) [FB_IAB/FB4A;FBAV/450.0.0.0;]')).toBe('facebook');
    expect(detectInApp('Mozilla/5.0 (iPhone) musical_ly_34.0.0 JsSdk/2.0')).toBe('tiktok');
    // A Chrome Custom Tab is Chrome.
    expect(detectInApp('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36')).toBeNull();
  });

  it('tells iOS (iPadOS included) from Android, and a desktop by its pointer', () => {
    expect(detectOs('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)')).toBe('ios');
    expect(detectOs('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15', 5)).toBe('ios');
    expect(detectOs('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15', 0)).toBe('other');
    expect(detectOs('Mozilla/5.0 (Linux; Android 14; Pixel 7)')).toBe('android');
    expect(linkEnv('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141.0')).toEqual({ inApp: null, os: 'other', desktop: true });
    expect(linkEnv('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141.0', { coarsePointer: true }).desktop).toBe(false);
    expect(linkEnv('Mozilla/5.0 (Linux; Android 14; Pixel 7) Chrome/141.0 Mobile').desktop).toBe(false);
  });
});
