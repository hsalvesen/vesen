// ip: the network interfaces, routes and links, in iproute2's layout (commands/lib/interfaces.ts).
// eth0 is synthetic, and says so; ip addr also asks Cloudflare for the public address, after
// saying it will. It reads its own words: ip's objects and commands abbreviate (ip a s lo).

import type { RawArgsSpec } from '../../../shell/flags';
import type { CommandSpec, EnumValue, RunnerChoice } from '../../../shell/types';

const OBJECTS: readonly EnumValue[] = [
  { value: 'addr', summary: 'addresses, and your public one' },
  { value: 'route', summary: 'the routing table' },
  { value: 'link', summary: 'the network devices' },
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
  args: [
    { name: 'OBJECT', source: { kind: 'enum', values: () => OBJECTS } },
    { name: 'COMMAND', source: { kind: 'enum', values: () => [{ value: 'show' }, { value: 'get', summary: 'the route to an address (ip route get)' }] }, optional: true },
    { name: 'DEV', source: { kind: 'enum', values: () => [{ value: 'lo' }, { value: 'eth0' }] }, optional: true },
  ],
  loadingLabel: (argv) => (/^a/.test(argv.slice(1).find((word) => !word.startsWith('-')) ?? '') ? 'ip: asking Cloudflare for your public address…' : 'ip'),
  examples: [
    { line: 'ip addr', note: 'the addresses, and your public one' },
    { line: 'ip -br link', note: 'one line a device', offline: true },
    { line: 'ip route', note: 'the routing table', offline: true },
    { line: 'ip route get 1.1.1.1', note: 'which route, device and address reach a host', offline: true },
    { line: 'ip a s lo', note: 'one device, abbreviated', offline: true },
  ],
  seeAlso: ['ifconfig', 'ping', 'privacy'],
  load: () => import('./ip.run'),
};

export default spec;
