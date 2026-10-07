// The body of dig; its spec, in dig.ts, loads this the first time dig runs.
//
// dig's sections, laid out as dig lays them out, for an answer that came over DNS over HTTPS
// (commands/lib/dns.ts). What the JSON form does not carry is left out rather than made up: the
// message id (0, as DNS over HTTPS asks), the EDNS pseudosection and the message size.

import { out } from '../../../output/model';
import type { CommandContext, CommandDoc, ExitCode } from '../../../shell/types';
import {
  DnsUnreachable,
  ask,
  communicationsError,
  unreachableLines,
  fqdn,
  parseType,
  rcodeName,
  recordData,
  resolverFor,
  reverseName,
  typeName,
  viaLine,
  RR_TYPES,
  type DnsRecord,
  type Lookup,
  type Resolver,
} from '../../lib/dns';
import { stamp } from '../../lib/net-words';

/** What --help, help and man say about dig, besides its spec (dig.ts). */
export const doc: CommandDoc = {
  description:
    "Asks the DNS about NAME and prints the answer in dig's sections. A browser cannot send DNS packets, so the question goes over HTTPS, as JSON, to Cloudflare's resolver (cloudflare-dns.com), or to Google's (dns.google) when Cloudflare cannot be reached; the output names which one answered. With no NAME, dig asks for the root's name servers. TYPE is A unless given: A, AAAA, CNAME, MX, NS, TXT, SOA, CAA, PTR, SRV, DS, DNSKEY or HTTPS. Query options: +short (only the answers), +noall (nothing), then +answer, +question, +authority, +additional, +comments, +stats or +cmd to bring a part back; +noX leaves part X out.",
  man: [
    {
      heading: 'SERVERS',
      body: '@cloudflare (or @1.1.1.1) and @google (or @8.8.8.8) ask only that resolver. No other server can be reached from a browser: a resolver has to answer DNS over HTTPS and allow pages to read its answers.',
    },
    {
      heading: 'WHAT IS DIFFERENT',
      body: "The header's id is always 0, as DNS over HTTPS asks. There is no EDNS pseudosection and no message size, because the JSON answer does not carry them. Answers are kept for their TTL, so asking again soon shows a query time of 0 and the TTLs counted down. localhost and the names under it are answered here (RFC 6761), and nothing is asked.",
    },
    {
      heading: 'EXIT STATUS',
      body: '0 when a resolver answered, NXDOMAIN and SERVFAIL included. 1 for bad usage. 9 when no resolver could be reached.',
    },
  ],
};

const SECTIONS = ['cmd', 'comments', 'question', 'answer', 'authority', 'additional', 'stats'] as const;
type Section = (typeof SECTIONS)[number];

/** Query options dig takes and vesen has nothing to change for: always over HTTPS. */
const ACCEPTED = ['https', 'recurse', 'search', 'tcp'] as const;

interface Plan {
  readonly names: string[];
  type: number;
  /** A type was given, with -t, -x or a word such as MX. */
  typed: boolean;
  server: Resolver | null;
  short: boolean;
  readonly show: Record<Section, boolean>;
}

/** The query options, by name; a unique prefix of two letters or more names one too. */
const OPTION_NAMES = ['short', 'all', ...SECTIONS, ...ACCEPTED] as const;

function queryOption(plan: Plan, word: string): string | null {
  const negated = word.startsWith('+no');
  const raw = word.slice(negated ? 3 : 1).split('=')[0] ?? '';
  const matches = OPTION_NAMES.filter((name) => name === raw || (raw.length >= 2 && name.startsWith(raw)));
  const name = matches.includes(raw as (typeof OPTION_NAMES)[number]) ? raw : matches.length === 1 ? matches[0] : undefined;
  if (name === undefined) return `invalid query option: ${word}`;
  const on = !negated;
  if (name === 'short') plan.short = on;
  else if (name === 'all') for (const section of SECTIONS) plan.show[section] = on;
  else if ((SECTIONS as readonly string[]).includes(name)) plan.show[name as Section] = on;
  return null;
}

/** A name dig would send: not empty past its dot, no spaces, no label over 63, 253 at most. */
function legalName(word: string): boolean {
  const plain = word.replace(/\.$/, '');
  if (plain === '') return word === '.';
  return plain.length <= 253 && !/[\s\u0000-\u001f]/.test(plain) && plain.split('.').every((label) => label.length > 0 && label.length <= 63);
}

function readPlan(ctx: CommandContext): Plan | string {
  const plan: Plan = {
    names: [],
    type: RR_TYPES.A,
    typed: false,
    server: null,
    short: false,
    show: { cmd: true, comments: true, question: true, answer: true, authority: true, additional: true, stats: true },
  };
  const t = ctx.opts.t;
  if (typeof t === 'string') {
    const type = parseType(t);
    if (type === null) return `invalid type: ${t}`;
    plan.type = RR_TYPES[type];
    plan.typed = true;
  }
  const x = ctx.opts.x;
  if (typeof x === 'string') {
    const name = reverseName(x);
    if (name === null) return `'${x}' is not an IP address`;
    plan.names.push(name);
    if (!plan.typed) plan.type = RR_TYPES.PTR;
    plan.typed = true;
  }
  const q = ctx.opts.q;
  if (typeof q === 'string') plan.names.push(q);
  for (const word of ctx.args) {
    if (word.startsWith('@')) {
      const server = resolverFor(word);
      if (server === null) return `${word.slice(1)}: a browser can ask only @cloudflare or @google, over HTTPS`;
      plan.server = server;
    } else if (word.startsWith('+')) {
      const problem = queryOption(plan, word);
      if (problem !== null) return problem;
    } else if (word.toUpperCase() === 'IN') {
      // The only class there is.
    } else if (parseType(word) !== null && !(plan.typed && plan.names.length === 0)) {
      plan.type = RR_TYPES[parseType(word) ?? 'A'];
      plan.typed = true;
    } else {
      plan.names.push(word);
    }
  }
  for (const name of plan.names) if (!legalName(name)) return `'${name}' is not a legal name`;
  return plan;
}

