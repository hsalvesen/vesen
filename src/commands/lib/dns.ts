// DNS for dig, host, nslookup and ping. A browser cannot send DNS packets, so every question goes
// as DNS over HTTPS in its JSON form: to Cloudflare (https://cloudflare-dns.com/dns-query, with
// `accept: application/dns-json`) and, when Cloudflare cannot be reached, to Google
// (https://dns.google/resolve), each within 5 s, through the shell's net service with the
// command's signal. Answers are kept for their TTL, per net service (that is, per page), as a
// stub resolver keeps them. `localhost` and the names under it are answered here, without
// asking anyone (RFC 6761), as the system's own resolver answers them: both services would say
// NXDOMAIN.
//
// Everything here is DOM-free; the commands' bodies import it, so it loads with them.

import type { Clock, Net, NetError } from '../../services/types';

// ── Resolvers ──────────────────────────────────────────────────────────────────────────────

export type ResolverName = 'cloudflare' | 'google';

export interface Resolver {
  readonly name: ResolverName;
  /** As the output names it: `Cloudflare`. */
  readonly label: string;
  /** The host the question goes to. */
  readonly host: string;
  /** The endpoint, for nslookup's Address line and the man pages. */
  readonly endpoint: string;
  readonly headers: Readonly<Record<string, string>>;
}

export const RESOLVERS: Readonly<Record<ResolverName, Resolver>> = {
  cloudflare: {
    name: 'cloudflare',
    label: 'Cloudflare',
    host: 'cloudflare-dns.com',
    endpoint: 'https://cloudflare-dns.com/dns-query',
    headers: { accept: 'application/dns-json' },
  },
  google: { name: 'google', label: 'Google', host: 'dns.google', endpoint: 'https://dns.google/resolve', headers: {} },
};

/** The order a question goes in when no server is named. */
export const DEFAULT_ORDER: readonly ResolverName[] = ['cloudflare', 'google'];

/** Each question's deadline. */
export const DOH_TIMEOUT_MS = 5000;

/** The longest an answer is kept, whatever its TTL. */
export const MAX_CACHE_SECONDS = 300;

/**
 * The resolver a server word names (`@cloudflare`, `8.8.8.8`, `dns.google`), or null when it
 * names neither: a browser can reach only resolvers that answer DNS over HTTPS with CORS.
 */
export function resolverFor(word: string): Resolver | null {
  const name = word.replace(/^@/, '').toLowerCase().replace(/\.$/, '');
  if (['cloudflare', 'cf', '1.1.1.1', '1.0.0.1', 'one.one.one.one', 'cloudflare-dns.com', '2606:4700:4700::1111', '2606:4700:4700::1001'].includes(name)) {
    return RESOLVERS.cloudflare;
  }
  if (['google', '8.8.8.8', '8.8.4.4', 'dns.google', '2001:4860:4860::8888', '2001:4860:4860::8844'].includes(name)) return RESOLVERS.google;
  return null;
}

// ── Record types ───────────────────────────────────────────────────────────────────────────

/** The types a question may ask for, with their numbers. */
export const RR_TYPES = {
  A: 1,
  NS: 2,
  CNAME: 5,
  SOA: 6,
  PTR: 12,
  MX: 15,
  TXT: 16,
  AAAA: 28,
  SRV: 33,
  DS: 43,
  DNSKEY: 48,
  HTTPS: 65,
  CAA: 257,
  ANY: 255,
} as const;

export type RrType = keyof typeof RR_TYPES;

/** What each type holds, for completion and the man pages. */
export const RR_SUMMARIES: Readonly<Record<RrType, string>> = {
  A: 'IPv4 address',
  AAAA: 'IPv6 address',
  CNAME: 'the name this one is an alias of',
  MX: 'mail servers',
  NS: 'name servers',
  TXT: 'text: SPF, verification',
  SOA: 'the zone authority',
  CAA: 'who may issue certificates',
  PTR: 'the name of an address',
  SRV: 'services',
  DS: 'DNSSEC delegation',
  DNSKEY: 'DNSSEC keys',
  HTTPS: 'HTTPS service binding',
  ANY: 'whatever the resolver will give (most now answer RFC 8482 HINFO, or not at all)',
};

