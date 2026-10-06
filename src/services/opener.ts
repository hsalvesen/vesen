// Opening links under the in-app browser policy (docs/plan/02-architecture-and-contracts.md,
// section 7). On a desktop browser a command's URL opens inside the Enter or tap gesture. Inside
// Instagram, Facebook or TikTok, and on touch screens, nothing navigates without a tap: the
// command prints a link instead. Phase 3 adds the link cards and the escape links.

import type { Opener } from './types';

export interface OpenerHost {
  open(url: string, target: string): Window | null;
  readonly navigator?: { readonly share?: (data: { url: string; title?: string }) => Promise<void> };
}

export interface OpenerOptions {
  /** The in-app browser the page is in, or null. */
  readonly inApp: string | null;
  /** A touch screen, where a new tab is a jolt; links wait for a tap. */
  readonly touch: boolean;
}

export function createOpener(host: OpenerHost, options: OpenerOptions): Opener {
  const autoOpen = options.inApp === null && !options.touch;
  const openTab = (url: string): 'opened' | 'blocked' => {
    try {
      const tab = host.open(url, '_blank');
      if (tab === null) return 'blocked';
      try {
        tab.opener = null;
      } catch {
        // Cross-origin by now: nothing to cut.
      }
      return 'opened';
    } catch {
      return 'blocked';
    }
  };
  return {
    autoOpen,
    preflight: (url) => (autoOpen ? openTab(url) : 'skipped'),
    open: (url) => openTab(url),
    escapeHref: () => null,
    menuHint: () => (options.inApp === null ? null : `Tap ••• and choose Open in browser to leave ${options.inApp}.`),
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
