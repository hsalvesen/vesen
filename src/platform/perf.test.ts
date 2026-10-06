// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { decideTier, inAppBrowser, NO_SIGNALS, readSignals, scanlineGeometry, startPerf, type PerfSignals } from './perf';

const INSTAGRAM_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 300.0.0.0.0';

const signals = (changes: Partial<PerfSignals>): PerfSignals => ({ ...NO_SIGNALS, ...changes });

afterEach(() => {
  vi.restoreAllMocks();
  document.documentElement.removeAttribute('class');
  document.documentElement.removeAttribute('style');
});

describe('decideTier', () => {
  it('gives a desktop the full effect', () => {
    expect(decideTier(NO_SIGNALS)).toEqual({ tier: 'full', reason: 'a desktop with a mouse or trackpad', quality: 'auto' });
  });

  it.each([
    ['a touch screen', { coarsePointer: true }],
    ["in Instagram's in-app browser", { inApp: 'Instagram' }],
    ['Data Saver is on', { saveData: true }],
    ['the device has 2 GB of memory', { deviceMemory: 2 }],
    ['the device has 0.5 GB of memory', { deviceMemory: 0.5 }],
  ] as const)('gives the lite tier for %s', (reason, changes) => {
    expect(decideTier(signals(changes))).toEqual({ tier: 'lite', reason, quality: 'auto' });
  });

  it('keeps the full effect with 4 GB of memory', () => {
    expect(decideTier(signals({ deviceMemory: 4 })).tier).toBe('full');
  });

  it.each([
    ['the system asks for reduced motion', { reducedMotion: true }],
    ['the system asks for more contrast', { moreContrast: true }],
    ['forced colours are on', { forcedColors: true }],
    ['the system asks for reduced transparency', { reducedTransparency: true }],
  ] as const)('turns the effect off when %s, even on a phone', (reason, changes) => {
    expect(decideTier(signals({ ...changes, coarsePointer: true, inApp: 'Instagram' }))).toEqual({ tier: 'off', reason, quality: 'auto' });
  });

  it('lets the quality setting override the device', () => {
    expect(decideTier(signals({ reducedMotion: true }), 'full')).toEqual({
      tier: 'full',
      reason: 'set with cathode quality full',
      quality: 'full',
    });
    expect(decideTier(NO_SIGNALS, 'lite').tier).toBe('lite');
    expect(decideTier(NO_SIGNALS, 'off').tier).toBe('off');
    expect(decideTier(signals({ coarsePointer: true }), 'auto').tier).toBe('lite');
  });
});

describe('inAppBrowser', () => {
  it('knows Instagram, Facebook and TikTok by their user agent tokens', () => {
    expect(inAppBrowser(INSTAGRAM_UA)).toBe('Instagram');
    expect(inAppBrowser('Mozilla/5.0 (iPhone) [FBAN/FBIOS;FBAV/450.0.0.0]')).toBe('Facebook');
    expect(inAppBrowser('Mozilla/5.0 (Linux; Android 14) [FB_IAB/FB4A;FBAV/450.0.0.0;]')).toBe('Facebook');
    expect(inAppBrowser('Mozilla/5.0 (iPhone) musical_ly_34.0.0 JsSdk/2.0')).toBe('TikTok');
    expect(inAppBrowser('Mozilla/5.0 (Macintosh) Chrome/141.0 Safari/537.36')).toBeNull();
  });
});

describe('scanlineGeometry', () => {
  it('uses whole device pixels, about 3 CSS px apart', () => {
    expect(scanlineGeometry(1)).toEqual({ period: '3px', line: '2px' });
    expect(scanlineGeometry(2)).toEqual({ period: '3px', line: '1.5px' });
    expect(scanlineGeometry(3)).toEqual({ period: '3px', line: '1.6667px' });
    // A Pixel 7: 8 device pixels, 4 of them lit.
    expect(scanlineGeometry(2.625)).toEqual({ period: '3.0476px', line: '1.5238px' });
    expect(scanlineGeometry(Number.NaN)).toEqual({ period: '3px', line: '2px' });
  });
});

/** A matchMedia whose answers the test sets, with listeners it can fire. */
function fakeMedia(initial: Record<string, boolean>) {
  const state = new Map(Object.entries(initial));
  const listeners = new Map<string, Set<() => void>>();
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        media: query,
        get matches() {
          return state.get(query) ?? false;
        },
        addEventListener: (_: string, listener: () => void) => {
          const set = listeners.get(query) ?? new Set();
          set.add(listener);
          listeners.set(query, set);
        },
        removeEventListener: (_: string, listener: () => void) => listeners.get(query)?.delete(listener),
      }) as unknown as MediaQueryList,
  );
  return {
    set(query: string, matches: boolean) {
      state.set(query, matches);
      for (const listener of listeners.get(query) ?? []) listener();
    },
    count: () => [...listeners.values()].reduce((n, set) => n + set.size, 0),
  };
}

describe('readSignals and startPerf', () => {
  it('reads the media queries, the user agent, Save-Data and memory', () => {
    fakeMedia({ '(pointer: coarse)': true, '(prefers-contrast: more)': true });
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(INSTAGRAM_UA);
    Object.defineProperty(navigator, 'connection', { configurable: true, value: Object.assign(new EventTarget(), { saveData: true }) });
    Object.defineProperty(navigator, 'deviceMemory', { configurable: true, value: 2 });
    try {
      expect(readSignals(window)).toEqual({
        reducedMotion: false,
        moreContrast: true,
        forcedColors: false,
        reducedTransparency: false,
        coarsePointer: true,
        inApp: 'Instagram',
        saveData: true,
        deviceMemory: 2,
      });
    } finally {
      Reflect.deleteProperty(navigator, 'connection');
      Reflect.deleteProperty(navigator, 'deviceMemory');
    }
  });

  it('reports now and on every change, sizes the scanlines, and stops cleanly', () => {
    const media = fakeMedia({});
    const seen: PerfSignals[] = [];
    const stop = startPerf(window, (next) => seen.push(next));
    expect(seen).toHaveLength(1);
    expect(document.documentElement.style.getPropertyValue('--crt-scan-period')).toMatch(/px$/);

    media.set('(prefers-reduced-motion: reduce)', true);
    expect(seen.at(-1)?.reducedMotion).toBe(true);
    expect(decideTier(seen.at(-1) ?? NO_SIGNALS).tier).toBe('off');

    stop();
    expect(media.count()).toBe(0);
    media.set('(prefers-reduced-motion: reduce)', false);
    expect(seen).toHaveLength(2);
  });
});