/**
 * Every type IANA has given a mnemonic, by number (the registry, as of 2026). Any of them can be
 * asked over DNS over HTTPS, which takes the number; a word that names one is never a host name.
 */
const IANA_TYPES: readonly (readonly [number, string])[] = [
  [1, 'A'], [2, 'NS'], [3, 'MD'], [4, 'MF'], [5, 'CNAME'], [6, 'SOA'], [7, 'MB'], [8, 'MG'], [9, 'MR'], [10, 'NULL'],
  [11, 'WKS'], [12, 'PTR'], [13, 'HINFO'], [14, 'MINFO'], [15, 'MX'], [16, 'TXT'], [17, 'RP'], [18, 'AFSDB'], [19, 'X25'],
  [20, 'ISDN'], [21, 'RT'], [22, 'NSAP'], [23, 'NSAP-PTR'], [24, 'SIG'], [25, 'KEY'], [26, 'PX'], [27, 'GPOS'], [28, 'AAAA'],
  [29, 'LOC'], [30, 'NXT'], [31, 'EID'], [32, 'NIMLOC'], [33, 'SRV'], [34, 'ATMA'], [35, 'NAPTR'], [36, 'KX'], [37, 'CERT'],
  [38, 'A6'], [39, 'DNAME'], [40, 'SINK'], [41, 'OPT'], [42, 'APL'], [43, 'DS'], [44, 'SSHFP'], [45, 'IPSECKEY'], [46, 'RRSIG'],
  [47, 'NSEC'], [48, 'DNSKEY'], [49, 'DHCID'], [50, 'NSEC3'], [51, 'NSEC3PARAM'], [52, 'TLSA'], [53, 'SMIMEA'], [55, 'HIP'],
  [56, 'NINFO'], [57, 'RKEY'], [58, 'TALINK'], [59, 'CDS'], [60, 'CDNSKEY'], [61, 'OPENPGPKEY'], [62, 'CSYNC'], [63, 'ZONEMD'],
  [64, 'SVCB'], [65, 'HTTPS'], [66, 'DSYNC'], [99, 'SPF'], [100, 'UINFO'], [101, 'UID'], [102, 'GID'], [103, 'UNSPEC'], [104, 'NID'],
  [105, 'L32'], [106, 'L64'], [107, 'LP'], [108, 'EUI48'], [109, 'EUI64'], [128, 'NXNAME'], [249, 'TKEY'], [250, 'TSIG'],
  [251, 'IXFR'], [252, 'AXFR'], [253, 'MAILB'], [254, 'MAILA'], [255, 'ANY'], [256, 'URI'], [257, 'CAA'], [258, 'AVC'],
  [259, 'DOA'], [260, 'AMTRELAY'], [261, 'RESINFO'], [262, 'WALLET'], [263, 'CLA'], [264, 'IPN'], [32768, 'TA'], [32769, 'DLV'],
];

const TYPE_NAMES: ReadonlyMap<number, string> = new Map(IANA_TYPES);
const TYPE_NUMBERS: ReadonlyMap<string, number> = new Map(IANA_TYPES.map(([n, name]) => [name, n] as const));

/** A type's name, or `TYPEn` (RFC 3597) for one with no mnemonic. */
export function typeName(type: number): string {
  return TYPE_NAMES.get(type) ?? `TYPE${type}`;
}

/** The type a word names, case-insensitively (`mx`, `naptr`, `TYPE15`, `*` for ANY), as its number; or null. */
export function parseType(word: string): number | null {
  const upper = word.toUpperCase();
  if (upper === '*') return RR_TYPES.ANY;
  const known = TYPE_NUMBERS.get(upper);
  if (known !== undefined) return known;
  const numbered = /^TYPE(\d{1,5})$/.exec(upper);
  if (numbered === null) return null;
  const n = Number(numbered[1]);
  return n >= 1 && n <= 65535 ? n : null;
}

