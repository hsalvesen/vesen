// The last few things that went wrong in the page, for `debug report`
// (docs/plan/10-tooling-hosting-docs.md, "Privacy and error visibility"): Instagram's in-app
// browsers cannot be inspected remotely, so a visitor can paste these into an issue instead.
// Uncaught errors and rejected promises only; nothing is sent anywhere.

export interface ErrorBuffer {
  /** Oldest first, one line each: the time, the message and where it came from. */
  recent(): readonly string[];
  stop(): void;
}

/** How many errors are kept, and how long each line may be. */
export const ERROR_BUFFER_SIZE = 10;
export const ERROR_LINE_CHARS = 300;

type ErrorTarget = Pick<Window, 'addEventListener' | 'removeEventListener'>;

function describe(reason: unknown): string {
  if (reason instanceof Error) return `${reason.name}: ${reason.message}`;
  if (typeof reason === 'string') return reason;
  try {
    return JSON.stringify(reason) ?? String(reason);
  } catch {
    return String(reason);
  }
}

/** Where a script error came from, without the query string or the origin. */
function where(event: ErrorEvent): string {
  if (!event.filename) return '';
  const file = event.filename.replace(/^[a-z]+:\/\/[^/]+/i, '').replace(/[?#].*$/, '');
  return ` (${file}:${event.lineno}:${event.colno})`;
}

export function installErrorBuffer(target: ErrorTarget, now: () => number = Date.now): ErrorBuffer {
  const lines: string[] = [];
  const keep = (text: string): void => {
    const line = `${new Date(now()).toISOString().slice(11, 19)} ${text.replace(/\s+/g, ' ').trim()}`;
    lines.push(line.length > ERROR_LINE_CHARS ? `${line.slice(0, ERROR_LINE_CHARS - 1)}…` : line);
    if (lines.length > ERROR_BUFFER_SIZE) lines.shift();
  };
  const onError = (event: Event): void => {
    const error = event as ErrorEvent;
    keep(`${error.error === undefined || error.error === null ? (error.message ?? 'error') : describe(error.error)}${where(error)}`);
  };
  const onRejection = (event: Event): void => {
    keep(`unhandled rejection: ${describe((event as PromiseRejectionEvent).reason)}`);
  };
  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onRejection);
  return {
    recent: () => [...lines],
    stop() {
      target.removeEventListener('error', onError);
      target.removeEventListener('unhandledrejection', onRejection);
    },
  };
}
