// HTTP for commands. Every request gets a deadline and an optional caller cancel, and every
// failure becomes one typed NetError, so a command can print a short, honest line instead of
// a raw TypeError or SyntaxError.
//
// AbortSignal.any and AbortSignal.timeout are deliberately not used: Instagram's WKWebView on
// iOS before 17.4 lacks both, so signals are combined and timed by hand.

import { combineSignals } from '../lib/signals';
import {
  MEMO_FAILURE_COOLDOWN_MS,
  REQUEST_TIMEOUT_MS,
  type JsonInit,
  type Net,
  type NetError as NetErrorContract,
  type NetErrorKind,
  type NetInit,
  type NetResponse,
} from './types';

export type { NetErrorKind };
export { combineSignals };

/** The deadline for one request when the caller does not set one. */
export const DEFAULT_TIMEOUT_MS = REQUEST_TIMEOUT_MS.default;

export class NetError extends Error implements NetErrorContract {
  readonly kind: NetErrorKind;
  /** The host the request went to, such as `api.open-meteo.com`, or the URL itself when it could not be parsed. */
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

// ── memo ───────────────────────────────────────────────────────────────────────────────────

export interface MemoOptions {
  /** The clock; tests pass a fake one. */
  now?: () => number;
  /** How long a failure is remembered. Defaults to 30 s. */
  failureCooldownMs?: number;
}

/**
 * Runs `load` once per key within `ttlMs` of it succeeding: concurrent callers share the request
 * in flight, and a failure is remembered for 30 s so a broken host is not hammered. A failure
 * of kind `abort` or `offline` says nothing about the host and is not remembered.
 *
 * `load` takes no signal, because callers share it; a caller that may be cancelled races the
 * returned promise against its own signal (see `untilAborted`).
 */
export interface Memo {
  <T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T>;
  /** Forgets one key, so the next call loads again. */
  forget(key: string): void;
  /** Forgets every key. */
  clear(): void;
}

interface MemoEntry {
  readonly promise: Promise<unknown>;
  /** Infinity while the load is in flight. */
  until: number;
}

/** Expired entries are swept once the table holds this many. */
const MEMO_SWEEP_AT = 100;

export function createMemo(options: MemoOptions = {}): Memo {
  const { now = Date.now, failureCooldownMs = MEMO_FAILURE_COOLDOWN_MS } = options;
  const entries = new Map<string, MemoEntry>();

  const sweep = (at: number): void => {
    if (entries.size < MEMO_SWEEP_AT) return;
    for (const [key, entry] of entries) if (entry.until <= at) entries.delete(key);
  };

  const memo = <T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> => {
    const at = now();
    const existing = entries.get(key);
    if (existing && at < existing.until) return existing.promise as Promise<T>;
    sweep(at);

    // The async wrapper turns a synchronous throw in `load` into a rejection.
    const promise = (async () => load())();
    const entry: MemoEntry = { promise, until: Number.POSITIVE_INFINITY };
    entries.set(key, entry);
    promise.then(
      () => {
        if (entries.get(key) === entry) entry.until = now() + Math.max(0, ttlMs);
      },
      (error: unknown) => {
        if (entries.get(key) !== entry) return;
        if (isNetError(error) && (error.kind === 'abort' || error.kind === 'offline')) entries.delete(key);
        else entry.until = now() + failureCooldownMs;
      },
    );
    return promise;
  };

  return Object.assign(memo, {
    forget: (key: string): void => {
      entries.delete(key);
    },
    clear: (): void => entries.clear(),
  });
}

/** The page's shared memo table. */
export const memo: Memo = /* @__PURE__ */ createMemo();

/**
 * Settles like `promise`, or rejects with a NetError of kind `abort` for `host` as soon as
 * `signal` aborts. For callers of a shared request (see `memo`) that can be cancelled alone.
 */
export function untilAborted<T>(promise: Promise<T>, signal: AbortSignal | null | undefined, host: string): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new NetError('abort', host));
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(new NetError('abort', host));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

// ── The Net service ────────────────────────────────────────────────────────────────────────

function hostOf(url: string): string {
  return parseUrl(url)?.host || url;
}

/**
 * The Net service commands reach through `ctx.net`: text and JSON with the per-request deadline
 * (8 s unless `timeoutMs` says otherwise), the caller's signal, typed NetErrors, and a memo table
 * of its own.
 */
export function createNet(options: MemoOptions = {}): Net {
  const table = createMemo(options);
  const fetchOptions = (init: NetInit): FetchOptions => {
    const { headers, ...rest } = init;
    return headers === undefined ? rest : { ...rest, headers: { ...headers } };
  };
  return {
    text(url: string, init: NetInit = {}): Promise<NetResponse> {
      const started = Date.now();
      return fetchAndRead(url, fetchOptions(init), async (response) => {
        const body = await response.text();
        const headers: Record<string, string> = {};
        response.headers.forEach((value, name) => {
          headers[name.toLowerCase()] = value;
        });
        return { url: response.url || url, status: response.status, headers, body, ms: Date.now() - started };
      });
    },
    async json<T = unknown>(url: string, init: JsonInit<T> = {}): Promise<T> {
      const { parse, ...rest } = init;
      const raw: unknown = await fetchAndRead(url, fetchOptions(rest), (response) => response.json() as Promise<unknown>);
      if (parse === undefined) return raw as T;
      try {
        return parse(raw);
      } catch {
        throw new NetError('parse', hostOf(url));
      }
    },
    memo: <T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> => table(key, ttlMs, load),
    isError: (error: unknown): error is NetError => isNetError(error),
    online: isOnline,
  };
}
