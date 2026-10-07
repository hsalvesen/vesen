// The body of whois; its spec, in whois.ts, loads this the first time whois runs.
//
// One RDAP request: https://rdap.org/domain/NAME, which redirects to the domain's registry; the
// browser follows, and the answer's URL says which registry it came from. A 404 from rdap.org
// itself means it knows no RDAP service for the TLD; a 404 from the registry, that the domain is
// not registered. What it says goes through upstreamText, so no field can carry an escape
// sequence or reorder the line.

import { upstreamText } from '../../../lib/upstream-text';
import { out } from '../../../output/model';
import type { NetResponse } from '../../../services/types';
import type { CommandContext, CommandDoc, ExitCode } from '../../../shell/types';
import { hostName, ipVersion } from '../../lib/dns';
import { netReason } from '../../lib/net-words';

/** What --help, help and man say about whois, besides its spec (whois.ts). */
export const doc: CommandDoc = {
  description:
    "Looks DOMAIN up in its registry and prints who it is registered through, when it was registered, last changed and expires, its status codes, its name servers and whether it is signed (DNSSEC). A browser cannot reach whois's own port 43, so whois asks RDAP, the web service registries run for the same records, through rdap.org, which passes the question on to the right registry. Personal details are not shown: registries mostly withhold them anyway.",
  man: [
    {
      heading: 'EXIT STATUS',
      body: '0 when the registry answered. 1 when the domain is not registered, no RDAP service covers its TLD (whois: no RDAP service for .tld), or the registry could not be reached.',
    },
  ],
};

export const RDAP = 'https://rdap.org/domain/';

export interface Registration {
  readonly name: string;
  readonly handle: string | null;
  readonly registrar: string | null;
  readonly ianaId: string | null;
  readonly created: string | null;
  readonly updated: string | null;
  readonly expires: string | null;
  readonly statuses: readonly string[];
  readonly nameservers: readonly string[];
  readonly dnssec: string | null;
}

const record = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string | null => upstreamText(value, 200);

/** An RDAP status as whois writes it, in EPP's form: `client delete prohibited` is `clientDeleteProhibited`. */
export function eppStatus(status: string): string {
  return status
    .trim()
    .split(/\s+/)
    .map((word, i) => (i === 0 ? word.toLowerCase() : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()))
    .join('');
}

/** The registrar's name: the `fn` of the entity whose roles include registrar. */
function registrarOf(entities: unknown[]): { name: string | null; ianaId: string | null } {
  const registrar = entities.map(record).find((entity) => list(entity.roles).includes('registrar'));
  if (registrar === undefined) return { name: null, ianaId: null };
  const card = list(list(registrar.vcardArray)[1]);
  const fn = card.map(list).find((field) => field[0] === 'fn');
  const iana = list(registrar.publicIds).map(record).find((id) => id.type === 'IANA Registrar ID');
  return { name: text(fn?.[3]), ianaId: text(iana?.identifier) };
}

/** What an RDAP domain answer says, or null when it is not one. */
export function parseRdap(raw: unknown): Registration | null {
  const body = record(raw);
  if (body.objectClassName !== 'domain') return null;
  const name = text(body.ldhName) ?? text(body.unicodeName);
  if (name === null) return null;
  const events = list(body.events).map(record);
  const when = (action: string): string | null => text(events.find((event) => event.eventAction === action)?.eventDate);
  const { name: registrar, ianaId } = registrarOf(list(body.entities));
  const secure = record(body.secureDNS);
  return {
    name,
    handle: text(body.handle),
    registrar,
    ianaId,
    created: when('registration'),
    updated: when('last changed'),
    expires: when('expiration'),
    statuses: list(body.status).flatMap((status) => {
      const clean = text(status);
      return clean === null ? [] : [eppStatus(clean)];
    }),
    nameservers: list(body.nameservers).flatMap((server) => {
      const clean = text(record(server).ldhName);
      return clean === null ? [] : [clean];
    }),
    dnssec: secure.delegationSigned === true ? 'signedDelegation' : secure.delegationSigned === false ? 'unsigned' : null,
  };
}

/** whois's lines for a registration, in the order registries print them. */
export function registrationLines(r: Registration): string[] {
  const field = (label: string, value: string | null): string[] => (value === null ? [] : [`   ${label}: ${value}`]);
  return [
    ...field('Domain Name', r.name),
    ...field('Registry Domain ID', r.handle),
    ...field('Registrar', r.registrar),
    ...field('Registrar IANA ID', r.ianaId),
    ...field('Creation Date', r.created),
    ...field('Updated Date', r.updated),
    ...field('Registry Expiry Date', r.expires),
    ...r.statuses.flatMap((status) => field('Domain Status', status)),
    ...r.nameservers.flatMap((server) => field('Name Server', server)),
    ...field('DNSSEC', r.dnssec),
  ];
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

export async function run(ctx: CommandContext): Promise<ExitCode> {
  const [word, extra] = ctx.args;
  if (word === undefined) return ctx.usage('missing DOMAIN');
  if (extra !== undefined) return ctx.usage(`extra operand '${extra}'`);
  if (ipVersion(word) !== null) return ctx.fail(`${word}: vesen looks up domain names only, such as whois vesen.app`);
  const domain = hostName(word);
  if (domain === null || !domain.includes('.')) return ctx.fail(`'${word}' is not a domain name, such as vesen.app`);
  const tld = domain.slice(domain.lastIndexOf('.') + 1);

  let response: NetResponse;
  try {
    response = await ctx.net.text(`${RDAP}${encodeURIComponent(domain)}`, {
      headers: { accept: 'application/rdap+json' },
      signal: ctx.signal,
      throwHttpErrors: false,
    });
  } catch (error) {
    if (!ctx.net.isError(error) || error.kind === 'abort') throw error;
    return ctx.fail(`${error.host}: ${netReason(error)}`);
  }
  const registry = hostOf(response.url) ?? 'rdap.org';
  if (response.status === 404) {
    if (registry === 'rdap.org') return ctx.fail(`no RDAP service for .${tld}`);
    await ctx.stdout.write(`No match for "${domain.toUpperCase()}".\n`);
    return 1;
  }
  if (response.status === 429) return ctx.fail(`${registry} is limiting requests (HTTP 429); try again in a minute`);
  if (response.status >= 400) return ctx.fail(`${registry}: HTTP ${response.status}`);
  let registration: Registration | null = null;
  try {
    registration = parseRdap(JSON.parse(response.body) as unknown);
  } catch {
    // Not JSON: said below.
  }
  if (registration === null) return ctx.fail(`${registry} sent an answer that could not be read`);

  const muted = { fg: 'muted' } as const;
  await ctx.stdout.line(out.span("% Asked over RDAP: whois's own port 43 is out of a browser's reach.", muted));
  await ctx.stdout.line(out.span(`% From ${registry}${registry === 'rdap.org' ? '' : ', found through rdap.org'}`, muted));
  await ctx.stdout.write(`\n${registrationLines(registration).join('\n')}\n`);
  return 0;
}
