// Opening links under the in-app browser policy (docs/plan/02-architecture-and-contracts.md,
// section 7; docs/plan/04-phone-and-instagram.md, "Inside Instagram's browser"):
//
// - On a desktop browser outside an in-app browser, a command's opens() URL opens in a new tab
//   synchronously inside the Enter or tap gesture, with noopener and noreferrer.
// - Inside Instagram, Facebook or TikTok nothing navigates without a tap, and a tapped link opens
//   in the same view, so Back returns to the terminal (which the session snapshot restores).
// - On phones and tablets, and for mailto anywhere, only the card is printed.
// - The escape to the real browser (`instagram://extbrowser/` on iOS Instagram, `intent://` on
//   Android) is offered only behind a tap, beside the manual "••• → Open in browser".
//
// Every opener also prints a link card with Copy; that is the command's job, not this file's.

import type { LinkEnv } from '../platform/env';
import { IN_APP_LABELS } from '../platform/env';
import type { InAppInfo, Opener, OpenPlan } from './types';

/** How `url` opens on this device. Pure. */
export function planOpen(url: string, env: LinkEnv): OpenPlan {
  const target = env.inApp === null ? '_blank' : '_self';
  if (env.inApp !== null) return { mode: 'self', target };
  // A mail app is never opened on its own: the card's Open mail app is a real mailto link.
  const web = /^https?:/i.test(url);
  return { mode: web && env.desktop ? 'window' : 'card-only', target };
}

/**
 * The link that opens `url` in the real browser from an in-app browser, or null where there is
 * none: Instagram's own scheme on iOS, and an intent for Chrome (falling back to the page) on
 * Android. Only http and https URLs escape. Pure.
 */
export function escapeHref(url: string, env: LinkEnv): string | null {
  if (env.inApp === null) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  if (env.os === 'ios') return env.inApp === 'instagram' ? `instagram://extbrowser/?url=${encodeURIComponent(parsed.href)}` : null;
  if (env.os === 'android') {
    const scheme = parsed.protocol.slice(0, -1);
    return (
      `intent://${parsed.host}${parsed.pathname}${parsed.search}` +
      `#Intent;scheme=${scheme};package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(parsed.href)};end`
    );
  }
  return null;
}

/** The in-app browser as the cards word it, or null in a real browser. Pure. */
export function inAppInfo(env: LinkEnv): InAppInfo | null {
  if (env.inApp === null) return null;
  const browser = env.os === 'ios' ? 'Safari' : env.os === 'android' ? 'Chrome' : 'your browser';
  // Instagram's menu is ••• on iOS and three dots one above the other on Android, which the
  // terminal's font has no glyph for, so it is named instead.
  const menu = env.os === 'android' ? 'Menu' : '•••';
  return { label: IN_APP_LABELS[env.inApp], browser, menuHint: `${menu} → Open in browser` };
}

export interface OpenerHost {
  open(url: string, target: string, features?: string): Window | null;
  readonly location: { assign(url: string): void };
  readonly navigator?: { readonly share?: (data: { url: string; title?: string }) => Promise<void> };
}

export function createOpener(host: OpenerHost, env: LinkEnv): Opener {
  const info = inAppInfo(env);

  /** A new tab with no way back to this page; a returned Window is cut loose as well. */
  const openTab = (url: string): 'opened' | 'blocked' => {
    try {
      const tab = host.open(url, '_blank', 'noopener,noreferrer');
      // With noopener the browser returns null even when the tab opened, so only a throw
      // (or a browser that hands the tab back after all) tells anything.
      if (tab !== null) {
        try {
          tab.opener = null;
        } catch {
          // Cross-origin by now: nothing to cut.
        }
      }
      return 'opened';
    } catch {
      return 'blocked';
    }
  };

  const navigate = (url: string): 'opened' | 'blocked' => {
    try {
      host.location.assign(url);
      return 'opened';
    } catch {
      return 'blocked';
    }
  };

  return {
    autoOpen: env.inApp === null && env.desktop,
    inApp: info,
    plan: (url) => planOpen(url, env),
    preflight: (url) => (planOpen(url, env).mode === 'window' ? openTab(url) : 'skipped'),
    open: (url) => (planOpen(url, env).target === '_self' || /^mailto:/i.test(url) ? navigate(url) : openTab(url)),
    escapeHref: (url) => escapeHref(url, env),
    openExternal(url) {
      const href = escapeHref(url, env);
      if (href === null) return false;
      return navigate(href) === 'opened';
    },
    menuHint: () => info?.menuHint ?? null,
    canShare: () => typeof host.navigator?.share === 'function',
    async share(data) {
      const share = host.navigator?.share;
      if (typeof share !== 'function') return 'unavailable';
      try {
        await share.call(host.navigator, data);
        return 'shared';
      } catch {
        return 'cancelled';
      }
    },
  };
}
