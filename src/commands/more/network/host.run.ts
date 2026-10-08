// The body of host; its spec, in host.ts, loads this the first time host runs.

import { out } from '../../../output/model';
import type { CommandContext, CommandDoc, ExitCode } from '../../../shell/types';
import {
  DnsUnreachable,
  RCODE,
  RR_TYPES,
  ask,
  bare,
  communicationsError,
  ipVersion,
  isZoneTransfer,
  parseType,
  zoneTransferReason,
  rcodeName,
  recordData,
  resolverFor,
  reverseName,
  typeName,
  unreachableLines,
  viaLine,
  type DnsRecord,
  type Lookup,
} from '../../lib/dns';

/** What --help, help and man say about host, besides its spec (host.ts). */
export const doc: CommandDoc = {
  description:
    "Looks NAME up and says what it finds, one sentence a record: its IPv4 and IPv6 addresses and mail servers, or only the TYPE asked for with -t. An address is looked up in reverse, for its name. A browser cannot send DNS packets, so the questions go over HTTPS to Cloudflare's resolver, or Google's when Cloudflare cannot be reached; SERVER (cloudflare or google) asks only that one.",
  man: [{ heading: 'EXIT STATUS', body: '0 when the name was found. 1 when it was not (NXDOMAIN), the resolver failed (SERVFAIL), or no resolver could be reached.' }],
};

/** host's sentence for a record. */
function sentence(record: DnsRecord): string {
  const owner = bare(record.name) || '.';
  const data = recordData(record);
  switch (record.type) {
    case RR_TYPES.A:
      return `${owner} has address ${data}`;
    case RR_TYPES.AAAA:
      return `${owner} has IPv6 address ${data}`;
    case RR_TYPES.MX:
      return `${owner} mail is handled by ${data}`;
    case RR_TYPES.CNAME:
      return `${owner} is an alias for ${data}`;
    case RR_TYPES.NS:
      return `${owner} name server ${data}`;
    case RR_TYPES.TXT:
      return `${owner} descriptive text ${data}`;
    case RR_TYPES.PTR:
      return `${owner} domain name pointer ${data}`;
    case RR_TYPES.SOA:
      return `${owner} has SOA record ${data}`;
    default:
      return `${owner} has ${typeName(record.type)} record ${data}`;
  }
}

export async function run(ctx: CommandContext): Promise<ExitCode> {
  const [word, serverWord, extra] = ctx.args;
  if (word === undefined) return ctx.usage('missing NAME');
  if (extra !== undefined) return ctx.usage(`extra operand '${extra}'`);
  const server = serverWord === undefined ? null : resolverFor(serverWord);
  if (serverWord !== undefined && server === null) {
    return ctx.fail(`couldn't get address for '${serverWord}': a browser can ask only cloudflare or google, over HTTPS`);
  }
  let asked: number | null = null;
  if (typeof ctx.opts.t === 'string') {
    const type = parseType(ctx.opts.t);
    if (type === null) return ctx.fail(`invalid type: ${ctx.opts.t}`);
    if (isZoneTransfer(type)) return ctx.fail(zoneTransferReason(type));
    asked = type;
  }
  const reverse = ipVersion(word) === null ? null : reverseName(word);
  const name = reverse ?? word.replace(/\.$/, '');
  const types = asked !== null ? [asked] : reverse !== null ? [RR_TYPES.PTR] : [RR_TYPES.A, RR_TYPES.AAAA, RR_TYPES.MX];

  if (server !== null) {
    await ctx.stdout.write(`Using domain server:\nName: ${server.host}\nAddress: ${server.endpoint} (DNS over HTTPS)\nAliases: \n\n`);
  }
  const said = new Set<string>();
  let last: Lookup | null = null;
  for (const type of types) {
    let lookup: Lookup;
    try {
      lookup = await ask({ net: ctx.net, clock: ctx.clock, signal: ctx.signal }, name, type, { server });
    } catch (error) {
      if (!(error instanceof DnsUnreachable)) throw error;
      for (const line of unreachableLines(error)) await ctx.stderr.line(out.span(line, { fg: 'error' }));
      return 1;
    }
    for (const failure of lookup.failures) await ctx.stderr.line(out.span(communicationsError(failure), { fg: 'muted' }));
    last = lookup;
    const { answer } = lookup;
    if (answer.status !== RCODE.noError) {
      await ctx.stderr.line(out.span(`Host ${name} not found: ${answer.status}(${rcodeName(answer.status)})`, { fg: 'error' }));
      return 1;
    }
    // Aliases are said once, however many questions meet them.
    const lines = answer.answer
      .filter((record) => record.type === type || record.type === RR_TYPES.CNAME)
      .map(sentence)
      .filter((line) => !said.has(line));
    for (const line of lines) said.add(line);
    if (lines.length > 0) await ctx.stdout.write(`${lines.join('\n')}\n`);
    else if (asked !== null) await ctx.stdout.write(`${name} has no ${typeName(type)} record\n`);
  }
  // Where the answers came from, for the visitor; a pipe gets only host's own lines.
  if (last !== null && ctx.stdout.isTTY) await ctx.stderr.line(out.span(viaLine(last), { fg: 'muted' }));
  return 0;
}
