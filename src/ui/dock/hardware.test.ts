import { describe, expect, it } from 'vitest';
import { appleTouch, isPhysicalKey, type KeyPressFacts } from './hardware';

const key = (key: string, extra: Partial<KeyPressFacts> = {}): KeyPressFacts => ({
  key,
  keyCode: key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  isComposing: false,
  ...extra,
});

describe('isPhysicalKey', () => {
  it('counts the keys no on-screen keyboard has, and chords', () => {
    for (const name of ['Tab', 'Escape', 'ArrowUp', 'ArrowLeft', 'Home', 'PageDown', 'F5']) {
      expect(isPhysicalKey(key(name), true), name).toBe(true);
    }
    expect(isPhysicalKey(key('c', { ctrlKey: true }), true)).toBe(true);
    expect(isPhysicalKey(key('r', { metaKey: true }), false)).toBe(true);
    // A modifier on its own is not yet a chord.
    expect(isPhysicalKey(key('Control', { ctrlKey: true }), false)).toBe(false);
  });

  it("never counts Enter, Backspace, a composing key or Android's 229", () => {
    expect(isPhysicalKey(key('Enter', { keyCode: 13 }), false)).toBe(false);
    expect(isPhysicalKey(key('Backspace', { keyCode: 8 }), false)).toBe(false);
    expect(isPhysicalKey(key('a', { keyCode: 229 }), false)).toBe(false);
    expect(isPhysicalKey(key('Unidentified'), false)).toBe(false);
    expect(isPhysicalKey(key('a', { isComposing: true }), false)).toBe(false);
  });

  it("counts a typed letter with a real key code, except on Apple's touch screens, whose keyboard sends one too", () => {
    expect(isPhysicalKey(key('a'), false)).toBe(true);
    expect(isPhysicalKey(key('a'), true)).toBe(false);
    expect(isPhysicalKey(key('a', { keyCode: 0 }), false)).toBe(false);
  });
});

describe('appleTouch', () => {
  it('finds iPhones and iPads, including an iPad that asks for the desktop page', () => {
    expect(appleTouch({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Instagram 300' })).toBe(true);
    expect(appleTouch({ platform: 'MacIntel', userAgent: 'Mozilla/5.0 (Macintosh)', maxTouchPoints: 5 })).toBe(true);
    expect(appleTouch({ platform: 'MacIntel', userAgent: 'Mozilla/5.0 (Macintosh)', maxTouchPoints: 0 })).toBe(false);
    expect(appleTouch({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7)' })).toBe(false);
  });
});
