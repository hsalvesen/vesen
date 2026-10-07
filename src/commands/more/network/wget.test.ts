// wget (docs/plan/08 wave D): a download into the files here through a fake fetch, with wget's
// words and exit codes for HTTP errors, CORS, offline, timeouts, files too big or not text,
// and files that cannot be written. Nothing here reaches the network.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runLine, session } from '../../../../tests/harness';
import { hang, responseAt, serveNet } from '../../../../tests/support/net';
import { humanSize, rate, remoteName } from './wget.run';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const text = (body: string, type = 'application/json'): Response =>
  new Response(body, { status: 200, headers: { 'content-type': type, 'content-length': String(new TextEncoder().encode(body).byteLength) } });

describe('wget', () => {
  it("saves a URL as the file it names, says what it did on stderr, and asks nothing else", async () => {
    const net = serveNet(() => text('{"slideshow": true}\n'));
    const s = await session();
    const { status, stdoutPlain, stderrPlain } = await s.run('wget https://httpbin.org/json');
    expect(status).toBe(0);
    expect(stdoutPlain).toBe('');
    expect(stderrPlain.split('\n')).toEqual([
      '--2026-10-06 20:01:00--  https://httpbin.org/json',
      'HTTP request sent from the browser, awaiting response... 200 OK',
      'Length: 20 [application/json]',
      "Saving to: ‘json’",
      '',
      "2026-10-06 20:01:00 (--.-KB/s) - ‘json’ saved [20/20]",
      '',
    ]);
    expect(s.app.vfs.readFile('/home/guest/json')).toBe('{"slideshow": true}\n');
    // A second download does not overwrite the first.
    expect((await s.run('wget -q httpbin.org/json')).status).toBe(0);
    expect(s.app.vfs.readFile('/home/guest/json.1')).toBe('{"slideshow": true}\n');
    s.stop();
    expect(net.requests.map((request) => request.url)).toEqual(['https://httpbin.org/json', 'https://httpbin.org/json']);
  });

  it('writes to the file -O names, or to the terminal with -O -, and says nothing with -q', async () => {
    serveNet(() => text('hello\n', 'text/plain'));
    const s = await session();
    expect(await s.run('wget -q -O notes.txt https://example.org/a')).toMatchObject({ status: 0, stdoutPlain: '', stderrPlain: '' });
    expect(s.app.vfs.readFile('/home/guest/notes.txt')).toBe('hello\n');
    // -O with two URLs puts both in the one file, as wget does.
    await s.run('wget -q -O both.txt https://example.org/a https://example.org/b');
    expect(s.app.vfs.readFile('/home/guest/both.txt')).toBe('hello\nhello\n');
    const out = await s.run('wget -O - https://example.org/a');
    expect(out.stdoutPlain).toBe('hello');
    expect(out.stderrPlain).toContain("Saving to: ‘STDOUT’");
    expect(out.stderrPlain).toContain('written to stdout [6/6]');
    s.stop();
  });

  it('shows the headers with -S, and where a redirect led', async () => {
    serveNet(() => responseAt('https://example.org/new', 'moved here', { headers: { 'content-type': 'text/plain' } }, true));
    const { stderrPlain } = await runLine('wget -S -O - https://example.org/old');
    expect(stderrPlain).toContain('Location: https://example.org/new [following]');
    expect(stderrPlain).toContain('  HTTP 200 OK\n  content-type: text/plain');
    expect(stderrPlain).toContain('Length: unspecified [text/plain]');
  });

  it('exits 8 on an HTTP error, saving nothing', async () => {
    serveNet(() => new Response('nope', { status: 404 }));
    const s = await session();
    const { status, stderrPlain } = await s.run('wget https://example.org/gone.txt');
    expect(status).toBe(8);
    expect(stderrPlain).toContain('HTTP request sent from the browser, awaiting response... 404 Not Found');
    expect(stderrPlain).toContain('2026-10-06 20:01:00 ERROR 404: Not Found.');
    expect(s.app.vfs.exists('/home/guest/gone.txt')).toBe(false);
    s.stop();
  });

  it('exits 4 when CORS or the network stops it, when offline, and when nothing answers', async () => {
    serveNet(() => Promise.reject(new TypeError('Failed to fetch')));
    const blocked = await runLine('wget https://example.com/');
    expect(blocked.status).toBe(4);
    expect(blocked.stderrPlain).toContain('Connecting to example.com... failed: blocked by CORS or unreachable (the browser does not say which).');

    const net = serveNet();
    vi.stubGlobal('navigator', { onLine: false });
    const offline = await runLine('wget https://example.com/');
    expect(offline).toMatchObject({ status: 4, stderrPlain: expect.stringContaining("wget: unable to resolve host address ‘example.com’: the browser is offline") });
    expect(net.requests).toEqual([]);
    vi.unstubAllGlobals();

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    serveNet((_url, init) => hang(init));
    const s = await session();
    const pending = s.run('wget https://slow.example/');
    await vi.advanceTimersByTimeAsync(8000);
    const slow = await pending;
    s.stop();
    expect(slow).toMatchObject({ status: 4, stderrPlain: expect.stringContaining('Connecting to slow.example... failed: no answer within 8 s.') });
  });

  it('saves nothing over 1 MB, or that is not text', async () => {
    serveNet(() => new Response('x', { headers: { 'content-length': String(2 * 1024 * 1024) } }));
    const big = await runLine('wget https://example.org/big.iso');
    expect(big).toMatchObject({ status: 1, stderrPlain: expect.stringContaining('wget: 2.0M is more than the 1 MB a file here may hold; nothing was saved') });

    serveNet(() => new Response(new Uint8Array(1024 * 1024 + 10).fill(65)));
    const unannounced = await session();
    expect((await unannounced.run('wget https://example.org/stream')).stderrPlain).toContain('wget: stopped at 1 MB, the most a file here may hold; nothing was saved');
    expect(unannounced.app.vfs.exists('/home/guest/stream')).toBe(false);
    unannounced.stop();

    serveNet(() => new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0])));
    expect((await runLine('wget https://example.org/logo.png')).stderrPlain).toContain("wget: https://example.org/logo.png is binary, and the files here hold text; nothing was saved");
  });

  it('exits 3 when the file cannot be written, and 1 for a URL it cannot fetch', async () => {
    serveNet(() => text('x'));
    expect(await runLine('wget -O /etc/x https://example.org/a')).toMatchObject({ status: 3, stderrPlain: expect.stringContaining('Cannot write to ‘/etc/x’ (Permission denied).') });
    expect(await runLine('wget ftp://example.org/a')).toMatchObject({ status: 1, stderrPlain: 'ftp://example.org/a: Unsupported scheme ‘ftp’.' });
    expect(await runLine('wget "https://exa mple.org/"')).toMatchObject({ status: 1, stderrPlain: 'https://exa mple.org/: Invalid URL.' });
    vi.stubGlobal('location', new URL('https://www.vesen.app/'));
    expect((await runLine('wget http://example.org/')).stderrPlain).toContain('failed: the browser blocks http:// on an https page (mixed content); try https://example.org/');
    expect(await runLine('wget')).toMatchObject({ status: 1, stderrPlain: "wget: missing URL\nTry 'wget --help' for more information." });
  });
});

describe("wget's words", () => {
  it('names files, sizes and speeds as wget does', () => {
    expect(['https://a.example/', 'https://a.example/dir/', 'https://a.example/x/notes%20v2.txt', 'https://a.example/%E0%A4%A'].map((url) => remoteName(new URL(url)))).toEqual([
      'index.html',
      'index.html',
      'notes v2.txt',
      '%E0%A4%A',
    ]);
    expect([512, 1256, 14 * 1024 * 1024 + 1].map(humanSize)).toEqual(['512', '1.2K', '14M']);
    expect([rate(1000, 0), rate(1000, 1000), rate(2_500_000, 2000)]).toEqual(['--.-KB/s', '1000 B/s', '1.19 MB/s']);
  });
});
