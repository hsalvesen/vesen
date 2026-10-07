// net.open (curl, speedtest): a response read as it arrives, its deadline up to the headers, a
// read that stops at once on ^C, and mixed content told apart before any request.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NetError, createNet, isMixedContent, openStream } from './net';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** A body that hands out `chunks` pieces of `size` bytes, and records reads and cancels. */
function counted(chunks: number, size: number) {
  const seen = { pulls: 0, cancelled: false };
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      seen.pulls += 1;
      controller.enqueue(new Uint8Array(size).fill(0x61));
      if (seen.pulls >= chunks) controller.close();
    },
    cancel() {
      seen.cancelled = true;
    },
  });
  return { body, seen };
}

describe('openStream', () => {
  it('resolves at the headers, then hands the body out piece by piece', async () => {
    const { body } = counted(3, 4);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 201, statusText: 'Created', headers: { 'X-Thing': 'yes' } })));
    const stream = await createNet().open('https://example.com/a');
    expect(stream).toMatchObject({ status: 201, statusText: 'Created', headers: { 'x-thing': 'yes' }, redirected: false });
    const sizes: number[] = [];
    for (let chunk = await stream.read(); chunk !== null; chunk = await stream.read()) sizes.push(chunk.byteLength);
    expect(sizes).toEqual([4, 4, 4]);
    expect(await stream.read()).toBeNull();
  });

  it('times out while waiting for the headers', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
    const opening = openStream('https://slow.example/', { timeoutMs: 500 }).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(500);
    expect(await opening).toMatchObject({ kind: 'timeout', host: 'slow.example', timeoutMs: 500 });
  });

  it('stops reading at once when the signal aborts, and lets the rest of the body go', async () => {
    const { body, seen } = counted(1000, 1024);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body)));
    const stop = new AbortController();
    const stream = await openStream('https://example.com/big', { signal: stop.signal });
    await stream.read();
    stop.abort();
    await expect(stream.read()).rejects.toBeInstanceOf(NetError);
    await expect(stream.read()).resolves.toBeNull();
    expect(seen.cancelled).toBe(true);
    expect(seen.pulls).toBeLessThan(10);
  });

  it('cancels on request', async () => {
    const { body, seen } = counted(1000, 1024);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body)));
    const stream = await openStream('https://example.com/big');
    await stream.read();
    stream.cancel();
    expect(await stream.read()).toBeNull();
    expect(seen.cancelled).toBe(true);
  });

  it('takes a redirect the browser hides for what it is, not an HTTP error', async () => {
    const opaque = { type: 'opaqueredirect', status: 0, ok: false, statusText: '', url: '', redirected: false, headers: new Headers(), body: null };
    const fetchMock = vi.fn(async () => opaque as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);
    const stream = await openStream('https://example.com/old', { redirect: 'manual', cache: 'no-store' });
    expect(stream).toMatchObject({ type: 'opaqueredirect', status: 0 });
    expect(await stream.read()).toBeNull();
    expect(fetchMock.mock.calls[0]).toMatchObject(['https://example.com/old', { redirect: 'manual', cache: 'no-store' }]);
  });

  it('fails an HTTP error unless told not to', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('no', { status: 503 })));
    await expect(openStream('https://example.com/')).rejects.toMatchObject({ kind: 'http', status: 503 });
    await expect(openStream('https://example.com/', { throwHttpErrors: false })).resolves.toMatchObject({ status: 503 });
  });
});

describe('isMixedContent', () => {
  it('is true only for http:// from an https page, other than this machine', () => {
    expect(isMixedContent('http://example.com/')).toBe(false);
    vi.stubGlobal('location', new URL('https://www.vesen.app/'));
    expect(isMixedContent('http://example.com/')).toBe(true);
    expect(isMixedContent('https://example.com/')).toBe(false);
    expect(isMixedContent('http://localhost:3000/')).toBe(false);
    expect(isMixedContent('http://127.0.0.1/')).toBe(false);
    vi.stubGlobal('location', new URL('http://localhost:4173/'));
    expect(isMixedContent('http://example.com/')).toBe(false);
  });
});
