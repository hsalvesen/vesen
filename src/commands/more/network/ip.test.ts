// ip and ifconfig (docs/plan/08 wave D): lo, and a synthetic eth0 that says so; the public
// address from Cloudflare's trace (a recorded fixture, its address a documentation one), asked
// only for ip addr and ifconfig, and only after saying so; and Linux's answers to a change.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runLine, session } from '../../../../tests/harness';
import { hang, serveNet } from '../../../../tests/support/net';
import { parseTrace, publicLine } from '../../lib/interfaces';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const NOTICE = 'ip: asking Cloudflare for your public address (www.cloudflare.com/cdn-cgi/trace)';
const SYNTHETIC = "# eth0 is synthetic: a browser cannot see this device's network interfaces";
const PUBLIC = '# public address: 203.0.113.7, as Cloudflare sees it (its SYD data centre, AU)';

describe('ip', () => {
  it("shows lo and eth0 in iproute2's layout, says eth0 is synthetic, and gives the public address after saying it asks", async () => {
    const net = serveNet();
    const { status, stdoutPlain, screen } = await runLine('ip addr');
    expect(status).toBe(0);
    expect(stdoutPlain.split('\n')).toEqual([
      '1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN group default qlen 1000',
      '    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00',
      '    inet 127.0.0.1/8 scope host lo',
      '       valid_lft forever preferred_lft forever',
      '    inet6 ::1/128 scope host noprefixroute',
      '       valid_lft forever preferred_lft forever',
      '2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc fq_codel state UP group default qlen 1000',
      '    link/ether 02:56:45:53:45:4e brd ff:ff:ff:ff:ff:ff',
      '    inet 10.42.0.42/24 brd 10.42.0.255 scope global eth0',
      '       valid_lft forever preferred_lft forever',
      '    inet6 fe80::56:45ff:fe53:454e/64 scope link',
      '       valid_lft forever preferred_lft forever',
      SYNTHETIC,
      PUBLIC,
    ]);
    // The notice comes first, before anything is asked.
    expect(screen[0]).toBe(`! ${NOTICE}`);
    expect(net.requests.map((request) => request.url)).toEqual(['https://www.cloudflare.com/cdn-cgi/trace']);
  });

  it('abbreviates, as ip does, and gives one line a device with -br', async () => {
    serveNet();
    const brief = await runLine('ip -br a', { tty: false });
    expect(brief.stdoutPlain.split('\n').slice(0, 2)).toEqual([
      'lo               UNKNOWN        127.0.0.1/8 ::1/128',
      'eth0             UP             10.42.0.42/24 fe80::56:45ff:fe53:454e/64',
    ]);
    expect((await runLine('ip -4 -br addr', { tty: false })).stdoutPlain).toContain('eth0             UP             10.42.0.42/24\n');
  });

  it('asks nobody for ip route, ip link, or lo alone', async () => {
    const net = serveNet();
    expect((await runLine('ip route')).stdoutPlain).toBe(
      ['default via 10.42.0.1 dev eth0 proto static', '10.42.0.0/24 dev eth0 proto kernel scope link src 10.42.0.42', SYNTHETIC].join('\n'),
    );
    expect((await runLine('ip -br link')).stdoutPlain.split('\n')[1]).toBe('eth0             UP             02:56:45:53:45:4e <BROADCAST,MULTICAST,UP,LOWER_UP>');
    const lo = await runLine('ip a s lo');
    expect(lo.stdoutPlain).not.toContain('eth0');
    expect(lo.stderrPlain).toBe('');
    expect(net.requests).toEqual([]);
  });

  it('takes eth0 down while the browser is offline, and asks nothing', async () => {
    const net = serveNet();
    vi.stubGlobal('navigator', { onLine: false });
    const { stdoutPlain, stderrPlain } = await runLine('ip addr');
    expect(stdoutPlain).toContain('2: eth0: <NO-CARRIER,BROADCAST,MULTICAST,UP> mtu 1500 qdisc fq_codel state DOWN group default qlen 1000');
    expect(stdoutPlain).toContain('# public address: unknown (the browser is offline)');
    expect(stderrPlain).toBe('');
    expect((await runLine('ip route')).stdoutPlain).toContain('default via 10.42.0.1 dev eth0 proto static linkdown');
    expect(net.requests).toEqual([]);
  });

  it('still shows the interfaces when Cloudflare fails or does not answer', async () => {
    serveNet((url) => (url.host === 'www.cloudflare.com' ? new Response('no', { status: 503 }) : undefined));
    const failed = await runLine('ip a');
    expect(failed.status).toBe(0);
    expect(failed.stdoutPlain).toContain('# public address: unknown (Cloudflare: HTTP 503)');

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    serveNet((url, init) => (url.host === 'www.cloudflare.com' ? hang(init) : undefined));
    const s = await session();
    const pending = s.run('ip a');
    await vi.advanceTimersByTimeAsync(4000);
    const slow = await pending;
    s.stop();
    expect(slow.stdoutPlain).toContain('# public address: unknown (Cloudflare: no answer within 4 s)');

    serveNet((url) => (url.host === 'www.cloudflare.com' ? Promise.reject(new TypeError('Failed to fetch')) : undefined));
    expect((await runLine('ip a')).stdoutPlain).toContain('# public address: unknown (Cloudflare: blocked by CORS or unreachable (the browser does not say which))');
  });

  it("answers as Linux does to a change, a device that is not there, and bad words", async () => {
    expect(await runLine('ip addr add 192.0.2.1/24 dev eth0')).toMatchObject({ status: 2, stderrPlain: 'RTNETLINK answers: Operation not permitted' });
    expect(await runLine('ip link set eth0 down')).toMatchObject({ status: 2, stderrPlain: 'RTNETLINK answers: Operation not permitted' });
    expect(await runLine('ip a s wlan0')).toMatchObject({ status: 1, stderrPlain: 'Device "wlan0" does not exist.' });
    expect(await runLine('ip neigh')).toMatchObject({ status: 1, stderrPlain: 'Object "neigh" is unknown, try "ip help".' });
    expect(await runLine('ip -z a')).toMatchObject({ status: 255, stderrPlain: 'Option "-z" is unknown, try "ip -help".' });
    expect((await runLine('ip')).status).toBe(255);
  });

  it('answers ip route get with the route the synthetic table picks, asking nobody', async () => {
    const net = serveNet();
    expect(await runLine('ip route get 1.1.1.1', { tty: false })).toMatchObject({
      status: 0,
      stdoutPlain: ['1.1.1.1 via 10.42.0.1 dev eth0 src 10.42.0.42 uid 1000', '    cache', SYNTHETIC].join('\n'),
      stderrPlain: '',
    });
    // On eth0's own network there is no gateway; lo and eth0's own address are local.
    expect((await runLine('ip r g to 10.42.0.7', { tty: false })).stdoutPlain.split('\n')[0]).toBe('10.42.0.7 dev eth0 src 10.42.0.42 uid 1000');
    expect((await runLine('ip route get 127.0.0.1', { tty: false })).stdoutPlain).toBe('local 127.0.0.1 dev lo src 127.0.0.1 uid 1000\n    cache <local>');
    expect((await runLine('ip route get 10.42.0.42', { tty: false })).stdoutPlain).toBe('local 10.42.0.42 dev lo src 10.42.0.42 uid 1000\n    cache <local>');
    expect((await runLine('ip route get ::1', { tty: false })).stdoutPlain).toBe('local ::1 from :: dev lo table local proto kernel src ::1 metric 0 pref medium');
    // No IPv6 default route: the kernel's answer.
    expect(await runLine('ip route get 2606:4700:4700::1111', { tty: false })).toMatchObject({ status: 2, stderrPlain: 'RTNETLINK answers: Network is unreachable' });
    expect(net.requests).toEqual([]);
  });

  it("words a bad ip route get, and an unknown command, as iproute2 does, rather than reading them as a device", async () => {
    expect(await runLine('ip route get nonsense')).toMatchObject({ status: 1, stderrPlain: 'Error: any valid prefix is expected rather than "nonsense".' });
    expect(await runLine('ip -4 route get ::1')).toMatchObject({ status: 1, stderrPlain: 'Error: inet prefix is expected rather than "::1".' });
    expect(await runLine('ip route get')).toMatchObject({ status: 255, stderrPlain: 'Usage: ip route show [ dev NAME ]\n       ip route get ADDRESS' });
    expect(await runLine('ip route foo')).toMatchObject({ status: 255, stderrPlain: 'Command "foo" is unknown, try "ip route help".' });
    expect(await runLine('ip link eth0')).toMatchObject({ status: 255, stderrPlain: 'Command "eth0" is unknown, try "ip link help".' });
    expect(await runLine('ip addr get 1.1.1.1')).toMatchObject({ status: 255, stderrPlain: 'Command "get" is unknown, try "ip address help".' });
  });
});

