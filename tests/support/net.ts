// Test helpers for the network commands of wave D (dig, host, nslookup, ping, ip, ifconfig,
// whois, wget, git): a fetch that answers from the recorded fixtures in tests/fixtures/net (see
// its README), records every request, and lets a test answer some requests itself. Nothing
// here reaches the network.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { vi } from 'vitest';
import { RR_TYPES } from '../../src/commands/lib/dns';
import type { StorageKey } from '../../src/services/storage-keys';
import type { KV } from '../../src/services/types';

const FIXTURES = join(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures'), 'net');

/** A recorded body from tests/fixtures/net, as text. */
export function fixtureText(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8');
}

/** A recorded body from tests/fixtures/net, parsed. */
export function fixture(name: string): unknown {
  return JSON.parse(fixtureText(name)) as unknown;
}

/** The recorded DNS-over-HTTPS answers, by `<resolver host> <name> <TYPE>`. */
export const DOH = fixture('doh.json') as Record<string, Record<string, unknown>>;

/** A recorded answer, by resolver host, name and type. */
export function doh(host: 'cloudflare-dns.com' | 'dns.google', name: string, type: keyof typeof RR_TYPES): Record<string, unknown> {
  const body = DOH[`${host} ${name} ${type}`];
  if (body === undefined) throw new Error(`no recorded answer for ${host} ${name} ${type}`);
  return body;
}

/** A response with a URL and redirect flag of its own, as one that followed a redirect has. */
export function responseAt(url: string, body: BodyInit | null, init: ResponseInit = {}, redirected = false): Response {
  const response = new Response(body, init);
  Object.defineProperty(response, 'url', { value: url });
  Object.defineProperty(response, 'redirected', { value: redirected });
  return response;
}

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const TYPE_BY_NUMBER = new Map<string, string>(Object.entries(RR_TYPES).map(([name, n]) => [String(n), name]));

/** Which fixture answers a URL; undefined when none does. */
export function recorded(url: URL): Response | undefined {
  switch (url.host) {
    case 'cloudflare-dns.com':
    case 'dns.google': {
      const raw = url.searchParams.get('type') ?? '1';
      const type = TYPE_BY_NUMBER.get(raw) ?? raw.toUpperCase();
      const body = DOH[`${url.host} ${url.searchParams.get('name') ?? ''} ${type}`];
      return body === undefined ? undefined : json(body, 200, { 'content-type': 'application/dns-json' });
    }
    case 'rdap.org': {
      const domain = decodeURIComponent(url.pathname.replace(/^\/domain\//, ''));
      if (domain === 'example.com') {
        return responseAt('https://rdap.verisign.com/com/v1/domain/example.com', fixtureText('rdap-example.com.json'), { headers: { 'content-type': 'application/rdap+json' } }, true);
      }
      if (domain === 'vesen.app') {
        return responseAt('https://pubapi.registry.google/rdap/domain/vesen.app', fixtureText('rdap-vesen.app.json'), { headers: { 'content-type': 'application/rdap+json; charset=utf-8' } }, true);
      }
      if (domain === 'nosuchname-vesen-test.com') {
        // The registry's own 404 has an empty body.
        return responseAt('https://rdap.verisign.com/com/v1/domain/nosuchname-vesen-test.com', '', { status: 404, headers: { 'content-type': 'application/rdap+json' } }, true);
      }
      // rdap.org knows no registry for the TLD, and answers itself.
      return responseAt(url.href, fixtureText('rdap-no-service.json'), { status: 404, headers: { 'content-type': 'application/rdap+json' } });
    }
    case 'www.cloudflare.com':
      return url.pathname === '/cdn-cgi/trace' ? new Response(fixtureText('cloudflare-trace.txt'), { headers: { 'content-type': 'text/plain' } }) : undefined;
    case 'api.github.com':
      return json(fixture('github-commits.json'), 200, { 'x-ratelimit-limit': '60', 'x-ratelimit-remaining': '56' });
    default:
      return undefined;
  }
}

export interface Request {
  readonly url: string;
  readonly init: RequestInit;
}

/** Answers a request itself, or returns undefined to fall through to the fixtures. */
export type Responder = (url: URL, init: RequestInit) => Response | Promise<Response> | undefined;

/**
 * Stubs fetch with the fixtures, `respond` first. A request nothing answers fails as a browser
 * fails one it cannot make (a TypeError), so a missing fixture shows as unreachable.
 */
export function serveNet(respond?: Responder) {
  const requests: Request[] = [];
  const fetchMock = vi.fn(async (input: string | URL, init: RequestInit = {}): Promise<Response> => {
    const href = String(input);
    requests.push({ url: href, init });
    const url = new URL(href);
    const answer = (await respond?.(url, init)) ?? recorded(url);
    if (answer === undefined) throw new TypeError('Failed to fetch');
    return answer;
  });
  vi.stubGlobal('fetch', fetchMock);
  return {
    requests,
    fetchMock,
    /** The hosts asked, in order. */
    hosts: (): string[] => requests.map((request) => new URL(request.url).host),
  };
}

/** A fetch that never answers until the request is cancelled, as a host that does not respond. */
export const hang = (init: RequestInit): Promise<Response> =>
  new Promise<Response>((_, reject) => {
    init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
  });

/** A session storage area backed by a Map. */
export function memorySession(): KV<'session'> & { readonly store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    persistent: true,
    get: (key: StorageKey<'session'>) => store.get(key) ?? null,
    set: (key: StorageKey<'session'>, value: string) => {
      store.set(key, value);
      return true;
    },
    remove: (key: StorageKey<'session'>) => {
      store.delete(key);
    },
    getJson<T>(key: StorageKey<'session'>, parse: (raw: unknown) => T | undefined): T | undefined {
      const raw = store.get(key);
      if (raw === undefined) return undefined;
      try {
        return parse(JSON.parse(raw));
      } catch {
        return undefined;
      }
    },
    setJson: (key: StorageKey<'session'>, value: unknown) => {
      store.set(key, JSON.stringify(value));
      return true;
    },
  };
}
