// An Opener for tests: every member answers as a phone's would (nothing opens by itself), and a
// test overrides what it looks at.

import type { Opener } from '../services/types';

export function fakeOpener(overrides: Partial<Opener> = {}): Opener {
  return {
    autoOpen: false,
    inApp: null,
    plan: () => ({ mode: 'card-only', target: '_blank' }),
    preflight: () => 'skipped',
    open: () => 'opened',
    escapeHref: () => null,
    openExternal: () => false,
    menuHint: () => null,
    canShare: () => false,
    share: () => Promise.resolve('unavailable'),
    ...overrides,
  };
}
