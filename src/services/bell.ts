// The terminal bell (docs/plan/02-architecture-and-contracts.md, section 9). The shell rings it at
// most once per job; the sound is playBeep's short tone through the page's one AudioContext
// (audio.ts). Visual flashes are offered to the UI for when the sound is off.

import { audioContext } from './audio';
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

/** Plays the terminal bell: a short, low 200 Hz tone used for errors and unknown commands. */
export function playBeep(): void {
  try {
    const ctx = audioContext();
    if (!ctx) return;
    // A context created before any user gesture starts suspended; the bell rings in
    // response to a key press, so resuming here is allowed.
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});

    const now = ctx.currentTime;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.connect(gain);
    gain.connect(ctx.destination);

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(200, now);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.3, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);

    oscillator.start(now);
    oscillator.stop(now + 0.2);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
  } catch (error) {
    console.warn('Could not play beep sound:', error);
  }
}
