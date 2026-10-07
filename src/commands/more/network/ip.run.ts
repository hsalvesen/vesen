// The body of ip; its spec, in ip.ts, loads this the first time ip runs.

import { out } from '../../../output/model';
import type { CommandContext, CommandDoc, ExitCode } from '../../../shell/types';
import { ETH0, SYNTHETIC_NOTE, TRACE_NOTICE, interfaces, publicAddress, publicLine, type Address, type Interface } from '../../lib/interfaces';

/** What --help, help and man say about ip, besides its spec (ip.ts). */
export const doc: CommandDoc = {
  description:
    "Shows the network devices (ip link), their addresses (ip addr, or ip a) and the routing table (ip route, or ip r), as iproute2 lays them out; -br gives one line a device, -4 and -6 one family. A browser cannot see this device's network interfaces, so lo is the loopback every Linux has, and eth0, on 10.42.0.0/24, is synthetic and marked so; it goes down while the browser is offline. ip addr also gives your public address, which only a server can see: it says first that it is asking Cloudflare, then asks.",
  man: [
    {
      heading: 'CHANGING THINGS',
      body: "ip addr add, ip link set and the like need root, which a visitor is not: they answer 'RTNETLINK answers: Operation not permitted', as Linux does.",
    },
    { heading: 'EXIT STATUS', body: '0 on success. 1 for a device that does not exist or an unknown object. 2 for a change, which is not permitted. 255 for bad usage.' },
  ],
};

const USAGE = [
  'Usage: ip [ OPTIONS ] OBJECT { COMMAND | help }',
  'where  OBJECT := { address | link | route }',
  '       OPTIONS := { -4 | -6 | -br[ief] }',
];

type ObjectName = 'address' | 'link' | 'route';

/** ip's matching: any prefix of the word, `a` for address, `r` for route, `l` for link. */
function objectOf(word: string): ObjectName | null {
  const lower = word.toLowerCase();
  for (const name of ['address', 'route', 'link'] as const) if (lower.length > 0 && name.startsWith(lower)) return name;
  return null;
}

interface Plan {
  readonly family: 'inet' | 'inet6' | null;
  readonly brief: boolean;
  readonly object: ObjectName;
  readonly device: string | null;
}

type Problem = { readonly lines: readonly string[]; readonly status: ExitCode };

function readPlan(words: readonly string[]): Plan | Problem {
  let family: Plan['family'] = null;
  let brief = false;
  let i = 0;
  for (; i < words.length && (words[i] ?? '').startsWith('-'); i += 1) {
    const word = words[i] ?? '';
    if (word === '-4') family = 'inet';
    else if (word === '-6') family = 'inet6';
    else if (word === '-br' || word === '-brief' || word === '--brief' || word === '--br') brief = true;
    else if (/^--?c(?:olor|olour)?(?:=\w+)?$/.test(word)) continue;
    else return { lines: [`Option "${word}" is unknown, try "ip -help".`], status: 255 };
  }
  const objectWord = words[i];
  if (objectWord === undefined || objectWord === 'help') return { lines: USAGE, status: 255 };
  const object = objectOf(objectWord);
  if (object === null) return { lines: [`Object "${objectWord}" is unknown, try "ip help".`], status: 1 };
  const rest = words.slice(i + 1);
  const [command] = rest;
  if (command === 'help') return { lines: [`Usage: ip ${object} show [ dev NAME ]`], status: 255 };
  let operands = rest;
  if (command !== undefined) {
    if (/^(?:s|sh|sho|show|l|ls|lst|li|lis|list)$/.test(command)) operands = rest.slice(1);
    else if (/^(?:add|del|delete|change|chg|replace|set|flush|append|prepend|test)$/.test(command)) return { lines: ['RTNETLINK answers: Operation not permitted'], status: 2 };
    // Anything else is a device, as in `ip link eth0`.
  }
  if (operands[0] === 'dev') operands = operands.slice(1);
  const [device, extra] = operands;
  if (extra !== undefined) return { lines: [`Error: either "dev" is duplicate, or "${extra}" is a garbage.`], status: 255 };
  return { family, brief, object, device: device ?? null };
}

const flagsOf = (iface: Interface): string =>
  iface.loopback ? 'LOOPBACK,UP,LOWER_UP' : iface.up ? 'BROADCAST,MULTICAST,UP,LOWER_UP' : 'NO-CARRIER,BROADCAST,MULTICAST,UP';
