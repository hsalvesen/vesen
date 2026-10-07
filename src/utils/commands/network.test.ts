// @vitest-environment happy-dom
// The legacy commands read window and the theme store, so they need a DOM.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { networkCommands } from './network';

/** The visible text of legacy HTML output. */
function text(html: string): string {
  const template = document.createElement('template');
  template.innerHTML = html;
  return template.content.textContent ?? '';
}

beforeEach(() => {
  vi.stubGlobal('AudioContext', undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('curl failures name the real cause', () => {
  const failingFetch = () =>
    vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });

  it('refuses http:// on an https page as mixed content, without a request', async () => {
    const fetchMock = failingFetch();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('location', new URL('https://www.vesen.app/'));

    const output = text(await networkCommands.curl(['http://httpbin.org/get']));

    expect(output).toBe('curl: (1) http:// is blocked on an https page; try https://httpbin.org/get');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not blame CORS alone when a cross-origin request fails', async () => {
    vi.stubGlobal('fetch', failingFetch());
    vi.stubGlobal('location', new URL('https://www.vesen.app/'));

    expect(text(await networkCommands.curl(['nosuchhost.invalid']))).toBe(
      'curl: (7) nosuchhost.invalid: blocked by CORS or unreachable (the browser does not say which)',
    );
  });

  it('reports a failed same-origin request as a failed connection', async () => {
    vi.stubGlobal('fetch', failingFetch());
    vi.stubGlobal('location', new URL('https://www.vesen.app/'));

    expect(text(await networkCommands.curl(['https://www.vesen.app/README.md']))).toBe(
      'curl: (7) Failed to connect to www.vesen.app',
    );
  });

  it('reads at most 1 MB of a body and says it was truncated', async () => {
    // 4 MB in 64 kB pieces: big enough to show the cap, small enough that reading it all still ends.
    const chunk = 64 * 1024;
    let pulled = 0;
    const large = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += chunk;
        controller.enqueue(new Uint8Array(chunk).fill(0x61));
        if (pulled >= 4 * 1024 * 1024) controller.close();
      },
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(large)));

    const output = text(await networkCommands.curl(['speed.cloudflare.com/__down?bytes=50000000']));

    expect(output).toMatch(/^a{10000}\n\n\[Output truncated - content too long\]$/);
    expect(pulled).toBeLessThanOrEqual(1024 * 1024 + 2 * chunk);
  });
});
