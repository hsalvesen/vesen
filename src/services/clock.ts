// Time and randomness for the shell (services/types.ts, Clock): the real ones in the app, fakes in tests.

import type { Clock } from './types';

export function createClock(options: { now?: () => number; random?: () => number; timeZone?: string } = {}): Clock {
  const now = options.now ?? (() => Date.now());
  const booted = now();
  const zone = options.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  return {
    now,
    bootTime: () => booted,
    timeZone: () => zone,
    random: options.random ?? (() => Math.random()),
    sleep(ms, signal) {
      return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
          reject(signal.reason);
          return;
        }
        const onAbort = (): void => {
          clearTimeout(timer);
          reject(signal?.reason);
        };
        const timer = setTimeout(() => {
          signal?.removeEventListener('abort', onAbort);
          resolve();
        }, Math.max(0, ms));
        signal?.addEventListener('abort', onAbort, { once: true });
      });
    },
  };
}
