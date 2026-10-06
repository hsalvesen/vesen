import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_TIMEOUT_MS,
  NetError,
  combineSignals,
  fetchJson,
  fetchText,
  fetchTextCapped,
  fetchWithTimeout,
  isOnline,
} from './net';

/** A fetch that never settles and ignores its signal, like a proxy that hangs. */
const hangingFetch = () => new Promise<Response>(() => {});

/** Resolves to whatever the promise rejected with, so a rejection is handled before timers run. */
const rejectionOf = (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    () => {
      throw new Error('expected a rejection');
    },
    (error: unknown) => error,
  );

beforeEach(() => {
  // Only the deadline timers: Node's fetch reads bodies on setImmediate, which must stay real.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('combineSignals', () => {
  it('aborts when any input aborts, with that reason', () => {
    const a = new AbortController();
    const b = new AbortController();
    const combined = combineSignals(a.signal, undefined, b.signal, null);

    expect(combined.aborted).toBe(false);
    b.abort('stop');
    expect(combined.aborted).toBe(true);
    expect(combined.reason).toBe('stop');
  });

  it('is aborted at once when an input already is', () => {
    const a = new AbortController();
    a.abort('early');
    const combined = combineSignals(new AbortController().signal, a.signal);

    expect(combined.aborted).toBe(true);
    expect(combined.reason).toBe('early');
  });

  it('never aborts with no inputs', () => {
    expect(combineSignals().aborted).toBe(false);
  });
});

describe('isOnline', () => {
  it('trusts navigator.onLine only when it says offline', () => {
    vi.stubGlobal('navigator', { onLine: false });
    expect(isOnline()).toBe(false);
    vi.stubGlobal('navigator', { onLine: true });
    expect(isOnline()).toBe(true);
    vi.stubGlobal('navigator', {});
    expect(isOnline()).toBe(true);
  });
});

