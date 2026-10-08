// ip: the network interfaces, routes and links, in iproute2's layout (commands/lib/interfaces.ts).
// eth0 is synthetic, and says so; ip addr also asks Cloudflare for the public address, after
// saying it will. It reads its own words: ip's objects and commands abbreviate (ip a s lo).

import type { RawArgsSpec } from '../../../shell/flags';
import type { ArgSpec, CommandSpec, EnumValue, RunnerChoice } from '../../../shell/types';

/** Every start of a word, as ip reads its objects and commands: `a` to `address`. */
const starts = (word: string): string[] => Array.from(word, (_, i) => word.slice(0, i + 1));

const DEVICES: readonly EnumValue[] = [{ value: 'lo' }, { value: 'eth0' }];

/** `show [dev] NAME`: a device, with or without dev before it. */
const DEVICE: ArgSpec = {
  name: 'DEV',
  source: { kind: 'enum', values: () => [...DEVICES, { value: 'dev', args: [{ name: 'NAME', source: { kind: 'enum', values: () => DEVICES } }] }] },
  optional: true,
};

const SHOW: EnumValue = { value: 'show', summary: 'list them, the default', aliases: [...starts('show'), ...starts('list'), 'ls', 'lst'], args: [DEVICE] };

/** Only `ip route` has get, and it takes an address, never a device. */
const GET: EnumValue = {
  value: 'get',
  summary: 'the route to one address',
  aliases: starts('get'),
  args: [{ name: 'ADDRESS', source: { kind: 'examples', fromHistory: true } }],
};

const command = (values: readonly EnumValue[]): ArgSpec => ({ name: 'COMMAND', source: { kind: 'enum', values: () => values }, optional: true });

const OBJECTS: readonly EnumValue[] = [
  { value: 'addr', summary: 'addresses, and your public one', aliases: starts('address'), args: [command([SHOW])] },
  { value: 'route', summary: 'the routing table', aliases: starts('route'), args: [command([SHOW, GET])] },
  { value: 'link', summary: 'the network devices', aliases: starts('link'), args: [command([SHOW])] },
];

const spec: CommandSpec & RawArgsSpec & RunnerChoice = {
  name: 'ip',
  category: 'network',
  summary: 'show addresses, routes and network devices',
  synopsis: ['ip [-4 | -6 | -br] addr|route|link [show [dev] [NAME]]', 'ip route get ADDRESS'],
  rawArgs: true,
  flags: [
    { short: '4', description: 'IPv4 only' },
    { short: '6', description: 'IPv6 only' },
    { long: 'br', description: 'brief: one line a device (written -br)' },
  ],
  // Each object's words choose what follows them, so Tab and the chips offer get only after route.
  args: [{ name: 'OBJECT', source: { kind: 'enum', values: () => OBJECTS } }],
  loadingLabel: (argv) => (/^a/.test(argv.slice(1).find((word) => !word.startsWith('-')) ?? '') ? 'ip: asking Cloudflare for your public address…' : 'ip'),
  examples: [
    { line: 'ip addr', note: 'the addresses, and your public one' },
    { line: 'ip -br link', note: 'one line a device', offline: true },
    { line: 'ip route', note: 'the routing table', offline: true },
    { line: 'ip route get 1.1.1.1', note: 'which route, device and address reach a host', offline: true },
    { line: 'ip route get 10.42.0.7', note: "a neighbour on eth0's network: no gateway", offline: true },
    { line: 'ip a s lo', note: 'one device, abbreviated', offline: true },
  ],
  seeAlso: ['ifconfig', 'ping', 'privacy'],
  load: () => import('./ip.run'),
};

export default spec;
