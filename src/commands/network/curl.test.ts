// curl (docs/plan/07-stock-and-proxy.md, "curl"; docs/plan/08 wave D; F038): a direct fetch through
// the shell's net service, its flags, curl's own error numbers, and the 1 MB cap. fetch is a
// mock throughout: nothing here reaches the network.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runLine, session } from '../../../tests/harness';
import { MAX_BODY_BYTES, targetUrl, writeOut } from './curl.run';

type FetchArgs = [string, RequestInit & { headers?: Record<string, string> }];

/** Answers every request with `body`, and records what was asked. */
function serve(body: BodyInit | null, init: ResponseInit = { status: 200, headers: { 'content-type': 'text/plain' } }) {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(body, init));
  vi.stubGlobal('fetch', fetchMock);
  return {
    fetchMock,
    calls: (): FetchArgs[] => fetchMock.mock.calls.map(([url, request]) => [url, (request ?? {}) as FetchArgs[1]]),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('curl prints what it fetches', () => {
  it('prints the body and exits 0, and passes it unchanged through a pipe', async () => {
    serve('{"ok":true}\nsecond line\n');
    const shown = await runLine('curl https://api.example.com/x');
    expect(shown).toMatchObject({ status: 0, stdoutPlain: '{"ok":true}\nsecond line', stderrPlain: '' });
    const piped = await runLine('curl https://api.example.com/x', { tty: false });
    expect(piped.stdoutPlain).toBe('{"ok":true}\nsecond line');
  });

  it('means https:// when the URL names no scheme', async () => {
    const { calls } = serve('hi');
    await runLine('curl example.com/page');
    expect(calls()[0]?.[0]).toBe('https://example.com/page');
    expect(targetUrl('localhost:8080/x')?.href).toBe('http://localhost:8080/x');
    expect(targetUrl('127.0.0.1')?.href).toBe('http://127.0.0.1/');
    expect(targetUrl('localhost.example.com')?.href).toBe('https://localhost.example.com/');
    expect(targetUrl('https://exa mple.com')).toBeNull();
  });

  it('shows the status line and the headers with -i, and only them with -I, which asks with HEAD', async () => {
    const { calls } = serve('body', { status: 200, headers: { 'content-type': 'text/plain', 'x-thing': 'yes' } });
    const include = await runLine('curl -i https://example.com/');
    expect(include.stdoutPlain).toBe('HTTP 200 OK\ncontent-type: text/plain\nx-thing: yes\n\nbody');
    const head = await runLine('curl -I https://example.com/');
    // A blank line ends the headers, as curl -I prints them.
    expect(head.stdoutPlain).toBe('HTTP 200 OK\ncontent-type: text/plain\nx-thing: yes\n');
    expect(calls()[1]?.[1].method).toBe('HEAD');
  });

  it('sends a method, headers and form data: -X, -H and -d, and @FILE reads a file', async () => {
    const { calls } = serve('ok');
    const s = await session();
    s.app.vfs.writeFile('/home/guest/form.txt', 'from=file\n');
    await s.run("curl -X PUT -H 'X-Token: abc' -H 'bad header' -d a=1 -d b=2 https://example.com/put");
    await s.run('curl -d @form.txt --data-raw @raw https://example.com/post');
    s.stop();
    const [put, post] = calls();
    expect(put?.[1]).toMatchObject({
      method: 'PUT',
      body: 'a=1&b=2',
      headers: { 'X-Token': 'abc', 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    expect(post?.[1]).toMatchObject({ method: 'POST', body: 'from=file&@raw' });
  });

  it('warns about a header it cannot send, and refuses data with GET', async () => {
    serve('ok');
    const warned = await runLine("curl -H 'nonsense' https://example.com/");
    expect(warned.stderrPlain).toBe("curl: ignoring the header 'nonsense': write it as 'Name: value'");
    const refused = await runLine('curl -X GET -d a=1 https://example.com/');
    expect(refused).toMatchObject({ status: 2, stderrPlain: 'curl: the browser cannot send data with GET; leave out -X, or use -X POST' });
  });

  it('writes the body into a file with -o, or one named as the URL names it with -O', async () => {
    serve('saved\n');
    const s = await session();
    const output = await s.run('curl -o page.txt https://example.com/a');
    const remote = await s.run('curl -O https://example.com/files/notes.md');
    const nameless = await s.run('curl -O https://example.com/');
    expect(output).toMatchObject({ status: 0, stdoutPlain: '' });
    expect(s.app.vfs.readFile('/home/guest/page.txt')).toBe('saved\n');
    expect(remote.status).toBe(0);
    expect(s.app.vfs.readFile('/home/guest/notes.md')).toBe('saved\n');
    expect(nameless).toMatchObject({ status: 23, stderrPlain: 'curl: (23) Remote file name has no length' });
    const denied = await s.run('curl -o /etc/x https://example.com/a');
    expect(denied).toMatchObject({ status: 23, stderrPlain: 'curl: (23) Failure writing output to destination: /etc/x: Permission denied' });
    s.stop();
  });

  it('prints -w after the transfer: the status code and more', async () => {
    serve('missing', { status: 404 });
    const result = await runLine("curl -s -o /dev/null -w '%{http_code} %{size_download} %{method}\\n' https://example.com/gone");
    expect(result).toMatchObject({ status: 0, stdoutPlain: '404 7 GET' });
    const unknown: string[] = [];
    expect(writeOut('%{nope}100%%\\t\\\\', {}, (name) => unknown.push(name))).toBe('100%\t\\');
    expect(unknown).toEqual(['nope']);
  });

  it('reads a file:// URL from the files here', async () => {
    expect(await runLine('curl file:///etc/hostname')).toMatchObject({ status: 0, stdoutPlain: 'vesen' });
    expect(await runLine('curl file:///nope')).toMatchObject({ status: 37, stderrPlain: "curl: (37) Couldn't open file /nope" });
  });
});

describe('curl and HTTP errors', () => {
  it('prints an error page and exits 0, as curl does without -f', async () => {
    serve('no such page', { status: 404 });
    expect(await runLine('curl https://example.com/gone')).toMatchObject({ status: 0, stdoutPlain: 'no such page' });
  });

  it('fails with 22 and no output on an HTTP error with -f', async () => {
    serve('no such page', { status: 404 });
    expect(await runLine('curl -f https://example.com/gone')).toMatchObject({
      status: 22,
      stdoutPlain: '',
      stderrPlain: 'curl: (22) The requested URL returned error: 404',
    });
  });

  it('says a redirect the browser hides happened, and follows redirects only with -L', async () => {
    const opaque = { type: 'opaqueredirect', status: 0, ok: false, statusText: '', url: '', redirected: false, headers: new Headers(), body: null };
    const fetchMock = vi.fn(async () => opaque as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);
    const hidden = await runLine('curl https://example.com/old');
    expect(hidden).toMatchObject({ status: 0, stdoutPlain: '', stderrPlain: 'curl: the site answered with a redirect, which the browser hides; follow it with -L' });
    expect((fetchMock.mock.calls[0] as unknown as FetchArgs)[1].redirect).toBe('manual');

    const { calls } = serve('moved', { status: 301, headers: { location: 'https://example.com/new' } });
    const visible = await runLine('curl https://example.com/old');
    expect(visible.stderrPlain).toBe('curl: HTTP 301 Moved Permanently: a redirect to https://example.com/new; follow it with -L');
    await runLine('curl -sL https://example.com/old');
    expect(calls()[1]?.[1].redirect).toBe('follow');
  });
});

describe("curl's own error numbers", () => {
  it('(6) when the browser is offline, without a request', async () => {
    const { fetchMock } = serve('x');
    vi.stubGlobal('navigator', { onLine: false });
    expect(await runLine('curl https://example.com/')).toMatchObject({
      status: 6,
      stderrPlain: 'curl: (6) Could not resolve host: example.com (you appear to be offline)',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('(7) for a cross-origin failure, which the browser does not explain', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    expect(await runLine('curl nosuchhost.invalid')).toMatchObject({
      status: 7,
      stderrPlain: 'curl: (7) nosuchhost.invalid: blocked by CORS or unreachable (the browser does not say which)',
    });
  });

  it('(28) when -m runs out', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
    expect(await runLine('curl -m 0.05 https://slow.example/')).toMatchObject({
      status: 28,
      stderrPlain: 'curl: (28) Operation timed out after 50 milliseconds with 0 bytes received',
    });
    expect(await runLine('curl -m soon https://slow.example/')).toMatchObject({ status: 2, stderrPlain: 'curl: option -m: expected a proper numerical parameter' });
  });

  it('(1) for http:// on an https page, without a request, and for a protocol the browser cannot fetch', async () => {
    const { fetchMock } = serve('x');
    vi.stubGlobal('location', new URL('https://www.vesen.app/'));
    expect(await runLine('curl http://example.com/')).toMatchObject({
      status: 1,
      stderrPlain: 'curl: (1) the browser blocks http:// on an https page (mixed content); try https://example.com/',
    });
    expect(await runLine('curl ftp://example.com/')).toMatchObject({ status: 1, stderrPlain: 'curl: (1) Protocol "ftp" not supported' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('(3) for a malformed URL, and says nothing with -s unless -S', async () => {
    expect(await runLine('curl "https://exa mple.com"')).toMatchObject({ status: 3, stderrPlain: 'curl: (3) URL rejected: Malformed input to a URL function' });
    expect(await runLine('curl -s "https://exa mple.com"')).toMatchObject({ status: 3, stderrPlain: '' });
    expect((await runLine('curl -sS "https://exa mple.com"')).stderrPlain).toContain('(3)');
  });

  it('asks for a URL', async () => {
    expect(await runLine('curl')).toMatchObject({ status: 2, stderrPlain: "curl: no URL specified\nTry 'curl --help' for more information." });
  });
});

describe('the 1 MB cap', () => {
  it('reads at most 1 MB of a body, says so, and never downloads the rest', async () => {
    const chunk = 64 * 1024;
    let pulled = 0;
    const large = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += chunk;
        controller.enqueue(new Uint8Array(chunk).fill(0x61));
        if (pulled >= 4 * 1024 * 1024) controller.close();
      },
    });
    serve(large);
    const result = await runLine('curl https://speed.example/big', { tty: false });
    expect(result.stdoutPlain).toHaveLength(MAX_BODY_BYTES);
    expect(result.stderrPlain).toBe('curl: stopped at 1 MB; the rest was not downloaded');
    expect(pulled).toBeLessThanOrEqual(MAX_BODY_BYTES + 2 * chunk);
  });

  it('does not print binary to the terminal unless asked to', async () => {
    serve(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 1]));
    const result = await runLine('curl https://example.com/logo.png');
    expect(result.status).toBe(23);
    expect(result.stdoutPlain).toBe('');
    expect(result.stderrPlain).toContain('Warning: Binary output can mess up your terminal.');
    serve(new Uint8Array([0x41, 0, 0x42]));
    expect((await runLine('curl -o - https://example.com/logo.png')).status).toBe(0);
  });
});

describe('--via-proxy', () => {
  it('is refused where the site has no proxy of its own', async () => {
    const { fetchMock } = serve('x');
    expect(await runLine('curl --via-proxy https://example.com/')).toMatchObject({
      status: 2,
      stderrPlain: "curl: --via-proxy: this site has no fetch proxy of its own",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("goes through the site's proxy when it has one, and says so first", async () => {
    vi.stubEnv('VITE_FETCH_PROXY', 'https://proxy.example/fetch');
    const { calls } = serve('through');
    const result = await runLine('curl --via-proxy https://example.com/a?b=c');
    expect(result).toMatchObject({
      status: 0,
      stdoutPlain: 'through',
      stderrPlain: "curl: fetching through vesen's proxy at proxy.example, which sees this URL",
    });
    expect(calls()[0]?.[0]).toBe('https://proxy.example/fetch?url=https%3A%2F%2Fexample.com%2Fa%3Fb%3Dc');
  });
});