/** IXFR and AXFR: zone transfers, which a resolver over HTTPS cannot make. */
export function isZoneTransfer(type: number): boolean {
  return type === 251 || type === 252;
}

/** Why a zone transfer cannot be asked for here. */
export function zoneTransferReason(type: number): string {
  return `${typeName(type)} is a zone transfer, which needs a TCP connection to the zone's own name server: a browser cannot make one`;
}

const RCODES = ['NOERROR', 'FORMERR', 'SERVFAIL', 'NXDOMAIN', 'NOTIMP', 'REFUSED'] as const;

/** A response code's name: `NXDOMAIN` for 3. */
export function rcodeName(status: number): string {
  return RCODES[status] ?? `RCODE${status}`;
}

export const RCODE = { noError: 0, servFail: 2, nxDomain: 3 } as const;

// ── Answers ────────────────────────────────────────────────────────────────────────────────

export interface DnsRecord {
  /** As the resolver wrote it, without a trailing dot: `example.com`, or '' for the root. */
  readonly name: string;
  readonly type: number;
  readonly ttl: number;
  /** As the resolver wrote it, made safe to show (see `shown`). */
  readonly data: string;
}

export interface DnsAnswer {
  /** The response code: 0 NOERROR, 2 SERVFAIL, 3 NXDOMAIN. */
  readonly status: number;
  readonly flags: { readonly tc: boolean; readonly rd: boolean; readonly ra: boolean; readonly ad: boolean; readonly cd: boolean; readonly aa: boolean };
  readonly question: { readonly name: string; readonly type: number };
  readonly answer: readonly DnsRecord[];
  readonly authority: readonly DnsRecord[];
  readonly additional: readonly DnsRecord[];
  /** The resolver's notes, such as an extended error. */
  readonly comments: readonly string[];
}

/** A question asked: the answer, who gave it and how long it took. */
export interface Lookup {
  readonly answer: DnsAnswer;
  /** The resolver that answered; null for a name answered here (localhost). */
  readonly resolver: Resolver | null;
  readonly ms: number;
  /** Kept from an earlier question, with its TTLs counted down. */
  readonly cached: boolean;
  /** Resolvers asked first that could not answer, in order. */
  readonly failures: readonly ResolverFailure[];
}

export interface ResolverFailure {
  readonly resolver: Resolver;
  /** Why, in a few words: `timed out`, `HTTP 503`. */
  readonly reason: string;
  readonly kind: NetError['kind'];
}

/** No resolver could answer. */
export class DnsUnreachable extends Error {
  constructor(readonly failures: readonly ResolverFailure[]) {
    super(failures.map((failure) => `${failure.resolver.host}: ${failure.reason}`).join('; '));
    this.name = 'DnsUnreachable';
  }

  /** True when the browser was offline, so nothing was asked. */
  get offline(): boolean {
    return this.failures.length > 0 && this.failures.every((failure) => failure.kind === 'offline');
  }
}

const CONTROLS = /[\u0000-\u001f\u007f-\u009f]/g;
const INVISIBLE = /[\u2028\u2029\u202a-\u202e\u2066-\u2069\u200e\u200f]/g;

/**
 * Text from a resolver made safe to show, as dig shows it: a control character becomes `\DDD`,
 * its decimal code, so no escape sequence reaches the terminal; a bidirectional control or a
 * line separator becomes U+FFFD, so nothing can reorder the line around it. Capped at 4096.
 */
export function shown(text: string): string {
  return text
    .replace(CONTROLS, (c) => `\\${String(c.charCodeAt(0)).padStart(3, '0')}`)
    .replace(INVISIBLE, '\ufffd')
    .slice(0, 4096);
}

const bool = (value: unknown): boolean => value === true;