/** Tabs after `text` up to `column`, at least one, as dig aligns its records. */
function tabbed(text: string, column: number): string {
  return text + '\t'.repeat(Math.max(1, Math.ceil((column - text.length) / 8)));
}

function recordLine(record: DnsRecord): string {
  return `${tabbed(fqdn(record.name), 24)}${record.ttl}\tIN\t${typeName(record.type)}\t${recordData(record)}`;
}

function flagsOf(lookup: Lookup): string {
  const { flags } = lookup.answer;
  const set = [['qr', true], ['aa', flags.aa], ['tc', flags.tc], ['rd', flags.rd], ['ra', flags.ra], ['ad', flags.ad], ['cd', flags.cd]] as const;
  return set.filter(([, on]) => on).map(([name]) => name).join(' ');
}

/** dig's SERVER line; none for a name answered here. */
function serverLine(lookup: Lookup): string[] {
  const { resolver } = lookup;
  return resolver === null ? [] : [`;; SERVER: ${resolver.host}#443(${resolver.host}) (HTTPS)`];
}

function fullOutput(ctx: CommandContext, plan: Plan, name: string, lookup: Lookup): string[] {
  const { answer } = lookup;
  const lines: string[] = [];
  const { show } = plan;
  if (show.cmd) lines.push('', `; <<>> dig <<>> ${ctx.argv.slice(1).join(' ')}`.trimEnd(), ';; global options: +cmd');
  if (show.comments) {
    lines.push(
      ';; Got answer:',
      `;; ->>HEADER<<- opcode: QUERY, status: ${rcodeName(answer.status)}, id: 0`,
      `;; flags: ${flagsOf(lookup)}; QUERY: 1, ANSWER: ${answer.answer.length}, AUTHORITY: ${answer.authority.length}, ADDITIONAL: ${answer.additional.length}`,
    );
    for (const comment of answer.comments) lines.push(`; ${comment}`);
    lines.push('');
  }
  if (show.question) {
    if (show.comments) lines.push(';; QUESTION SECTION:');
    lines.push(`${tabbed(`;${fqdn(name)}`, 32)}IN\t${typeName(plan.type)}`);
    if (show.comments) lines.push('');
  }
  const section = (title: string, records: readonly DnsRecord[], shown: boolean): void => {
    if (!shown || records.length === 0) return;
    if (show.comments) lines.push(`;; ${title} SECTION:`);
    lines.push(...records.map(recordLine));
    if (show.comments) lines.push('');
  };
  section('ANSWER', answer.answer, show.answer);
  section('AUTHORITY', answer.authority, show.authority);
  section('ADDITIONAL', answer.additional, show.additional);
  if (show.stats) {
    lines.push(`;; Query time: ${lookup.ms} msec`, ...serverLine(lookup), `;; WHEN: ${stamp(ctx, '%a %b %d %H:%M:%S %Z %Y')}`, viaLine(lookup), '');
  }
  return lines;
}

/** Writes lines, the comments dim on a terminal. */
async function say(ctx: CommandContext, lines: readonly string[]): Promise<void> {
  if (lines.length === 0) return;
  await ctx.stdout.write(`${lines.map((line) => (line.startsWith(';') ? ctx.fmt.dim(line) : line)).join('\n')}\n`);
}

export async function run(ctx: CommandContext): Promise<ExitCode> {
  const plan = readPlan(ctx);
  if (typeof plan === 'string') return ctx.usage(plan);
  // With no name, dig asks for the root's name servers.
  const names = plan.names.length > 0 ? plan.names : ['.'];
  if (plan.names.length === 0 && !plan.typed) plan.type = RR_TYPES.NS;

  let status: ExitCode = 0;
  for (const name of names) {
    let lookup: Lookup;
    try {
      lookup = await ask({ net: ctx.net, clock: ctx.clock, signal: ctx.signal }, name, plan.type, { server: plan.server });
    } catch (error) {
      if (!(error instanceof DnsUnreachable)) throw error;
      for (const line of unreachableLines(error)) await ctx.stderr.line(out.span(line, { fg: 'error' }));
      status = 9;
      continue;
    }
    for (const failure of lookup.failures) await ctx.stderr.line(out.span(communicationsError(failure), { fg: 'muted' }));
    if (plan.short) await say(ctx, lookup.answer.answer.map(recordData));
    else await say(ctx, fullOutput(ctx, plan, name, lookup));
  }
  return status;
}
