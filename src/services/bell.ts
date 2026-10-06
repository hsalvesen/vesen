// The terminal bell (docs/plan/02-architecture-and-contracts.md, section 9). The shell rings it at
// most once per job; the sound is utils/beep.ts's single shared AudioContext. Visual flashes are
// offered to the UI for when the sound is off.

import type { Bell } from './types';

export function createBell(options: { play: () => void; audible?: () => boolean }): Bell {
  const listeners = new Set<() => void>();
  return {
    ring() {
      if (options.audible?.() ?? true) options.play();
      else for (const listener of [...listeners]) listener();
    },
    onFlash(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
