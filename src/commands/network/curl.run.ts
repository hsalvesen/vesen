// The body of curl; its spec, in curl.ts, loads this the first time curl runs.
//
// Every request goes through the shell's net service (ctx.net.open) with the job's signal, so ^C
// stops it at once, and with a deadline: 8 s unless -m says otherwise. The body is read as it
// arrives and never past 1 MB. What the browser hides stays hidden, and curl says so: a failed
// cross-origin request looks the same whether CORS blocked it or the host is unreachable, and a
// redirect that is not followed shows neither its status nor its target.

import { combineSignals, deadline } from '../../lib/signals';
import { out } from '../../output/model';
import { REQUEST_TIMEOUT_MS, type NetStream } from '../../services/types';
import type { CommandContext, CommandDoc, ExitCode } from '../../shell/types';
import { strerror } from '../../vfs/errors';
import { VfsError } from '../../vfs/types';

/** What --help, help and man say about curl, besides its spec (curl.ts). */
export const doc: CommandDoc = {
  description:
    "Fetches each URL straight from your browser and prints the body. A URL without a scheme is https:// (http:// for localhost); file:///path reads a file here. The browser decides what a page may fetch: a site must allow it (CORS), http:// is blocked on an https page, and only the headers a site exposes can be read. curl says which of these stopped it, as far as the browser lets it know.",
  man: [
    {
      heading: 'WHAT THE BROWSER ALLOWS',
      body:
        "A page may read another site only when that site allows it, and when it does not, the browser reports the same failure as for a host that does not exist or a connection refused: curl calls all three (7). Redirects are followed only with -L; without it the browser hides the redirect, so curl says one happened. The HTTP version is not visible, so the status line reads HTTP 200 OK. Bodies stop at 1 MB, and the rest is never downloaded. Cookies are never sent to other sites.",
    },
    {
      heading: 'EXIT STATUS',
      body: '0 done. 1 a protocol the browser cannot fetch, or http:// on an https page. 2 bad usage. 3 a malformed URL. 6 offline. 7 blocked by CORS or unreachable. 22 an HTTP error with -f. 23 the output could not be written, or was binary. 28 timed out. 37 a file:// that cannot be read.',
    },
    {
      heading: 'PROXY',
      body: "With --via-proxy, where this site has a fetch proxy of its own, the request goes through it, and curl says so first: the proxy sees the URL. No public proxy is ever used.",
    },
  ],
};

/** The most of a body curl reads; the rest is never downloaded. */
export const MAX_BODY_BYTES = 1024 * 1024;
/** The longest -m allows here, inside the command's budget. */
export const MAX_TIME_MS = 55_000;

const ERROR = { fg: 'error' } as const;
const MUTED = { fg: 'muted' } as const;

const REASONS: Readonly<Record<number, string>> = {
  200: 'OK', 201: 'Created', 202: 'Accepted', 204: 'No Content', 206: 'Partial Content',
  301: 'Moved Permanently', 302: 'Found', 303: 'See Other', 304: 'Not Modified', 307: 'Temporary Redirect', 308: 'Permanent Redirect',
  400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 405: 'Method Not Allowed', 408: 'Request Timeout',
  409: 'Conflict', 410: 'Gone', 418: "I'm a teapot", 429: 'Too Many Requests',
  500: 'Internal Server Error', 501: 'Not Implemented', 502: 'Bad Gateway', 503: 'Service Unavailable', 504: 'Gateway Timeout',
};

const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

interface Options {
  readonly head: boolean;
  readonly include: boolean;
  readonly silent: boolean;
  readonly showError: boolean;
  readonly location: boolean;
  readonly fail: boolean;
  readonly output: string | null;
  readonly remoteName: boolean;
  readonly method: string | null;
  readonly headers: readonly (readonly [string, string])[];
  readonly data: string | null;
  readonly writeOut: string | null;
  readonly maxMs: number;
  readonly verbose: boolean;
  readonly viaProxy: boolean;
}

/** A failure with curl's own number for it. */
class Failure {
  constructor(
    readonly code: ExitCode,
    readonly message: string,
  ) {}
}

const list = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : typeof value === 'string' ? [value] : []);

