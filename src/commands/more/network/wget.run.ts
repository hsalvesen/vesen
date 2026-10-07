// The body of wget; its spec, in wget.ts, loads this the first time wget runs.
//
// Each URL is fetched straight from the browser through the shell's net service, with the job's
// signal and an 8 s deadline to the headers, as curl does: a site must allow it (CORS), http://
// is blocked on an https page, and a failed request does not say whether CORS or the network
// stopped it, so wget says that. The body is read as it arrives into a file here, at most 1 MB,
// and only text: the files here hold text. wget's own exit codes: 1 generic, 3 a file that could
// not be written, 4 a network failure, 8 an error answer from the server.

import { out } from '../../../output/model';
import type { NetStream } from '../../../services/types';
import type { CommandContext, CommandDoc, ExitCode } from '../../../shell/types';
import { strerror } from '../../../vfs/errors';
import { VfsError } from '../../../vfs/types';
import { netReason, stamp } from '../../lib/net-words';
import { MAX_BODY_BYTES, targetUrl } from '../../network/curl.run';

/** What --help, help and man say about wget, besides its spec (wget.ts). */
export const doc: CommandDoc = {
  description:
    "Downloads each URL into a file here, named as the URL names it (index.html for a folder), with .1, .2 and so on added rather than overwrite a file; -O names the file, and -O - prints to the terminal. A URL without a scheme is https://. wget fetches straight from your browser, so the browser's rules apply: a site must allow pages to read it (CORS), and http:// is blocked on an https page. Files here hold text, at most 1 MB each.",
  man: [
    {
      heading: 'WHAT THE BROWSER ALLOWS',
      body: "When a site does not allow pages to read it, the browser reports the same failure as for a host that does not exist or refuses the connection, so wget says 'blocked by CORS or unreachable'. The browser follows redirects itself, and wget names where it ended up. The HTTP version is not visible, so the status line reads HTTP 200 OK.",
    },
    { heading: 'EXIT STATUS', body: '0 when every URL was saved. 1 for a bad URL, a file too big or not text. 3 when the file could not be written. 4 a network failure. 8 when the server answered with an error.' },
  ],
};

const REASONS: Readonly<Record<number, string>> = {
  200: 'OK', 201: 'Created', 204: 'No Content', 206: 'Partial Content', 301: 'Moved Permanently', 302: 'Found', 304: 'Not Modified',
  400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 405: 'Method Not Allowed', 410: 'Gone', 418: "I'm a teapot",
  429: 'Too Many Requests', 500: 'Internal Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable', 504: 'Gateway Timeout',
};

const reasonOf = (stream: Pick<NetStream, 'status' | 'statusText'>): string => stream.statusText || REASONS[stream.status] || '';

/** A size as wget gives it after Length: `1.2K`, `14M`. */
export function humanSize(bytes: number): string {
  const units = ['K', 'M', 'G'];
  let value = bytes;
  let unit = '';
  for (const next of units) {
    if (value < 1024) break;
    value /= 1024;
    unit = next;
  }
  return value < 10 && unit !== '' ? `${value.toFixed(1)}${unit}` : `${Math.round(value)}${unit}`;
}

