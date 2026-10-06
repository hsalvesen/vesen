// HTTP for commands. Every request gets a deadline and an optional caller cancel, and every
// failure becomes one typed NetError, so a command can print a short, honest line instead of
// a raw TypeError or SyntaxError.
//
// AbortSignal.any and AbortSignal.timeout are deliberately not used: Instagram's WKWebView on
// iOS before 17.4 lacks both, so signals are combined and timed by hand.

import { REQUEST_TIMEOUT_MS, type NetError as NetErrorContract, type NetErrorKind } from './types';

export type { NetErrorKind };

/** The deadline for one request when the caller does not set one. */
export const DEFAULT_TIMEOUT_MS = REQUEST_TIMEOUT_MS.default;

export class NetError extends Error implements NetErrorContract {
  readonly kind: NetErrorKind;
  /** The host the request went to, such as `wttr.in`, or the URL itself when it could not be parsed. */
  readonly host: string;
  /** The response status, for kind `http`. */
  readonly status: number | undefined;
  /** The deadline that passed, for kind `timeout`. */
  readonly timeoutMs: number | undefined;

  constructor(kind: NetErrorKind, host: string, details: { status?: number; timeoutMs?: number } = {}) {
    super(messageFor(kind, host, details));
    this.name = 'NetError';
    this.kind = kind;
    this.host = host;
    this.status = details.status;
    this.timeoutMs = details.timeoutMs;
  }
}

function messageFor(kind: NetErrorKind, host: string, details: { status?: number; timeoutMs?: number }): string {
  switch (kind) {
    case 'timeout':
      return `${host}: no response within ${details.timeoutMs ?? DEFAULT_TIMEOUT_MS} ms`;
    case 'abort':
      return `${host}: request cancelled`;
    case 'offline':
      return `${host}: the browser is offline`;
    case 'cors':
      return `${host}: cross-origin request failed`;
    case 'http':
      return `${host}: HTTP ${details.status ?? 'error'}`;
    case 'network':
      return `${host}: network error`;
    case 'parse':
      return `${host}: unreadable response`;
  }
}

export function isNetError(error: unknown): error is NetError {
  return error instanceof NetError;
}

/** False only when the browser reports that it is offline; unknown counts as online. */
export function isOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

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

export interface FetchOptions extends Omit<RequestInit, 'signal'> {
  /** Milliseconds before the request fails with kind `timeout`. Defaults to 8000. */
  timeoutMs?: number;
  /** Cancels the request, which then fails with kind `abort`. */
  signal?: AbortSignal | null;
  /** When false, a non-2xx response is returned instead of failing with kind `http`. Defaults to true. */
  throwHttpErrors?: boolean;
}

/**
 * fetch with a deadline. Resolves with the response once its headers arrive, or rejects with a
 * NetError. The deadline does not cover reading the body; fetchText and fetchJson do.
 */
export function fetchWithTimeout(url: string, options: FetchOptions = {}): Promise<Response> {
  return fetchAndRead(url, options, async (response) => response);
}

/** Fetches `url` and reads the body as text, all within one deadline. */
export function fetchText(url: string, options: FetchOptions = {}): Promise<string> {
  return fetchAndRead(url, options, (response) => response.text());
}

export interface CappedText {
  readonly text: string;
  /** True when the body was longer than the cap; the rest was never downloaded. */
  readonly truncated: boolean;
}

/**
 * Fetches `url` and reads at most `maxBytes` of the body as UTF-8 text, all within one deadline.
 * Reading stops at the cap, so a huge response cannot fill the tab's memory.
 */
export function fetchTextCapped(url: string, options: FetchOptions & { maxBytes: number }): Promise<CappedText> {
  const { maxBytes, ...rest } = options;
  return fetchAndRead(url, rest, (response) => readCapped(response, maxBytes));
}

async function readCapped(response: Response, maxBytes: number): Promise<CappedText> {
  if (!response.body) return { text: '', truncated: false };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return { text: text + decoder.decode(), truncated: false };
    const room = maxBytes - received;
    if (value.byteLength > room) {
      // A character split by the cap stays in the decoder and is dropped, not shown as U+FFFD.
      text += decoder.decode(value.subarray(0, room), { stream: true });
      reader.cancel().catch(() => {});
      return { text, truncated: true };
    }
    received += value.byteLength;
    text += decoder.decode(value, { stream: true });
  }
}

/** Fetches `url` and parses the body as JSON, all within one deadline. Malformed JSON fails with kind `parse`. */
export function fetchJson<T = unknown>(url: string, options: FetchOptions = {}): Promise<T> {
  return fetchAndRead(url, options, (response) => response.json() as Promise<T>);
}

/**
 * Fetches `url` and hands the response to `read`, both within one deadline. The returned promise
 * settles as soon as the request times out or is cancelled, even if fetch ignores the signal.
 */
export async function fetchAndRead<T>(
  url: string,
  options: FetchOptions,
  read: (response: Response) => Promise<T>,
): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, signal, throwHttpErrors = true, ...init } = options;
  const target = parseUrl(url);
  const host = target?.host || url;

  if (signal?.aborted) throw new NetError('abort', host);
  if (!isOnline()) throw new NetError('offline', host);

  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), timeoutMs);
  const combined = combineSignals(signal, deadline.signal);

  let stopListening = (): void => {};
  const stopped = new Promise<never>((_, reject) => {
    const onAbort = (): void => reject(combined.reason);
    combined.addEventListener('abort', onAbort);
    stopListening = () => combined.removeEventListener('abort', onAbort);
  });

  const request = (async () => {
    const response = await fetch(url, { ...init, signal: combined });
    // A no-cors request yields an opaque response with status 0; that is not an HTTP error.
    if (throwHttpErrors && !response.ok && response.type !== 'opaque') {
      throw new NetError('http', host, { status: response.status });
    }
    return read(response);
  })();

  try {
    return await Promise.race([request, stopped]);
  } catch (error) {
    if (error instanceof NetError) throw error;
    if (signal?.aborted) throw new NetError('abort', host);
    if (deadline.signal.aborted) throw new NetError('timeout', host, { timeoutMs });
    if (error instanceof SyntaxError) throw new NetError('parse', host);
    if (!isOnline()) throw new NetError('offline', host);
    throw new NetError(target && isCrossOrigin(target) ? 'cors' : 'network', host);
  } finally {
    clearTimeout(timer);
    stopListening();
  }
}

function parseUrl(url: string): URL | null {
  try {
    return new URL(url, typeof location === 'undefined' ? undefined : location.href);
  } catch {
    return null;
  }
}

function isCrossOrigin(target: URL): boolean {
  return typeof location === 'undefined' || target.origin !== location.origin;
}