/** The proxy curl --via-proxy uses, when the site is built with one. */
export function fetchProxy(): string | null {
  const configured = import.meta.env.VITE_FETCH_PROXY;
  return typeof configured === 'string' && /^https:\/\//.test(configured) ? configured : null;
}

async function readOptions(ctx: CommandContext): Promise<Options | Failure> {
  const o = ctx.opts;
  let maxMs: number = REQUEST_TIMEOUT_MS.default;
  if (o['max-time'] !== undefined) {
    const seconds = Number(o['max-time']);
    if (!Number.isFinite(seconds) || seconds <= 0) return new Failure(2, 'option -m: expected a proper numerical parameter');
    maxMs = Math.min(seconds * 1000, MAX_TIME_MS);
  }
  const headers: [string, string][] = [];
  for (const header of list(o.header)) {
    const colon = header.indexOf(':');
    // 'Name;' sends Name with no value, as curl does.
    const name = (colon === -1 ? header.replace(/;$/, '') : header.slice(0, colon)).trim();
    const value = colon === -1 ? '' : header.slice(colon + 1).trim();
    if (!HEADER_NAME.test(name) || (colon === -1 && !header.endsWith(';'))) {
      await warn(ctx, o.silent === true, `ignoring the header '${header}': write it as 'Name: value'`);
      continue;
    }
    headers.push([name, value]);
  }
  const parts: string[] = [];
  for (const value of list(o.data)) {
    if (!value.startsWith('@')) {
      parts.push(value);
      continue;
    }
    const name = value.slice(1);
    try {
      // As curl's -d reads a file: without its line breaks.
      parts.push((name === '-' ? await ctx.stdin.text() : ctx.fs.readFile(ctx.resolve(name))).replace(/[\r\n]/g, ''));
    } catch (error) {
      if (!(error instanceof VfsError)) throw error;
      return new Failure(26, `Failed to open/read local data from file/application: ${name}: ${strerror(error.code)}`);
    }
  }
  parts.push(...list(o['data-raw']));
  return {
    head: o.head === true,
    include: o.include === true,
    silent: o.silent === true,
    showError: o['show-error'] === true,
    location: o.location === true,
    fail: o.fail === true,
    output: typeof o.output === 'string' ? o.output : null,
    remoteName: o['remote-name'] === true,
    method: typeof o.request === 'string' ? o.request.toUpperCase() : null,
    headers,
    data: parts.length > 0 ? parts.join('&') : null,
    writeOut: typeof o['write-out'] === 'string' ? o['write-out'] : null,
    maxMs,
    verbose: o.verbose === true,
    viaProxy: o['via-proxy'] === true,
  };
}

async function warn(ctx: CommandContext, silent: boolean, message: string): Promise<void> {
  if (!silent) await ctx.stderr.line(out.span(`curl: ${message}`, MUTED));
}

/** Says a failure, unless -s without -S, and returns its number. */
async function report(ctx: CommandContext, o: Pick<Options, 'silent' | 'showError'>, failure: Failure): Promise<ExitCode> {
  if (!o.silent || o.showError) {
    const prefix = failure.code === 2 ? 'curl: ' : `curl: (${failure.code}) `;
    await ctx.stderr.line(out.span(prefix + failure.message, ERROR));
  }
  return failure.code;
}