function records(value: unknown): DnsRecord[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item: unknown): DnsRecord[] => {
    if (typeof item !== 'object' || item === null) return [];
    const { name, type, TTL, data } = item as Record<string, unknown>;
    if (typeof name !== 'string' || typeof type !== 'number' || typeof data !== 'string') return [];
    return [{ name: bare(shown(name)), type, ttl: typeof TTL === 'number' && TTL >= 0 ? Math.floor(TTL) : 0, data: shown(data) }];
  });
}

/** A name without its trailing dot; the root is ''. */
export function bare(name: string): string {
  return name === '.' ? '' : name.replace(/\.$/, '');
}

/** A name as dig writes it, with its trailing dot: `example.com.`, or `.` for the root. */
export function fqdn(name: string): string {
  const plain = bare(name);
  return plain === '' ? '.' : `${plain}.`;
}

/**
 * Reads a DNS-over-HTTPS JSON answer (the shape Cloudflare and Google share). Throws on anything
 * else, which the net service reports as an unreadable answer.
 */
export function parseDoh(raw: unknown): DnsAnswer {
  if (typeof raw !== 'object' || raw === null) throw new TypeError('not an object');
  const body = raw as Record<string, unknown>;
  if (typeof body.Status !== 'number') throw new TypeError('no Status');
  const questions = Array.isArray(body.Question) ? (body.Question as unknown[]) : [];
  const first = (questions[0] ?? {}) as Record<string, unknown>;
  const comment = body.Comment;
  return {
    status: body.Status,
    flags: { tc: bool(body.TC), rd: bool(body.RD), ra: bool(body.RA), ad: bool(body.AD), cd: bool(body.CD), aa: false },
    question: { name: typeof first.name === 'string' ? bare(shown(first.name)) : '', type: typeof first.type === 'number' ? first.type : 0 },
    answer: records(body.Answer),
    authority: records(body.Authority),
    additional: records(body.Additional),
    comments: (Array.isArray(comment) ? comment : comment === undefined ? [] : [comment]).filter((c): c is string => typeof c === 'string').map(shown),
  };
}

// ── Names and addresses ────────────────────────────────────────────────────────────────────

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

/** The 8 groups of an IPv6 address, or null when it is not one. */
function ipv6Groups(text: string): number[] | null {
  if (!/^[0-9a-f:.]+$/i.test(text) || !text.includes(':')) return null;
  let address = text;
  const tail: number[] = [];
  // An IPv4 address may end it: ::ffff:192.0.2.1.
  const lastColon = address.lastIndexOf(':');
  const last = address.slice(lastColon + 1);
  if (last.includes('.')) {
    if (!IPV4.test(last)) return null;
    const [a = 0, b = 0, c = 0, d = 0] = last.split('.').map(Number);
    tail.push((a << 8) | b, (c << 8) | d);
    address = address.slice(0, lastColon + 1);
    if (!address.endsWith('::')) address = address.slice(0, -1);
  }
  const halves = address.split('::');
  if (halves.length > 2) return null;
  const parse = (part: string): number[] | null => {
    if (part === '') return [];
    const groups = part.split(':');
    if (groups.some((group) => !/^[0-9a-f]{1,4}$/i.test(group))) return null;
    return groups.map((group) => parseInt(group, 16));
  };
  const head = parse(halves[0] ?? '');
  const rest = halves.length === 2 ? parse(halves[1] ?? '') : [];
  if (head === null || rest === null) return null;
  const known = head.length + rest.length + tail.length;
  if (halves.length === 1) return known === 8 ? [...head, ...tail] : null;
  if (known > 7) return null;
  return [...head, ...new Array<number>(8 - known).fill(0), ...rest, ...tail];
}

/** Whether `text` is an IPv4 or IPv6 address. */
export function ipVersion(text: string): 4 | 6 | null {
  if (IPV4.test(text)) return 4;
  return ipv6Groups(text) === null ? null : 6;
}

