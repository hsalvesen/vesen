// The network interfaces ip and ifconfig show. A page cannot see the device's own interfaces,
// so these are made up and say so: lo, as every Linux has it, and eth0 on a private 10.42.0.0/24
// with a locally administered MAC address that spells VESEN (02:56:45:53:45:4e). eth0 is up while
// the browser says it is online. What is real is the visitor's public address, which only
// Cloudflare can say, asked (https://www.cloudflare.com/cdn-cgi/trace) when ip addr or ifconfig
// shows eth0, and said first.

import { whenAborted } from '../../lib/signals';
import { REQUEST_TIMEOUT_MS, type Net } from '../../services/types';
import { ipVersion } from './dns';
import { netReason } from './net-words';

export interface Address {
  readonly family: 'inet' | 'inet6';
  readonly address: string;
  readonly prefix: number;
  readonly broadcast?: string;
  readonly scope: 'host' | 'link' | 'global';
}

export interface Interface {
  readonly index: number;
  readonly name: 'lo' | 'eth0';
  readonly loopback: boolean;
  readonly up: boolean;
  readonly mtu: number;
  readonly mac: string;
  readonly addresses: readonly Address[];
}

export const ETH0 = { address: '10.42.0.42', prefix: 24, network: '10.42.0.0', gateway: '10.42.0.1', broadcast: '10.42.0.255', netmask: '255.255.255.0' } as const;
export const MAC = '02:56:45:53:45:4e';
/** eth0's link-local IPv6 address, made from its MAC (EUI-64). */
export const ETH0_LINK_LOCAL = 'fe80::56:45ff:fe53:454e';

/** The interfaces, in ip's order; eth0 is down while the browser is offline. */
export function interfaces(online: boolean): Interface[] {
  return [
    {
      index: 1,
      name: 'lo',
      loopback: true,
      up: true,
      mtu: 65536,
      mac: '00:00:00:00:00:00',
      addresses: [
        { family: 'inet', address: '127.0.0.1', prefix: 8, scope: 'host' },
        { family: 'inet6', address: '::1', prefix: 128, scope: 'host' },
      ],
    },
    {
      index: 2,
      name: 'eth0',
      loopback: false,
      up: online,
      mtu: 1500,
      mac: MAC,
      addresses: [
        { family: 'inet', address: ETH0.address, prefix: ETH0.prefix, broadcast: ETH0.broadcast, scope: 'global' },
        { family: 'inet6', address: ETH0_LINK_LOCAL, prefix: 64, scope: 'link' },
      ],
    },
  ];
}

/** Said under the interfaces, every time. */
export const SYNTHETIC_NOTE = "# eth0 is synthetic: a browser cannot see this device's network interfaces";

export const TRACE_URL = 'https://www.cloudflare.com/cdn-cgi/trace';

/** Said before asking Cloudflare. */
export const TRACE_NOTICE = 'asking Cloudflare for your public address (www.cloudflare.com/cdn-cgi/trace)';

export interface PublicAddress {
  readonly ip: string;
  /** Cloudflare's data centre, an airport code such as SYD. */
  readonly colo: string | null;
  /** The country, such as AU. */
  readonly country: string | null;
}

/** Reads Cloudflare's trace (key=value lines); null when it has no address. */
export function parseTrace(text: string): PublicAddress | null {
  const fields = new Map<string, string>();
  for (const line of text.split('\n')) {
    const at = line.indexOf('=');
    if (at > 0) fields.set(line.slice(0, at).trim(), line.slice(at + 1).trim());
  }
  const ip = fields.get('ip') ?? '';
  if (ipVersion(ip) === null) return null;
  const colo = fields.get('colo') ?? '';
  const country = fields.get('loc') ?? '';
  return { ip, colo: /^[A-Z]{3}$/.test(colo) ? colo : null, country: /^[A-Z]{2}$/.test(country) ? country : null };
}

/** The visitor's public address as Cloudflare sees it, kept for 5 minutes; or why it is unknown. */
export async function publicAddress(net: Pick<Net, 'text' | 'memo' | 'isError' | 'online'>, signal: AbortSignal): Promise<PublicAddress | string> {
  if (!net.online()) return 'the browser is offline';
  try {
    // Shared by every caller within 5 minutes, so it takes no signal; ^C still ends the wait.
    const asked = net.memo('cloudflare-trace', 5 * 60_000, async () => (await net.text(TRACE_URL, { timeoutMs: REQUEST_TIMEOUT_MS.ipLookup })).body);
    const text = await Promise.race([asked, whenAborted(signal).then((reason) => Promise.reject(reason))]);
    return parseTrace(text) ?? 'Cloudflare did not say';
  } catch (error) {
    if (signal.aborted || !net.isError(error)) throw error;
    return `Cloudflare: ${netReason(error)}`;
  }
}

/** The line under the interfaces that gives the public address, or says why it is unknown. */
export function publicLine(found: PublicAddress | string): string {
  if (typeof found === 'string') return `# public address: unknown (${found})`;
  const where = [found.colo === null ? null : `its ${found.colo} data centre`, found.country].filter((part) => part !== null).join(', ');
  return `# public address: ${found.ip}, as Cloudflare sees it${where === '' ? '' : ` (${where})`}`;
}