/** A speed as wget gives it: `1.20 MB/s`, `253 KB/s`, or `--.-KB/s` when too quick to measure. */
export function rate(bytes: number, ms: number): string {
  if (ms <= 0) return '--.-KB/s';
  let value = bytes / (ms / 1000);
  let unit = 'B/s';
  for (const next of ['KB/s', 'MB/s', 'GB/s']) {
    if (value < 1024) break;
    value /= 1024;
    unit = next;
  }
  const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${unit}`;
}

/** The name wget saves a URL as: its last path segment, decoded where it can be, or index.html. */
export function remoteName(url: URL): string {
  const segment = url.pathname.split('/').pop() ?? '';
  let name = segment;
  try {
    name = decodeURIComponent(segment);
  } catch {
    // As written, when its escapes cannot be read.
  }
  return name === '' || name === '.' || name === '..' || name.includes('/') ? 'index.html' : name;
}

interface Run {
  readonly quiet: boolean;
  readonly headers: boolean;
  readonly output: string | null;
  /** -O's file has been started: later URLs are added to it. */
  started: boolean;
}

/** The first name not taken: NAME, then NAME.1, NAME.2… */
function freeName(ctx: CommandContext, name: string): string {
  if (!ctx.fs.exists(ctx.resolve(name))) return name;
  for (let n = 1; ; n += 1) if (!ctx.fs.exists(ctx.resolve(`${name}.${n}`))) return `${name}.${n}`;
}

type Body = { readonly text: string; readonly bytes: number } | 'binary' | 'too-big';

async function readBody(stream: NetStream): Promise<Body> {
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  for (;;) {
    const chunk = await stream.read();
    if (chunk === null) return { text: text + decoder.decode(), bytes };
    if (bytes === 0 && chunk.indexOf(0) !== -1) {
      stream.cancel();
      return 'binary';
    }
    bytes += chunk.byteLength;
    if (bytes > MAX_BODY_BYTES) {
      stream.cancel();
      return 'too-big';
    }
    text += decoder.decode(chunk, { stream: true });
  }
}

async function fetchOne(ctx: CommandContext, run: Run, word: string): Promise<ExitCode> {
  const log = async (line: string, fg?: 'error' | 'muted'): Promise<void> => {
    if (!run.quiet) await ctx.stderr.line(fg === undefined ? line : out.span(line, { fg }));
  };
  const url = targetUrl(word);
  if (url === null) {
    await log(`${word}: Invalid URL.`, 'error');
    return 1;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    await log(`${word}: Unsupported scheme ‘${url.protocol.slice(0, -1)}’.`, 'error');
    return 1;
  }
  await log(`--${stamp(ctx, '%Y-%m-%d %H:%M:%S')}--  ${url.href}`);
  if (ctx.net.mixedContent(url.href)) {
    await log(`failed: the browser blocks http:// on an https page (mixed content); try ${url.href.replace(/^http:/, 'https:')}`, 'error');
    return 4;
  }

  const started = ctx.clock.now();
  let stream: NetStream;
  try {
    stream = await ctx.net.open(url.href, { signal: ctx.signal, throwHttpErrors: false });
  } catch (error) {
    if (!ctx.net.isError(error) || error.kind === 'abort') throw error;
    if (error.kind === 'offline') await log(`wget: unable to resolve host address ‘${url.host}’: ${netReason(error)}`, 'error');
    else await log(`Connecting to ${url.host}... failed: ${netReason(error)}.`, 'error');
    return 4;
  }
  if (stream.redirected && stream.url !== '' && stream.url !== url.href) {
    await log(`Location: ${stream.url} [following]`);
    await log(`--${stamp(ctx, '%Y-%m-%d %H:%M:%S')}--  ${stream.url}`);
  }
  if (run.headers) {
    await log('HTTP request sent from the browser, awaiting response... ');
    await log(`  HTTP ${stream.status} ${reasonOf(stream)}`.trimEnd());
    for (const [name, value] of Object.entries(stream.headers)) await log(`  ${name}: ${value}`);
  } else {
    await log(`HTTP request sent from the browser, awaiting response... ${stream.status} ${reasonOf(stream)}`.trimEnd());
  }
  if (stream.status >= 400) {
    stream.cancel();
    await log(`${stamp(ctx, '%Y-%m-%d %H:%M:%S')} ERROR ${stream.status}: ${reasonOf(stream)}.`, 'error');
    return 8;
  }

  const type = (stream.headers['content-type'] ?? '').split(';')[0]?.trim() || 'unknown';
  const declared = Number(stream.headers['content-length']);
  const length = Number.isFinite(declared) && declared >= 0 && stream.headers['content-length'] !== undefined ? declared : null;
  await log(length === null ? `Length: unspecified [${type}]` : `Length: ${length}${length >= 1024 ? ` (${humanSize(length)})` : ''} [${type}]`);
  if (length !== null && length > MAX_BODY_BYTES) {
    stream.cancel();
    await log(`wget: ${humanSize(length)} is more than the 1 MB a file here may hold; nothing was saved`, 'error');
    return 1;
  }

  const target = run.output ?? freeName(ctx, remoteName(new URL(stream.url || url.href)));
  await log(`Saving to: ‘${target === '-' ? 'STDOUT' : target}’`);
  let body: Body;
  try {
    body = await readBody(stream);
  } catch (error) {
    if (ctx.signal.aborted || !ctx.net.isError(error) || error.kind === 'abort') throw error;
    await log(`Read error (${netReason(error)}); nothing was saved.`, 'error');
    return 4;
  }
  if (body === 'binary') {
    await log(`wget: ${url.href} is binary, and the files here hold text; nothing was saved`, 'error');
    return 1;
  }
  if (body === 'too-big') {
    await log('wget: stopped at 1 MB, the most a file here may hold; nothing was saved', 'error');
    return 1;
  }

  if (target === '-') {
    await ctx.stdout.write(body.text);
  } else {
    try {
      ctx.fs.writeFile(ctx.resolve(target), body.text, { append: run.output !== null && run.started });
    } catch (error) {
      if (!(error instanceof VfsError)) throw error;
      await log(`Cannot write to ‘${target}’ (${strerror(error.code)}).`, 'error');
      return 3;
    }
  }
  if (run.output !== null) run.started = true;
  const speed = rate(body.bytes, ctx.clock.now() - started);
  const saved = target === '-' ? 'written to stdout' : `‘${target}’ saved`;
  await log('');
  await log(`${stamp(ctx, '%Y-%m-%d %H:%M:%S')} (${speed}) - ${saved} [${body.bytes}/${length ?? body.bytes}]`);
  await log('');
  return 0;
}

export async function run(ctx: CommandContext): Promise<ExitCode> {
  if (ctx.args.length === 0) return ctx.usage('missing URL');
  const output = typeof ctx.opts['output-document'] === 'string' ? ctx.opts['output-document'] : null;
  const state: Run = { quiet: ctx.opts.quiet === true, headers: ctx.opts['server-response'] === true, output, started: false };
  let status: ExitCode = 0;
  for (const word of ctx.args) {
    const code = await fetchOne(ctx, state, word);
    if (code !== 0) status = code;
  }
  return status;
}