/** The name a reverse lookup asks for: `4.3.2.1.in-addr.arpa`, or the nibbles under `ip6.arpa`. */
export function reverseName(address: string): string | null {
  if (IPV4.test(address)) return `${address.split('.').reverse().join('.')}.in-addr.arpa`;
  const groups = ipv6Groups(address);
  if (groups === null) return null;
  const nibbles = groups.map((group) => group.toString(16).padStart(4, '0')).join('');
  return `${nibbles.split('').reverse().join('.')}.ip6.arpa`;
}

/**
 * What kind of address a page on the internet may not reach `address` is, or null for one it
 * may: this device (loopback, and the unspecified 0.0.0.0/8 and ::), a private network (10/8,
 * 172.16/12, 192.168/16, CGNAT's 100.64/10, link-local 169.254/16, fc00::/7, fe80::/10 and the
 * old site-local fec0::/10), multicast (224/4, ff00::/8) or reserved (240/4, broadcast among
 * them). An IPv6 address with an IPv4 address inside it (::ffff:a.b.c.d mapped, ::ffff:0:a.b.c.d
 * translated, ::a.b.c.d compatible, 64:ff9b::/96 NAT64, 2002::/16 6to4) is judged by that one.
 */
export function addressScope(address: string): 'this device' | 'private' | 'multicast' | 'reserved' | null {
  let bytes: number[];
  if (IPV4.test(address)) bytes = address.split('.').map(Number);
  else {
    const groups = ipv6Groups(address);
    if (groups === null) return null;
    const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = groups;
    const zeros = (n: number): boolean => groups.slice(0, n).every((group) => group === 0);
    const quad = (hi: number, lo: number): number[] => [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff];
    if (zeros(7) && g7 <= 1) return 'this device';
    const mapped = zeros(5) && g5 === 0xffff;
    const translated = zeros(4) && g4 === 0xffff && g5 === 0;
    const nat64 = g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0;
    if (mapped || translated || nat64 || zeros(6)) {
      bytes = quad(g6, g7);
    } else if (g0 === 0x2002) {
      bytes = quad(g1, g2);
    } else {
      if ((g0 & 0xff00) === 0xff00) return 'multicast';
      return (g0 & 0xfe00) === 0xfc00 || (g0 & 0xffc0) === 0xfe80 || (g0 & 0xffc0) === 0xfec0 ? 'private' : null;
    }
  }
  const [a = 0, b = 0] = bytes;
  if (a === 0 || a === 127) return 'this device';
  if (a >= 224) return a < 240 ? 'multicast' : 'reserved';
  return a === 10 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ? 'private' : null;
}

/** True for the addresses a page on the internet may not reach (addressScope says which). */
export function isPrivateAddress(address: string): boolean {
  return addressScope(address) !== null;
}