const stateOf = (iface: Interface): string => (iface.loopback ? 'UNKNOWN' : iface.up ? 'UP' : 'DOWN');
const qdiscOf = (iface: Interface): string => (iface.loopback ? 'noqueue' : 'fq_codel');

function linkLine(iface: Interface): string {
  return iface.loopback ? `    link/loopback ${iface.mac} brd 00:00:00:00:00:00` : `    link/ether ${iface.mac} brd ff:ff:ff:ff:ff:ff`;
}

function headLine(iface: Interface, mode: boolean): string {
  return `${iface.index}: ${iface.name}: <${flagsOf(iface)}> mtu ${iface.mtu} qdisc ${qdiscOf(iface)} state ${stateOf(iface)}${mode ? ' mode DEFAULT' : ''} group default qlen 1000`;
}

function addressLines(iface: Interface, address: Address): string[] {
  const brd = address.broadcast === undefined ? '' : ` brd ${address.broadcast}`;
  const label = address.family === 'inet' ? ` ${iface.name}` : iface.loopback ? ' noprefixroute' : '';
  return [`    ${address.family} ${address.address}/${address.prefix}${brd} scope ${address.scope}${label}`, '       valid_lft forever preferred_lft forever'];
}

function addresses(iface: Interface, family: Plan['family']): Address[] {
  return iface.addresses.filter((address) => family === null || address.family === family);
}

function show(plan: Plan, shown: readonly Interface[], online: boolean): string[] {
  const pad = (iface: Interface): string => `${iface.name.padEnd(16)} ${stateOf(iface).padEnd(14)}`;
  switch (plan.object) {
    case 'link':
      return plan.brief
        ? shown.map((iface) => `${pad(iface)} ${iface.mac} <${flagsOf(iface)}>`)
        : shown.flatMap((iface) => [headLine(iface, true), linkLine(iface)]);
    case 'address':
      return plan.brief
        ? shown.map((iface) => `${pad(iface)} ${addresses(iface, plan.family).map((a) => `${a.address}/${a.prefix}`).join(' ')}`.trimEnd())
        : shown.flatMap((iface) => [headLine(iface, false), linkLine(iface), ...addresses(iface, plan.family).flatMap((a) => addressLines(iface, a))]);
    case 'route': {
      const down = online ? '' : ' linkdown';
      const eth0 = shown.some((iface) => iface.name === 'eth0');
      if (plan.family === 'inet6') {
        return [
          ...(shown.some((iface) => iface.name === 'lo') ? ['::1 dev lo proto kernel metric 256 pref medium'] : []),
          ...(eth0 ? [`fe80::/64 dev eth0 proto kernel metric 256${down} pref medium`] : []),
        ];
      }
      return eth0 ? [`default via ${ETH0.gateway} dev eth0 proto static${down}`, `${ETH0.network}/${ETH0.prefix} dev eth0 proto kernel scope link src ${ETH0.address}${down}`] : [];
    }
  }
}

export async function run(ctx: CommandContext): Promise<ExitCode> {
  const plan = readPlan(ctx.args);
  if ('lines' in plan) {
    for (const line of plan.lines) await ctx.stderr.line(out.span(line, plan.status === 255 ? {} : { fg: 'error' }));
    return plan.status;
  }
  const online = ctx.net.online();
  const all = interfaces(online);
  const shown = plan.device === null ? all : all.filter((iface) => iface.name === plan.device);
  if (shown.length === 0) {
    await ctx.stderr.line(out.span(`Device "${plan.device ?? ''}" does not exist.`, { fg: 'error' }));
    return 1;
  }
  // Only a server can see the public address, so ask one, and say so first.
  const asks = plan.object === 'address' && shown.some((iface) => !iface.loopback);
  if (asks && online) await ctx.stderr.line(out.span(`ip: ${TRACE_NOTICE}`, { fg: 'muted' }));
  const found = asks ? await publicAddress(ctx.net, ctx.signal) : null;

  const lines = show(plan, shown, online);
  if (lines.length > 0) await ctx.stdout.write(`${lines.join('\n')}\n`);
  const notes = [...(shown.some((iface) => !iface.loopback) ? [SYNTHETIC_NOTE] : []), ...(found === null ? [] : [publicLine(found)])];
  for (const note of notes) await ctx.stdout.line(out.span(note, { fg: 'muted' }));
  return 0;
}