describe('fetchWithTimeout', () => {
  it('resolves with the response and clears its timer', async () => {
    const fetchMock = vi.fn(async () => new Response('ok'));
    vi.stubGlobal('fetch', fetchMock);

    const response = await fetchWithTimeout('https://example.com/a');

    expect(await response.text()).toBe('ok');
    expect(fetchMock).toHaveBeenCalledWith('https://example.com/a', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(vi.getTimerCount()).toBe(0);
  });

  it(`times out after ${DEFAULT_TIMEOUT_MS} ms by default, even when fetch ignores the signal`, async () => {
    vi.stubGlobal('fetch', vi.fn(hangingFetch));
    let settled = false;
    const failure = rejectionOf(fetchWithTimeout('https://wttr.in/Oslo')).finally(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    const error = await failure;
    expect(error).toBeInstanceOf(NetError);
    expect(error).toMatchObject({ kind: 'timeout', host: 'wttr.in', timeoutMs: DEFAULT_TIMEOUT_MS });
  });

  it('honours a custom timeout', async () => {
    vi.stubGlobal('fetch', vi.fn(hangingFetch));
    const failure = rejectionOf(fetchWithTimeout('https://api.ipify.org?format=json', { timeoutMs: 4000 }));

    await vi.advanceTimersByTimeAsync(4000);

    expect(await failure).toMatchObject({ kind: 'timeout', host: 'api.ipify.org', timeoutMs: 4000 });
  });

  it('aborts at once when the caller cancels, even when fetch ignores the signal', async () => {
    vi.stubGlobal('fetch', vi.fn(hangingFetch));
    const controller = new AbortController();
    const failure = rejectionOf(fetchWithTimeout('https://example.com', { signal: controller.signal }));

    controller.abort();

    expect(await failure).toMatchObject({ kind: 'abort', host: 'example.com' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('passes the cancel on to fetch', async () => {
    let seen: AbortSignal | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => {
        seen = init?.signal ?? undefined;
        return hangingFetch();
      }),
    );
    const controller = new AbortController();
    const failure = rejectionOf(fetchWithTimeout('https://example.com', { signal: controller.signal }));

    controller.abort();
    await failure;

    expect(seen?.aborted).toBe(true);
  });

  it('does not call fetch when already cancelled or offline', async () => {
    const fetchMock = vi.fn(hangingFetch);
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    controller.abort();

    expect(await rejectionOf(fetchWithTimeout('https://example.com', { signal: controller.signal }))).toMatchObject({
      kind: 'abort',
    });

    vi.stubGlobal('navigator', { onLine: false });
    expect(await rejectionOf(fetchWithTimeout('https://example.com/x'))).toMatchObject({
      kind: 'offline',
      host: 'example.com',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails a non-2xx response with kind http unless asked not to', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('busy', { status: 503 })));

    expect(await rejectionOf(fetchWithTimeout('https://api.allorigins.win/get'))).toMatchObject({
      kind: 'http',
      status: 503,
      host: 'api.allorigins.win',
    });

    const response = await fetchWithTimeout('https://api.allorigins.win/get', { throwHttpErrors: false });
    expect(response.status).toBe(503);
  });

  it('accepts the opaque response of a no-cors request', async () => {
    const opaque = { ok: false, status: 0, type: 'opaque' } as Response;
    vi.stubGlobal('fetch', vi.fn(async () => opaque));

    await expect(fetchWithTimeout('https://speed.cloudflare.com/__up', { mode: 'no-cors' })).resolves.toBe(opaque);
  });

  it('reports a failed cross-origin request as cors and a same-origin one as network', async () => {
    vi.stubGlobal('location', new URL('https://www.vesen.app/'));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );

    expect(await rejectionOf(fetchWithTimeout('https://example.com/data'))).toMatchObject({
      kind: 'cors',
      host: 'example.com',
    });
    expect(await rejectionOf(fetchWithTimeout('/README.md'))).toMatchObject({
      kind: 'network',
      host: 'www.vesen.app',
    });
  });

  it('reports a failure while offline as offline', async () => {
    const navigatorStub = { onLine: true };
    vi.stubGlobal('navigator', navigatorStub);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        navigatorStub.onLine = false;
        throw new TypeError('Failed to fetch');
      }),
    );

    expect(await rejectionOf(fetchWithTimeout('https://example.com'))).toMatchObject({ kind: 'offline' });
  });
});

describe('fetchText and fetchJson', () => {
  it('read the body within the same deadline', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const body = new ReadableStream<Uint8Array>({ start() {} }); // headers arrive, the body never does
        return new Response(body);
      }),
    );
    const failure = rejectionOf(fetchText('https://wttr.in/Oslo', { timeoutMs: 8000 }));

    await vi.advanceTimersByTimeAsync(8000);

    expect(await failure).toMatchObject({ kind: 'timeout', host: 'wttr.in' });
  });

  it('return the text or the parsed JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"ip":"203.0.113.7"}')));

    await expect(fetchText('https://api.ipify.org')).resolves.toBe('{"ip":"203.0.113.7"}');
    await expect(fetchJson<{ ip: string }>('https://api.ipify.org')).resolves.toEqual({ ip: '203.0.113.7' });
  });

  it('fail malformed JSON with kind parse', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>522</html>')));

    expect(await rejectionOf(fetchJson('https://api.allorigins.win/get'))).toMatchObject({
      kind: 'parse',
      host: 'api.allorigins.win',
    });
  });
});

describe('fetchTextCapped', () => {
  /**
   * A 64-piece body of `chunk`-byte pieces that counts how many were pulled and whether it was
   * cancelled. Finite, so a reader that ignores the cap fails the test rather than hanging it.
   */
  function largeBody(chunk: number) {
    const state = { pulls: 0, cancelled: false };
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        state.pulls += 1;
        controller.enqueue(new Uint8Array(chunk).fill(0x61));
        if (state.pulls === 64) controller.close();
      },
      cancel() {
        state.cancelled = true;
      },
    });
    return { body, state };
  }

  it('reads a body under the cap in full', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('héllo')));

    await expect(fetchTextCapped('https://httpbin.org/get', { maxBytes: 1024 })).resolves.toEqual({
      text: 'héllo',
      truncated: false,
    });
  });

  it('stops reading at the cap and cancels the rest of the body', async () => {
    const { body, state } = largeBody(64 * 1024);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body)));

    const result = await fetchTextCapped('https://speed.cloudflare.com/__down?bytes=1000000000', { maxBytes: 100_000 });

    expect(result.truncated).toBe(true);
    expect(result.text).toHaveLength(100_000);
    expect(state.pulls).toBeLessThanOrEqual(3);
    expect(state.cancelled).toBe(true);
  });

  it('drops a character the cap splits rather than garbling it', async () => {
    // "é" is two bytes in UTF-8; a 2-byte cap ends inside it.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('aé')));

    await expect(fetchTextCapped('https://example.com', { maxBytes: 2 })).resolves.toEqual({
      text: 'a',
      truncated: true,
    });
  });
});
