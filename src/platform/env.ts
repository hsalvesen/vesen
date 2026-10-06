// What the device is, as far as the prompt needs to know (docs/plan/02-architecture-and-contracts.md,
// section 7). Detection changes defaults only and never removes a feature.

import type { KeyPlatform } from '../shell/editor/keymap';

/** The navigator fields the platform is read from. */
export interface PlatformNavigator {
  readonly platform?: string;
  readonly userAgent?: string;
  readonly userAgentData?: { readonly platform?: string };
}

/**
 * 'mac' on macOS and iPadOS with a hardware keyboard, where Ctrl+W, P, N, F, B and T are free for
 * readline because Cmd does the browser's shortcuts; 'other' everywhere else.
 */
export function keyPlatform(nav: PlatformNavigator | undefined): KeyPlatform {
  const name = nav?.userAgentData?.platform ?? nav?.platform ?? nav?.userAgent ?? '';
  return /mac|iphone|ipad|ipod/i.test(name) ? 'mac' : 'other';
}

/** A touch screen as the main pointer: focus opens a soft keyboard, so it waits for a tap. */
export function coarsePointer(win: Pick<Window, 'matchMedia'> | undefined): boolean {
  try {
    return win?.matchMedia?.('(pointer: coarse)').matches ?? false;
  } catch {
    return false;
  }
}

/**
 * The phone dock shows on a touch screen, or anywhere with ?dock=1 (to work on it with a mouse).
 * ?dock=0 turns it off.
 */
export function dockWanted(win: (Pick<Window, 'matchMedia'> & { readonly location?: { readonly search: string } }) | undefined): boolean {
  let asked: string | null = null;
  try {
    asked = new URLSearchParams(win?.location?.search ?? '').get('dock');
  } catch {
    asked = null;
  }
  if (asked === '1') return true;
  if (asked === '0') return false;
  return coarsePointer(win);
}
