// Telling a hardware keyboard from an on-screen one, on a touch screen (docs/plan/04, "Dock, chips
// and key bar"): the first key only a hardware keyboard presses puts the dock's key bar away.
// Pure, so it is tested without a browser; the dock is the only thing that reads it, so it lives
// in the dock's own chunk.

import type { PlatformNavigator } from '../../platform/env';

/** iOS and iPadOS, whose on-screen keyboard sends real key values for the letters it types. */
export function appleTouch(nav: PlatformNavigator & { readonly maxTouchPoints?: number }): boolean {
  const name = `${nav.userAgentData?.platform ?? ''} ${nav.platform ?? ''} ${nav.userAgent ?? ''}`;
  if (/iphone|ipad|ipod/i.test(name)) return true;
  // iPadOS asks for desktop pages as a Mac with a touch screen.
  return /mac/i.test(name) && (nav.maxTouchPoints ?? 0) > 1;
}

/** What isPhysicalKey reads from a key press; a KeyboardEvent is one. */
export interface KeyPressFacts {
  readonly key: string;
  readonly keyCode: number;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly isComposing: boolean;
}

/** Keys an on-screen keyboard has none of: only a hardware keyboard presses them. */
const HARDWARE_ONLY_KEYS = new Set([
  'Tab',
  'Escape',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Insert',
  'CapsLock',
]);

/**
 * True when a key press on a touch screen came from a hardware keyboard: a key no on-screen
 * keyboard has (Tab, the arrows, Escape, F1), a Ctrl, Alt or Cmd chord, or (except on Apple's
 * touch screens, whose on-screen keyboard sends the same) a character with a real key code, where
 * Android's keyboards send 229. Enter and Backspace, which every keyboard has, never count.
 */
export function isPhysicalKey(event: KeyPressFacts, apple: boolean): boolean {
  if (event.isComposing || event.keyCode === 229 || event.key === 'Unidentified' || event.key === 'Process') return false;
  if (HARDWARE_ONLY_KEYS.has(event.key) || /^F\d{1,2}$/.test(event.key)) return true;
  const modifier = event.key === 'Control' || event.key === 'Alt' || event.key === 'Meta' || event.key === 'Shift';
  if ((event.ctrlKey || event.metaKey || event.altKey) && !modifier) return true;
  return !apple && [...event.key].length === 1 && event.keyCode !== 0;
}
