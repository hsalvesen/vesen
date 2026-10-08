// The body of nslookup; its spec, in nslookup.ts, loads this the first time nslookup runs.

import { out } from '../../../output/model';
import type { CommandContext, CommandDoc, ExitCode } from '../../../shell/types';
import {
  DnsUnreachable,
  RCODE,
  RESOLVERS,
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
  soaFields,
  unreachableLines,
  type DnsRecord,
  type Lookup,
  type Resolver,
} from '../../lib/dns';

/** What --help, help and man say about nslookup, besides its spec (nslookup.ts). */
export const doc: CommandDoc = {
  description:
    "Looks NAME up and prints the answer in nslookup's layout: its IPv4 and IPv6 addresses, or the records of -type=TYPE (-query=TYPE and -q=TYPE work too). An address is looked up in reverse. A browser cannot send DNS packets, so the questions go over HTTPS to Cloudflare's resolver, or Google's when Cloudflare cannot be reached, and the Server lines say which. SERVER (cloudflare or google) asks only that one. nslookup's interactive mode is not here: give the name on the line.",
  man: [{ heading: 'EXIT STATUS', body: "0 when the server answered, even with no records of the type asked. 1 when it could not find the name (NXDOMAIN), failed (SERVFAIL), or could not be reached." }],
};

const TYPE_OPTION = /^--?(?:type|query|querytype|q|t)=(.*)$/i;

interface Plan {
  readonly name: string;
  readonly types: readonly number[];
  readonly explicit: boolean;
  readonly server: Resolver | null;
}

function readPlan(words: readonly string[]): Plan | { problem: string; status: ExitCode } {
  let type: number | null = null;
  const operands: string[] = [];
  for (const word of words) {
    const option = TYPE_OPTION.exec(word);
    if (option !== null) {
      const found = parseType(option[1] ?? '');
      if (found === null) return { problem: `unknown query type: ${option[1] ?? ''}`, status: 1 };
      if (isZoneTransfer(found)) return { problem: zoneTransferReason(found), status: 1 };
      type = found;
    } else if (word.startsWith('-') && word !== '-') {
      // -debug, -port=53 and the rest change nothing that a question over HTTPS has.
      if (!/^-(?:no)?(?:debug|d2|recurse|search|vc|fail|port=\d+|timeout=\d+|retry=\d+)$/i.test(word)) return { problem: `invalid option: ${word}`, status: 1 };
    } else {
      operands.push(word);
    }
  }
  const [name, serverWord, extra] = operands;
  if (name === undefined || name === '-') return { problem: "interactive mode is not supported here; give the name on the line: nslookup vesen.app", status: 1 };
  if (extra !== undefined) return { problem: `extra operand '${extra}'`, status: 1 };
  const server = serverWord === undefined ? null : resolverFor(serverWord);
  if (serverWord !== undefined && server === null) return { problem: `couldn't get address for '${serverWord}': a browser can ask only cloudflare or google, over HTTPS`, status: 1 };
  const reverse = ipVersion(name) === null ? null : reverseName(name);
  const explicit = type !== null;
  const types = type !== null ? [type] : reverse !== null ? [RR_TYPES.PTR] : [RR_TYPES.A, RR_TYPES.AAAA];
  return { name: reverse ?? name.replace(/\.$/, ''), types, explicit, server };
}

/** nslookup's lines for a record. */
function recordLines(record: DnsRecord): string[] {
  const owner = bare(record.name) || '.';
  const data = recordData(record);
  switch (record.type) {
    case RR_TYPES.A:
    case RR_TYPES.AAAA:
      return [`Name:\t${owner}`, `Address: ${data}`];
    case RR_TYPES.CNAME:
      return [`${owner}\tcanonical name = ${data}`];
    case RR_TYPES.MX:
      return [`${owner}\tmail exchanger = ${data}`];
    case RR_TYPES.NS:
      return [`${owner}\tnameserver = ${data}`];
    case RR_TYPES.TXT:
      return [`${owner}\ttext = ${data}`];
    case RR_TYPES.PTR:
      return [`${owner}\tname = ${data}`];
    case RR_TYPES.SOA: {
      const soa = soaFields(data);
      if (soa === null) return [`${owner}\trdata_6 = ${data}`];
      return [
        owner,
        `\torigin = ${soa.origin}`,
        `\tmail addr = ${soa.mail}`,
        `\tserial = ${soa.serial}`,
        `\trefresh = ${soa.refresh}`,
        `\tretry = ${soa.retry}`,
        `\texpire = ${soa.expire}`,
        `\tminimum = ${soa.minimum}`,
      ];
    }
    default:
      return [`${owner}\trdata_${record.type} = ${data}`];
  }
}

export async function run(ctx: CommandContext): Promise<ExitCode> {
  const plan = readPlan(ctx.args);
  if ('problem' in plan) return ctx.fail(plan.problem, plan.status);

  const lookups: Lookup[] = [];
  for (const type of plan.types) {
    try {
      const lookup = await ask({ net: ctx.net, clock: ctx.clock, signal: ctx.signal }, plan.name, type, { server: plan.server });
      lookups.push(lookup);
      // A name that does not exist has no other records to ask about.
      if (lookup.answer.status !== RCODE.noError) break;
    } catch (error) {
      if (!(error instanceof DnsUnreachable)) throw error;
      for (const line of unreachableLines(error)) await ctx.stderr.line(out.span(line, { fg: 'error' }));
      return 1;
    }
  }
  const first = lookups[0];
  if (first === undefined) return 1;
  for (const failure of first.failures) await ctx.stderr.line(out.span(communicationsError(failure), { fg: 'muted' }));

  const resolver = first.resolver ?? plan.server;
  const header =
    first.resolver === null
      ? ['Server:\t\tlocalhost', 'Address:\tnone: localhost is this device (RFC 6761), so nothing was asked', '']
      : [`Server:\t\t${(resolver ?? RESOLVERS.cloudflare).host}`, `Address:\t${(resolver ?? RESOLVERS.cloudflare).endpoint} (DNS over HTTPS)`, ''];
  await ctx.stdout.write(`${header.join('\n')}\n`);

  const failed = lookups.find((lookup) => lookup.answer.status !== RCODE.noError);
  if (failed !== undefined) {
    await ctx.stdout.write(`** server can't find ${plan.name}: ${rcodeName(failed.answer.status)}\n\n`);
    return 1;
  }
  const lines = lookups.flatMap((lookup, i) =>
    lookup.answer.answer
      // A CNAME is said once, before the addresses it leads to.
      .filter((record) => record.type === plan.types[i] || (record.type === RR_TYPES.CNAME && i === 0) || plan.types[i] === RR_TYPES.CNAME)
      .flatMap(recordLines),
  );
  if (lines.length === 0) {
    await ctx.stdout.write(`*** Can't find ${plan.name}: No answer\n\n`);
    return 0;
  }
  const authoritative = first.answer.flags.aa;
  await ctx.stdout.write(`${authoritative ? '' : 'Non-authoritative answer:\n'}${lines.join('\n')}\n\n`);
  return 0;
}
