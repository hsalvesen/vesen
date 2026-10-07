// Full-screen apps for a running command (ctx.tty.fullscreen): the Shutdown screen that poweroff,
// reboot and shutdown show, and later the pager and the editor. The kernel puts the request in a
// store; the UI's AppHost draws the app over the terminal and closes it with the app's result.
// DOM-free, like the line reader (src/shell/reader.ts).

import { readonly, writable, type Readable } from './observable';
import type { FullscreenView } from './types';

/** An app waiting to be shown, as the UI sees it. */
export interface AppRequest {
  readonly id: number;
  readonly view: FullscreenView;
  /** The app's view model, built by the command. */
  readonly props: unknown;
}

export interface AppRunner {
  /** The app on screen, or null. */
  readonly request: Readable<AppRequest | null>;
  /**
   * Shows `view` until the UI closes it, and resolves with the app's result. Rejects with the
   * signal's reason when the job is interrupted, and the app goes away.
   */
  open<T>(view: FullscreenView, props: unknown, signal?: AbortSignal): Promise<T>;
  /** The UI's close of app `id`, with its result. Ignored for an app no longer showing. */
  close(id: number, result?: unknown): void;
}

export function createAppRunner(): AppRunner {
  const request = writable<AppRequest | null>(null);
  let nextId = 0;
  let current: { readonly id: number; settle(outcome: { result: unknown } | { error: unknown }): void } | null = null;

  return {
    request: readonly(request),
    close(id, result) {
      if (current?.id === id) current.settle({ result });
    },
    open<T>(view: FullscreenView, props: unknown, signal?: AbortSignal): Promise<T> {
      // One app at a time: one already showing ends first, with no result.
      current?.settle({ result: undefined });
      if (signal?.aborted === true) return Promise.reject(signal.reason);
      const id = ++nextId;
      return new Promise<T>((resolve, reject) => {
        const onAbort = (): void => entry.settle({ error: signal?.reason });
        const entry = {
          id,
          settle(outcome: { result: unknown } | { error: unknown }): void {
            if (current !== entry) return;
            current = null;
            signal?.removeEventListener('abort', onAbort);
            request.set(null);
            if ('error' in outcome) reject(outcome.error);
            else resolve(outcome.result as T);
          },
        };
        current = entry;
        signal?.addEventListener('abort', onAbort, { once: true });
        request.set({ id, view, props });
      });
    },
  };
}
