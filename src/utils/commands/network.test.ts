// @vitest-environment happy-dom
// The legacy commands read window and the theme store, so they need a DOM.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { networkCommands } from './network';

const UNREADABLE = 'stock: the quote service sent a response that could not be read. Try again later.';

/** The visible text of legacy HTML output. */
function text(html: string): string {
  const template = document.createElement('template');
  template.innerHTML = html;
  return template.content.textContent ?? '';
}

/** Answers the allorigins proxy with a Yahoo chart whose metadata is `meta`. */
function serveQuote(meta: Record<string, unknown>) {
  const contents = JSON.stringify({ chart: { result: [{ meta }], error: null } });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ contents, status: { http_code: 200 } })),
  );
}

const GOOD_META = {
  symbol: 'AAPL',
  longName: 'Apple Inc.',
  regularMarketPrice: 10,
  previousClose: 9,
  regularMarketVolume: 1234,
  regularMarketDayHigh: 11,
  regularMarketDayLow: 8,
  regularMarketOpen: 9.5,
};

beforeEach(() => {
  vi.stubGlobal('AudioContext', undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('stock with a hostile or broken quote', () => {
  it('renders a well-formed quote', async () => {
    serveQuote(GOOD_META);
    const output = text(await networkCommands.stock(['AAPL']));
    expect(output).toContain('Apple Inc.');
    expect(output).toContain('$10.00');
    expect(output).toContain('Volume: 1,234');
  });

  it.each([
    ['a string', '<img src=x onerror=alert(document.domain)>'],
    ['an array', ['<svg onload=alert(1)>']],
    ['an object', { toLocaleString: '<b>x</b>' }],
  ])('never puts a volume that is %s into the page', async (_kind, volume) => {
    serveQuote({ ...GOOD_META, regularMarketVolume: volume });
    const html = await networkCommands.stock(['AAPL']);

    expect(html).not.toMatch(/<img|<svg|<b>/);
    expect(text(html)).toContain('Volume: —');
  });

  it.each([
    ['a numeric string price', { regularMarketPrice: '10' }],
    ['no price', { regularMarketPrice: undefined }],
    ['an infinite price', { regularMarketPrice: Number.MAX_VALUE * 2 }],
  ])('reports %s as unreadable instead of crashing', async (_kind, fields) => {
    serveQuote({ ...GOOD_META, ...fields });
    expect(text(await networkCommands.stock(['AAPL']))).toBe(UNREADABLE);
  });

  it.each([['the open', 'regularMarketOpen'], ['the previous close', 'previousClose'], ['the day high', 'regularMarketDayHigh']])(
    'ignores %s when it is not a number',
    async (_kind, field) => {
      serveQuote({ ...GOOD_META, [field]: '9' });
      const output = text(await networkCommands.stock(['AAPL']));
      expect(output).toContain('$10.00');
      expect(output).not.toMatch(/Error|TypeError/);
    },
  );

  it('escapes a hostile company name', async () => {
    serveQuote({ ...GOOD_META, longName: '<img src=x onerror=alert(1)>' });
    const html = await networkCommands.stock(['AAPL']);
    expect(html).not.toContain('<img');
    expect(text(html)).toContain('<img src=x onerror=alert(1)>');
  });
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
