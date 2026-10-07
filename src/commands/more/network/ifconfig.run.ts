// The body of ifconfig; its spec, in ifconfig.ts, loads this the first time ifconfig runs.

import { out } from '../../../output/model';
import type { CommandContext, CommandDoc, ExitCode } from '../../../shell/types';
import { ETH0, SYNTHETIC_NOTE, TRACE_NOTICE, interfaces, publicAddress, publicLine, type Interface } from '../../lib/interfaces';

/** What --help, help and man say about ifconfig, besides its spec (ifconfig.ts). */
export const doc: CommandDoc = {
  description:
    "Shows the network interfaces as net-tools lays them out: the same as ip addr. A browser cannot see this device's network interfaces, so lo is the loopback every Linux has and eth0 is synthetic, marked so, and down while the browser is offline. Shown with eth0, your public address follows: ifconfig says first that it is asking Cloudflare, then asks. Changing an interface (ifconfig eth0 down) needs root, which a visitor is not.",
};

/** net-tools' flags word: the bits of IFF_UP (1), BROADCAST (2), LOOPBACK (8), RUNNING (64), MULTICAST (4096). */
function flagsOf(iface: Interface): string {
  if (iface.loopback) return 'flags=73<UP,LOOPBACK,RUNNING>';
  return iface.up ? 'flags=4163<UP,BROADCAST,RUNNING,MULTICAST>' : 'flags=4099<UP,BROADCAST,MULTICAST>';
}

function block(iface: Interface): string[] {
  if (iface.loopback) {
    return [
      `lo: ${flagsOf(iface)}  mtu ${iface.mtu}`,
      '        inet 127.0.0.1  netmask 255.0.0.0',
      '        inet6 ::1  prefixlen 128  scopeid 0x10<host>',
      '        loop  txqueuelen 1000  (Local Loopback)',
    ];
  }
  const v6 = iface.addresses.find((address) => address.family === 'inet6');
  return [
    `${iface.name}: ${flagsOf(iface)}  mtu ${iface.mtu}`,
    `        inet ${ETH0.address}  netmask ${ETH0.netmask}  broadcast ${ETH0.broadcast}`,
    ...(v6 === undefined ? [] : [`        inet6 ${v6.address}  prefixlen ${v6.prefix}  scopeid 0x20<link>`]),
    `        ether ${iface.mac}  txqueuelen 1000  (Ethernet)`,
  ];
}

export async function run(ctx: CommandContext): Promise<ExitCode> {
  const operands = ctx.args.filter((word) => !/^-[avs]$/.test(word));
  const [name, ...change] = operands;
  const online = ctx.net.online();
  // net-tools lists eth0 before lo.
  const all = interfaces(online).sort((a, b) => Number(a.loopback) - Number(b.loopback));
  const shown = name === undefined ? all : all.filter((iface) => iface.name === name);
  if (shown.length === 0) {
    await ctx.stderr.line(out.span(`${name ?? ''}: error fetching interface information: Device not found`, { fg: 'error' }));
    return 1;
  }
  if (change.length > 0) return ctx.fail('SIOCSIFFLAGS: Operation not permitted', 1);

  const asks = shown.some((iface) => !iface.loopback);
  if (asks && online) await ctx.stderr.line(out.span(`ifconfig: ${TRACE_NOTICE}`, { fg: 'muted' }));
  const found = asks ? await publicAddress(ctx.net, ctx.signal) : null;

  await ctx.stdout.write(`${shown.map((iface) => block(iface).join('\n')).join('\n\n')}\n\n`);
  if (asks) {
    for (const note of [SYNTHETIC_NOTE, ...(found === null ? [] : [publicLine(found)])]) await ctx.stdout.line(out.span(note, { fg: 'muted' }));
  }
  return 0;
}
