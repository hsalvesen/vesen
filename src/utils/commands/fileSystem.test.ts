// @vitest-environment happy-dom
// The legacy file system reads window and navigator when it is built, so it needs a DOM.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fileSystemCommands } from './fileSystem';

/** The visible text of legacy HTML output. */
function text(html: string): string {
  const template = document.createElement('template');
  template.innerHTML = html;
  return template.content.textContent ?? '';
}

/** A fetch that never answers and ignores its signal, like a stalled phone connection. */
const stalledFetch = () => vi.fn((_url: string, _init?: RequestInit) => new Promise<Response>(() => {}));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.stubGlobal('AudioContext', undefined);
  vi.stubGlobal('location', new URL('https://www.vesen.app/'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('cat of a file the site serves', () => {
  it('reads README.md through one request', async () => {
    const fetchMock = vi.fn(async () => new Response('# vesen\nhello'));
    vi.stubGlobal('fetch', fetchMock);

    expect(await fileSystemCommands.cat(['README.md'])).toBe('# vesen<br>hello');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('passes the job signal on, so cancelling stops the request at once', async () => {
    const fetchMock = stalledFetch();
    vi.stubGlobal('fetch', fetchMock);
    const job = new AbortController();

    const output = fileSystemCommands.cat(['README.md'], job.signal);
    job.abort();

    expect(text(await output)).toBe('cat cancelled');
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it('gives up after the 8 s deadline instead of waiting forever, without retrying other paths', async () => {
    const fetchMock = stalledFetch();
    vi.stubGlobal('fetch', fetchMock);

    let settled = false;
    const output = fileSystemCommands.cat(['README.md']).finally(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(7999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    expect(text(await output)).toBe('cat: README.md: www.vesen.app: no response within 8000 ms');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('tries the next path only when the server says the file is missing', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('Not Found', { status: 404 }))
      .mockResolvedValueOnce(new Response('second path'));
    vi.stubGlobal('fetch', fetchMock);

    expect(await fileSystemCommands.cat(['README.md'])).toBe('second path');
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/README.md', './README.md']);
  });
});