/** This machine, which a page may fetch over http:// even from an https page. */
const LOOPBACK = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?(?:[/?#]|$)/i;

/**
 * The URL as typed, or null when it is malformed. Without a scheme it is https://, which a page
 * on https can fetch, except this machine, which is http:// as curl assumes.
 */
export function targetUrl(word: string): URL | null {
  try {
    return new URL(SCHEME.test(word) ? word : `${LOOPBACK.test(word) ? 'http' : 'https'}://${word}`);
  } catch {
    return null;
  }
}

/** curl's words for a failed request. */
function failureOf(ctx: CommandContext, error: unknown, host: string, ms: number, received: number, timedOut: boolean): Failure {
  if (!ctx.net.isError(error)) throw error;
  if (error.kind === 'timeout' || (error.kind === 'abort' && timedOut)) {
    return new Failure(28, `Operation timed out after ${ms} milliseconds with ${received} bytes received`);
  }
  switch (error.kind) {
    case 'offline':
      return new Failure(6, `Could not resolve host: ${host} (you appear to be offline)`);
    case 'cors':
      return new Failure(7, `${host}: blocked by CORS or unreachable (the browser does not say which)`);
    case 'network':
      // This site's own address, so CORS is not the cause.
      return new Failure(7, `Failed to connect to ${host}`);
    case 'http':
      return new Failure(22, `The requested URL returned error: ${error.status ?? 'unknown'}`);
    case 'parse':
      return new Failure(8, `Weird server reply from ${host}`);
    case 'abort':
      throw error;
  }
}

const statusLine = (stream: Pick<NetStream, 'status' | 'statusText'>): string =>
  `HTTP ${stream.status} ${stream.statusText || REASONS[stream.status] || ''}`.trimEnd();

/** curl -w: the variables it knows, %% and the backslash escapes. */
export function writeOut(format: string, values: Readonly<Record<string, string>>, unknown: (name: string) => void): string {
  return format.replace(/%\{([a-z_]+)\}|%%|\\([nrt\\])/g, (match: string, name: string | undefined, escape: string | undefined) => {
    if (escape !== undefined) return escape === 'n' ? '\n' : escape === 'r' ? '\r' : escape === 't' ? '\t' : '\\';
    if (name === undefined) return '%';
    const value = values[name];
    if (value === undefined) unknown(name);
    return value ?? '';
  });
}

/** Where the body goes: the terminal or a pipe, or a file. */
interface Sink {
  write(text: string): Promise<void>;
  /** Writes what a file collected; nothing for stdout. */
  close(): Promise<Failure | null>;
  readonly tty: boolean;
}

function sinkFor(ctx: CommandContext, path: string | null): Sink {
  if (path === null || path === '-') return { write: (text) => ctx.stdout.write(text), close: async () => null, tty: ctx.stdout.isTTY };
  let collected = '';
  return {
    tty: false,
    write: async (text) => {
      collected += text;
    },
    close: async () => {
      try {
        ctx.fs.writeFile(ctx.resolve(path), collected);
        return null;
      } catch (error) {
        if (!(error instanceof VfsError)) throw error;
        return new Failure(23, `Failure writing output to destination: ${path}: ${strerror(error.code)}`);
      }
    },
  };
}

const BINARY_WARNING =
  'Warning: Binary output can mess up your terminal. Use "--output -" to tell curl to output it to your terminal anyway, or consider "--output <FILE>" to save to a file.';

/** Reads `stream` into `sink`, at most MAX_BODY_BYTES; the bytes read, and whether it stopped short. */
async function copyBody(ctx: CommandContext, stream: NetStream, sink: Sink, forced: boolean, counted: { bytes: number }): Promise<'done' | 'truncated' | 'binary'> {
  const decoder = new TextDecoder();
  let first = true;
  for (;;) {
    const chunk = await stream.read();
    if (chunk === null) {
      const rest = decoder.decode();
      if (rest !== '') await sink.write(rest);
      return 'done';
    }
    if (first && sink.tty && !forced && chunk.indexOf(0) !== -1) {
      stream.cancel();
      return 'binary';
    }
    first = false;
    const room = MAX_BODY_BYTES - counted.bytes;
    const piece = chunk.byteLength > room ? chunk.subarray(0, room) : chunk;
    counted.bytes += piece.byteLength;
    // A character cut by the cap stays in the decoder and is dropped.
    const text = decoder.decode(piece, { stream: true });
    if (text !== '') await sink.write(text);
    if (piece !== chunk || counted.bytes >= MAX_BODY_BYTES) {
      // At exactly the cap, a body that has ended is whole.
      if (piece === chunk && (await stream.read()) === null) return 'done';
      stream.cancel();
      return 'truncated';
    }
  }
}

/** A percent-decoded part of a URL, or null when its escapes are malformed (%zz, or %E0%A4%A cut short). */
function percentDecoded(part: string): string | null {
  try {
    return decodeURIComponent(part);
  } catch {
    return null;
  }
}

async function fetchFile(ctx: CommandContext, o: Options, url: URL, sink: Sink): Promise<{ code: ExitCode; bytes: number }> {
  const path = percentDecoded(url.pathname);
  if (path === null) return { code: await report(ctx, o, new Failure(3, 'URL rejected: Malformed input to a URL function')), bytes: 0 };
  let text: string;
  try {
    if (url.host !== '' && url.host !== 'localhost') throw new Failure(37, `Couldn't read a file:// file from another host: ${url.host}`);
    text = ctx.fs.readFile(path);
  } catch (error) {
    if (error instanceof Failure) return { code: await report(ctx, o, error), bytes: 0 };
    if (!(error instanceof VfsError)) throw error;
    return { code: await report(ctx, o, new Failure(37, `Couldn't open file ${path}`)), bytes: 0 };
  }
  const bytes = new TextEncoder().encode(text).byteLength;
  if (o.head || o.include) await sink.write(`Content-Length: ${bytes}\n\n`);
  if (!o.head) await sink.write(text);
  return { code: 0, bytes };
}

async function fetchOne(ctx: CommandContext, o: Options, word: string, outputPath: string | null): Promise<ExitCode> {
  const url = targetUrl(word);
  if (url === null) return report(ctx, o, new Failure(3, 'URL rejected: Malformed input to a URL function'));

  let path = outputPath;
  if (path === null && o.remoteName) {
    // As named in the URL; decoded where its escapes allow, as typed where they do not.
    const segment = url.pathname.split('/').pop() ?? '';
    const name = percentDecoded(segment) ?? segment;
    if (name === '') return report(ctx, o, new Failure(23, 'Remote file name has no length'));
    path = name;
  }
  const sink = sinkFor(ctx, path);
  const started = ctx.clock.now();
  const counted = { bytes: 0 };
  let code: ExitCode = 0;
  let response: { status: number; url: string; contentType: string; location: string; method: string } = {
    status: 0,
    url: url.href,
    contentType: '',
    location: '',
    method: 'GET',
  };

  if (url.protocol === 'file:') {
    const result = await fetchFile(ctx, o, url, sink);
    code = result.code;
    counted.bytes = result.bytes;
  } else if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return report(ctx, o, new Failure(1, `Protocol "${url.protocol.slice(0, -1)}" not supported`));
  } else {
    const result = await fetchHttp(ctx, o, url, sink, counted);
    if (result instanceof Failure) return report(ctx, o, result);
    response = result;
  }

  const closed = await sink.close();
  if (closed !== null) return report(ctx, o, closed);
  if (o.writeOut !== null && code === 0) {
    const values: Record<string, string> = {
      http_code: String(response.status).padStart(3, '0'),
      response_code: String(response.status).padStart(3, '0'),
      url_effective: response.url,
      content_type: response.contentType,
      size_download: String(counted.bytes),
      time_total: ((ctx.clock.now() - started) / 1000).toFixed(6),
      method: response.method,
      redirect_url: response.location,
      exitcode: '0',
    };
    const unknown: string[] = [];
    const text = writeOut(o.writeOut, values, (name) => unknown.push(name));
    for (const name of unknown) await warn(ctx, o.silent, `unknown --write-out variable: '${name}'`);
    if (text !== '') await ctx.stdout.write(text);
  }
  return code;
}

async function fetchHttp(
  ctx: CommandContext,
  o: Options,
  url: URL,
  sink: Sink,
  counted: { bytes: number },
): Promise<Failure | { status: number; url: string; contentType: string; location: string; method: string }> {
  const method = o.method ?? (o.head ? 'HEAD' : o.data !== null ? 'POST' : 'GET');
  if (o.data !== null && (method === 'GET' || method === 'HEAD')) {
    return new Failure(2, `the browser cannot send data with ${method}; leave out -X, or use -X POST`);
  }
  let target = url.href;
  if (o.viaProxy) {
    const proxy = fetchProxy();
    if (proxy === null) return new Failure(2, '--via-proxy: this site has no fetch proxy of its own');
    target = `${proxy}${proxy.includes('?') ? '&' : '?'}url=${encodeURIComponent(url.href)}`;
    await warn(ctx, o.silent, `fetching through vesen's proxy at ${new URL(proxy).host}, which sees this URL`);
  } else if (ctx.net.mixedContent(url.href)) {
    return new Failure(1, `the browser blocks http:// on an https page (mixed content); try ${url.href.replace(/^http:/, 'https:')}`);
  }

  const headers: Record<string, string> = {};
  for (const [name, value] of o.headers) headers[name] = value;
  if (o.data !== null && !Object.keys(headers).some((name) => name.toLowerCase() === 'content-type')) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }
  if (o.verbose && !o.silent) {
    const rows = [`> ${method} ${url.pathname}${url.search} HTTP`, `> Host: ${url.host}`, ...Object.entries(headers).map(([n, v]) => `> ${n}: ${v}`), '>'];
    for (const row of rows) await ctx.stderr.write(`${row}\n`);
  }

  const limit = deadline(o.maxMs);
  const signal = combineSignals(ctx.signal, limit.signal);
  const host = o.viaProxy ? new URL(target).host : url.host;
  let stream: NetStream;
  try {
    try {
      stream = await ctx.net.open(target, {
        method,
        headers,
        ...(o.data === null ? {} : { body: o.data }),
        signal,
        timeoutMs: o.maxMs,
        throwHttpErrors: false,
        redirect: o.location ? 'follow' : 'manual',
      });
    } catch (error) {
      if (ctx.signal.aborted) throw error;
      return failureOf(ctx, error, host, o.maxMs, 0, limit.signal.aborted);
    }

    const result = {
      status: stream.status,
      url: stream.url || url.href,
      contentType: stream.headers['content-type'] ?? '',
      location: stream.headers.location ?? '',
      method,
    };
    if (stream.type === 'opaqueredirect') {
      stream.cancel();
      await warn(ctx, o.silent, 'the site answered with a redirect, which the browser hides; follow it with -L');
      return result;
    }
    const head = [statusLine(stream), ...Object.entries(stream.headers).map(([name, value]) => `${name}: ${value}`)];
    if (o.verbose && !o.silent) {
      for (const row of head) await ctx.stderr.write(`< ${row}\n`);
      await ctx.stderr.write('<\n');
    }
    if (o.fail && stream.status >= 400) {
      stream.cancel();
      return new Failure(22, `The requested URL returned error: ${stream.status}`);
    }
    if (stream.status >= 300 && stream.status < 400 && !o.location) {
      const where = result.location === '' ? '' : ` to ${result.location}`;
      await warn(ctx, o.silent, `${statusLine(stream)}: a redirect${where}; follow it with -L`);
    }
    if (o.head || o.include) {
      await sink.write(`${head.join('\n')}\n\n`);
      // Another site's response shows the page only the headers that site exposes.
      if (stream.type === 'cors') await warn(ctx, o.silent, 'the browser shows only the headers the site lets pages read');
    }
    if (o.head || method === 'HEAD') {
      stream.cancel();
      return result;
    }
    let ended: 'done' | 'truncated' | 'binary';
    try {
      ended = await copyBody(ctx, stream, sink, o.output === '-', counted);
    } catch (error) {
      if (ctx.signal.aborted) throw error;
      return failureOf(ctx, error, host, o.maxMs, counted.bytes, limit.signal.aborted);
    }
    if (ended === 'binary') {
      if (!o.silent) await ctx.stderr.line(out.span(BINARY_WARNING, { fg: 'warn' }));
      return new Failure(23, 'Failure writing output to destination');
    }
    if (ended === 'truncated') await warn(ctx, o.silent, 'stopped at 1 MB; the rest was not downloaded');
    return result;
  } finally {
    limit.cancel();
  }
}

export async function run(ctx: CommandContext): Promise<ExitCode> {
  const options = await readOptions(ctx);
  if (options instanceof Failure) return report(ctx, { silent: false, showError: true }, options);
  if (ctx.args.length === 0) return ctx.usage('no URL specified');
  let status: ExitCode = 0;
  for (let i = 0; i < ctx.args.length; i += 1) {
    // -o names the first URL's file; the rest go to stdout, as curl pairs them.
    const code = await fetchOne(ctx, options, ctx.args[i] ?? '', i === 0 ? options.output : null);
    if (code !== 0) status = code;
  }
  return status;
}
