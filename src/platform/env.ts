// What the device is, as far as the prompt needs to know (docs/plan/02-architecture-and-contracts.md,
// section 7). Detection changes defaults only and never removes a feature.

import type { KeyPlatform } from '../shell/editor/keymap';
import type { InAppBrowser } from '../shell/types';

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

// ── In-app browsers and the link policy's view of the device ──────────────────────────────

/** In-app browsers by the token their apps add to the user agent, in the order they are tried. */
const IN_APP_TOKENS: readonly (readonly [RegExp, InAppBrowser])[] = [
  [/\bInstagram\b/, 'instagram'],
  [/\bFBA[NV]\/|\bFB_IAB\b|\bFBIOS\b/, 'facebook'],
  [/musical_ly|BytedanceWebview|\bTikTok\b/, 'tiktok'],
];

/** What each in-app browser is called in a sentence. */
export const IN_APP_LABELS: Readonly<Record<InAppBrowser, string>> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  tiktok: 'TikTok',
};

/** The in-app browser this user agent belongs to, or null for a real browser. */
export function detectInApp(userAgent: string): InAppBrowser | null {
  for (const [token, app] of IN_APP_TOKENS) if (token.test(userAgent)) return app;
  return null;
}

/** The phone systems whose browsers the link policy names: Safari on iOS, Chrome on Android. */
export type MobileOs = 'ios' | 'android' | 'other';

/** iOS and iPadOS (which may claim to be a Mac, but has a touch screen), Android, or neither. */
export function detectOs(userAgent: string, maxTouchPoints = 0): MobileOs {
  if (/\b(?:iPhone|iPad|iPod)\b/.test(userAgent)) return 'ios';
  if (/\bAndroid\b/.test(userAgent)) return 'android';
  if (/\bMacintosh\b/.test(userAgent) && maxTouchPoints > 1) return 'ios';
  return 'other';
}

/** What the link policy (services/opener.ts) needs to know about the device. */
export interface LinkEnv {
  /** The in-app browser, or null in a real browser. */
  readonly inApp: InAppBrowser | null;
  readonly os: MobileOs;
  /** A desktop browser: a fine pointer, and not a phone or tablet. */
  readonly desktop: boolean;
}

/** The link policy's view of a device, from its user agent and pointer. */
export function linkEnv(userAgent: string, options: { readonly coarsePointer?: boolean; readonly maxTouchPoints?: number } = {}): LinkEnv {
  const os = detectOs(userAgent, options.maxTouchPoints ?? 0);
  return { inApp: detectInApp(userAgent), os, desktop: os === 'other' && options.coarsePointer !== true };
}

/** The link policy's view of this page's device. */
export function readLinkEnv(win: Pick<Window, 'matchMedia' | 'navigator'> | undefined): LinkEnv {
  const nav = win?.navigator;
  return linkEnv(nav?.userAgent ?? '', { coarsePointer: coarsePointer(win), maxTouchPoints: nav?.maxTouchPoints ?? 0 });
}
