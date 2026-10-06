// Abort signals without AbortSignal.any or AbortSignal.timeout, which Instagram's WKWebView on
// iOS before 17.4 lacks. Shared by services/net.ts (per-request deadlines) and the shell kernel
// (the line's ^C and the whole-command budget), so there is one copy of each helper.

/** A signal that aborts as soon as any of `signals` does, with that signal's reason. */
export function combineSignals(...signals: ReadonlyArray<AbortSignal | null | undefined>): AbortSignal {
  const controller = new AbortController();
  const inputs = signals.filter((signal): signal is AbortSignal => signal != null);

  const alreadyAborted = inputs.find((signal) => signal.aborted);
  if (alreadyAborted) {
    controller.abort(alreadyAborted.reason);
    return controller.signal;
  }

  const onAbort = (event: Event): void => {
    for (const signal of inputs) signal.removeEventListener('abort', onAbort);
    controller.abort((event.target as AbortSignal).reason);
  };
  for (const signal of inputs) signal.addEventListener('abort', onAbort);
  return controller.signal;
}

/** Why a deadline fired: the reason a `deadline` signal aborts with. */
export class DeadlineExceeded extends Error {
  readonly ms: number;

  constructor(ms: number) {
    super(`no result within ${ms} ms`);
    this.name = 'DeadlineExceeded';
    this.ms = ms;
  }
}

export interface Deadline {
  /** Aborts with a DeadlineExceeded reason once `ms` have passed. */
  readonly signal: AbortSignal;
  /** Stops the timer; the signal then never aborts on its own. */
  cancel(): void;
}

/** A signal that aborts after `ms`, made with setTimeout rather than AbortSignal.timeout. */
export function deadline(ms: number): Deadline {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DeadlineExceeded(ms)), Math.max(0, ms));
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

/** Resolves when `signal` aborts; never, if it does not. */
export function whenAborted(signal: AbortSignal): Promise<unknown> {
  if (signal.aborted) return Promise.resolve(signal.reason);
  return new Promise((resolve) => {
    signal.addEventListener('abort', () => resolve(signal.reason), { once: true });
  });
}

/** True for the error a cancelled operation rejects with: an AbortError, from fetch or a signal. */
export function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError';
}