describe('ifconfig', () => {
  it("shows the same interfaces in net-tools' layout, eth0 first, with the public address", async () => {
    serveNet();
    const { status, stdoutPlain, stderrPlain } = await runLine('ifconfig');
    expect(status).toBe(0);
    expect(stderrPlain).toBe('ifconfig: asking Cloudflare for your public address (www.cloudflare.com/cdn-cgi/trace)');
    expect(stdoutPlain.split('\n')).toEqual([
      'eth0: flags=4163<UP,BROADCAST,RUNNING,MULTICAST>  mtu 1500',
      '        inet 10.42.0.42  netmask 255.255.255.0  broadcast 10.42.0.255',
      '        inet6 fe80::56:45ff:fe53:454e  prefixlen 64  scopeid 0x20<link>',
      '        ether 02:56:45:53:45:4e  txqueuelen 1000  (Ethernet)',
      '',
      'lo: flags=73<UP,LOOPBACK,RUNNING>  mtu 65536',
      '        inet 127.0.0.1  netmask 255.0.0.0',
      '        inet6 ::1  prefixlen 128  scopeid 0x10<host>',
      '        loop  txqueuelen 1000  (Local Loopback)',
      '',
      SYNTHETIC,
      PUBLIC,
    ]);
  });

  it('shows one interface, asking nobody for lo, and refuses a change', async () => {
    const net = serveNet();
    expect((await runLine('ifconfig lo')).stdoutPlain).toBe(
      ['lo: flags=73<UP,LOOPBACK,RUNNING>  mtu 65536', '        inet 127.0.0.1  netmask 255.0.0.0', '        inet6 ::1  prefixlen 128  scopeid 0x10<host>', '        loop  txqueuelen 1000  (Local Loopback)', ''].join('\n'),
    );
    expect(net.requests).toEqual([]);
    expect(await runLine('ifconfig wlan0')).toMatchObject({ status: 1, stderrPlain: 'wlan0: error fetching interface information: Device not found' });
    expect(await runLine('ifconfig eth0 down')).toMatchObject({ status: 1, stderrPlain: 'ifconfig: SIOCSIFFLAGS: Operation not permitted' });
  });
});

describe("Cloudflare's trace", () => {
  it('reads the address, data centre and country, and nothing it does not trust', () => {
    expect(parseTrace('ip=203.0.113.7\ncolo=SYD\nloc=AU\n')).toEqual({ ip: '203.0.113.7', colo: 'SYD', country: 'AU' });
    expect(parseTrace('ip=2001:db8::7\ncolo=\u001b[31m\nloc=australia')).toEqual({ ip: '2001:db8::7', colo: null, country: null });
    expect(parseTrace('ip=<script>')).toBeNull();
    expect(publicLine({ ip: '203.0.113.7', colo: null, country: null })).toBe('# public address: 203.0.113.7, as Cloudflare sees it');
  });
});