/** A host name as typed, as the DNS asks for it (lower case, punycode), or null when it cannot be one. */
export function hostName(word: string): string | null {
  const trimmed = word.trim().replace(/\.$/, '');
  if (trimmed === '' || trimmed.length > 253 || /[\s/?#@:\\%]/.test(trimmed)) return null;
  let host: string;
  try {
    host = new URL(`https://${trimmed}/`).hostname;
  } catch {
    return null;
  }
  const labels = host.split('.');
  return labels.every((label) => /^[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?$/.test(label)) ? host : null;
}

/** True for `localhost` and the names under it, which RFC 6761 keeps for this device. */
export function isLocalhost(name: string): boolean {
  const plain = bare(name).toLowerCase();
  return plain === 'localhost' || plain.endsWith('.localhost');
}

/** The answer for a name under localhost, made here. */
function localAnswer(name: string, type: number): DnsAnswer {
  const owner = bare(name).toLowerCase();
  const data = type === RR_TYPES.A ? '127.0.0.1' : type === RR_TYPES.AAAA ? '::1' : null;
  return {
    status: RCODE.noError,
    flags: { tc: false, rd: true, ra: true, ad: false, cd: false, aa: true },
    question: { name: owner, type },
    answer: data === null ? [] : [{ name: owner, type, ttl: 0, data }],
    authority: [],
    additional: [],
    comments: [],
  };
}

// ── Asking ─────────────────────────────────────────────────────────────────────────────────

export interface DnsDeps {
  readonly net: Pick<Net, 'json' | 'isError'>;
  readonly clock: Pick<Clock, 'now'>;
  readonly signal?: AbortSignal;
}

export interface AskOptions {
  /** Only this resolver; otherwise Cloudflare, then Google if Cloudflare fails. */
  readonly server?: Resolver | null;
  readonly timeoutMs?: number;
}

interface Kept {
  readonly at: number;
  readonly until: number;
  readonly lookup: Lookup;
}

/** Answers kept per net service, so each page (and each test's shell) has its own. */
const caches = new WeakMap<object, Map<string, Kept>>();

function cacheFor(net: object): Map<string, Kept> {
  let cache = caches.get(net);
  if (cache === undefined) {
    cache = new Map();
    caches.set(net, cache);
  }
  return cache;
}

/** How long an answer may be kept: its lowest TTL, the SOA minimum for a negative one; never SERVFAIL. */
function keepSeconds(answer: DnsAnswer): number {
  if (answer.status !== RCODE.noError && answer.status !== RCODE.nxDomain) return 0;
  const ttls = (answer.answer.length > 0 ? answer.answer : answer.authority).map((record) => record.ttl);
  return Math.min(MAX_CACHE_SECONDS, ...(ttls.length > 0 ? ttls : [0]));
}

/** The answer as it stands `elapsed` seconds after it was kept: every TTL counted down. */
function aged(answer: DnsAnswer, elapsed: number): DnsAnswer {
  const age = (list: readonly DnsRecord[]): DnsRecord[] => list.map((record) => ({ ...record, ttl: Math.max(0, record.ttl - elapsed) }));
  return { ...answer, answer: age(answer.answer), authority: age(answer.authority), additional: age(answer.additional) };
}

/** Why a request failed, in the few words dig puts after `communications error to …:`. */
export function failureReason(error: NetError): string {
  switch (error.kind) {
    case 'timeout':
      return 'timed out';
    case 'offline':
      return 'the browser is offline';
    case 'http':
      return `HTTP ${error.status ?? 'error'}`;
    case 'parse':
      return 'an answer that could not be read';
    case 'cors':
    case 'network':
      return 'unreachable';
    case 'abort':
      return 'cancelled';
  }
}

/** The URL that asks `resolver` about `name`. */
export function questionUrl(resolver: Resolver, name: string, type: number): string {
  const query = `name=${encodeURIComponent(bare(name) === '' ? '.' : bare(name))}&type=${type}`;
  return `${resolver.endpoint}?${query}`;
}

/**
 * Asks about `name`: Cloudflare first, then Google, or only the resolver named. Rejects with
 * DnsUnreachable when none answered, and with the net service's abort when the signal fires.
 * A SERVFAIL is an answer: as dig does, it is not asked again elsewhere.
 */
export async function ask(deps: DnsDeps, name: string, type: number, options: AskOptions = {}): Promise<Lookup> {
  if (isLocalhost(name)) return { answer: localAnswer(name, type), resolver: null, ms: 0, cached: false, failures: [] };
  const order = options.server ? [options.server] : DEFAULT_ORDER.map((key) => RESOLVERS[key]);
  const cache = cacheFor(deps.net);
  const keyOf = (resolver: Resolver): string => `${resolver.name} ${bare(name).toLowerCase()} ${type}`;
  // An answer kept from any of them first, so a resolver that is down is not waited on again.
  const now = deps.clock.now();
  for (const resolver of order) {
    const kept = cache.get(keyOf(resolver));
    if (kept === undefined || now >= kept.until) continue;
    const elapsed = Math.floor((now - kept.at) / 1000);
    return { ...kept.lookup, answer: aged(kept.lookup.answer, elapsed), ms: 0, cached: true };
  }
  const failures: ResolverFailure[] = [];
  for (const resolver of order) {
    const key = keyOf(resolver);
    const started = deps.clock.now();
    try {
      const answer = await deps.net.json(questionUrl(resolver, name, type), {
        headers: resolver.headers,
        timeoutMs: options.timeoutMs ?? DOH_TIMEOUT_MS,
        parse: parseDoh,
        ...(deps.signal === undefined ? {} : { signal: deps.signal }),
      });
      const lookup: Lookup = { answer, resolver, ms: Math.max(0, deps.clock.now() - started), cached: false, failures };
      const seconds = keepSeconds(answer);
      if (seconds > 0) cache.set(key, { at: started, until: started + seconds * 1000, lookup: { ...lookup, failures: [] } });
      return lookup;
    } catch (error) {
      if (!deps.net.isError(error) || error.kind === 'abort' || deps.signal?.aborted === true) throw error;
      failures.push({ resolver, reason: failureReason(error), kind: error.kind });
      // Offline, the next resolver cannot be reached either.
      if (error.kind === 'offline') break;
    }
  }
  throw new DnsUnreachable(failures);
}

/** The line that says where an answer came from: which resolver over HTTPS, or answered here. */
export function viaLine(lookup: Lookup): string {
  const { resolver } = lookup;
  if (resolver === null) return ';; answered here: localhost is this device (RFC 6761), so nothing was asked';
  const after = lookup.failures.length > 0 ? `, after ${lookup.failures.map((failure) => failure.resolver.label).join(' and ')} failed` : '';
  const kept = lookup.cached ? ', kept from an earlier answer' : '';
  return `;; via DNS over HTTPS (${resolver.label}${after})${kept}`;
}

/** dig's words for a resolver that could not answer. */
export function communicationsError(failure: ResolverFailure): string {
  return `;; communications error to ${failure.resolver.host}#443(${failure.resolver.host}): ${failure.reason}`;
}

/** What dig, host and nslookup say when no resolver answered. */
export function unreachableLines(error: DnsUnreachable): string[] {
  if (error.offline) return [';; the browser is offline; no servers could be reached'];
  return [...error.failures.map(communicationsError), ';; no servers could be reached'];
}

/** The addresses an answer gives for its question, following CNAMEs: the records of `type`. */
export function addressesIn(answer: DnsAnswer, type: number): string[] {
  return answer.answer.filter((record) => record.type === type).map((record) => record.data);
}

// ── Showing records ────────────────────────────────────────────────────────────────────────

/** A TXT string as dig shows it, in quotes: Google gives it bare, Cloudflare quoted. */
export function txtData(data: string): string {
  return data.startsWith('"') ? data : `"${data.replace(/(["\\])/g, '\\$1')}"`;
}

/** A CAA record as `0 issue "ca.example"`, decoding the generic `\# N hex` form (RFC 3597) where a resolver gives it. */
export function caaData(data: string): string {
  const generic = /^\\#\s+(\d+)\s+([0-9a-f\s]*)$/i.exec(data);
  if (generic === null) return data;
  const bytes = (generic[2] ?? '').replace(/\s+/g, '').match(/../g)?.map((pair) => parseInt(pair, 16)) ?? [];
  const [flags = 0, length = 0] = bytes;
  const tag = String.fromCharCode(...bytes.slice(2, 2 + length));
  const value = String.fromCharCode(...bytes.slice(2 + length));
  return shown(`${flags} ${tag} "${value}"`);
}

/** A record's data as dig, host and nslookup show it. */
export function recordData(record: DnsRecord): string {
  if (record.type === RR_TYPES.TXT) return txtData(record.data);
  if (record.type === RR_TYPES.CAA) return caaData(record.data);
  return record.data;
}

/** An SOA record's seven fields, or null when it does not have them. */
export function soaFields(data: string): { origin: string; mail: string; serial: string; refresh: string; retry: string; expire: string; minimum: string } | null {
  const [origin, mail, serial, refresh, retry, expire, minimum] = data.split(/\s+/);
  if (minimum === undefined || origin === undefined || mail === undefined || serial === undefined || refresh === undefined || retry === undefined || expire === undefined) return null;
  return { origin, mail, serial, refresh, retry, expire, minimum };
}
