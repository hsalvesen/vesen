// How links and Copy behave in the output, set once by App from the opener and clipboard services
// (docs/plan/02-architecture-and-contracts.md, section 7): a tapped link opens in a new tab in a
// browser, and in the same view inside an in-app browser, so Back returns to the terminal. Cards,
// spans and the escape to the real browser read it through Svelte context; without App (a test,
// a component on its own) links open in a new tab and Copy uses the page's clipboard.

import { getContext, setContext } from 'svelte';
import { createClipboard } from '../services/clipboard';
import type { InAppInfo } from '../services/types';

export interface LinkPolicy {
  /** Where a tapped link opens. */
  readonly target: '_blank' | '_self';
  /** The in-app browser, for the escape and its instruction; null in a real browser. */
  readonly inApp: InAppInfo | null;
  /** A touch screen: failed copies say to press and hold. */
  readonly touch: boolean;
  /** Copies inside the tap; false when it could not. */
  copy(text: string): Promise<boolean>;
  /** The link that opens `url` in the real browser from here, or null. */
  escapeHref(url: string): string | null;
  /** Opens `url` in the real browser; only ever from a tap. */
  openExternal(url: string): void;
}

/** The context key, for a test or a mount that provides the policy itself. */
export const LINK_POLICY_KEY = Symbol('vesen:links');

function fallback(): LinkPolicy {
  const win = typeof window === 'undefined' ? undefined : window;
  const clipboard = createClipboard(win ?? {});
  return {
    target: '_blank',
    inApp: null,
    touch: win?.matchMedia?.('(pointer: coarse)').matches ?? false,
    copy: (text) => clipboard.copy(text),
    escapeHref: () => null,
    openExternal: () => {},
  };
}

/** Makes `policy` what every link and card below this component follows. Call during init. */
export function provideLinkPolicy(policy: LinkPolicy): void {
  setContext(LINK_POLICY_KEY, policy);
}

/** The link policy in force here. Call during component init. */
export function linkPolicy(): LinkPolicy {
  return getContext<LinkPolicy | undefined>(LINK_POLICY_KEY) ?? fallback();
}
