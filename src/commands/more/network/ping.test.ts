// ping (docs/plan/08 wave D): the name resolved over DNS over HTTPS (recorded fixtures), then
// HTTPS round trips timed on a fake clock, so every time and every statistic is exact: the
// summary's maths, lost requests, ^C mid-run, the budget, and the names it refuses.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { session } from '../../../../tests/harness';
import { hang, serveNet } from '../../../../tests/support/net';
import { formatRtt, statistics } from './ping.run';

afterEach(() => vi.unstubAllGlobals());

/**
 * A session whose clock moves only when a probe is answered: each request to the pinged host
 * takes the next of `rtts` (ms), or does what `probe` says instead.
 */
async function rig(rtts: readonly number[], probe?: (n: number, init: RequestInit) => Promise<Response> | undefined) {
  let now = Date.UTC(2026, 9, 6, 9, 0, 0);
  let probes = 0;
  const net = serveNet((url, init) => {
    if (url.host.includes('dns')) return undefined;
    probes += 1;
    const custom = probe?.(probes, init);
    if (custom !== undefined) return custom;
    now += rtts[probes - 1] ?? 0;
    return new Response(null, { status: 200 });
  });
  const s = await session({ now: () => now });
  return { s, net, probes: () => probes };
}

describe('ping', () => {
  it('resolves the name, times each HTTPS request, and ends with the statistics', async () => {
    const { s, net } = await rig([20, 30, 25]);
    const { status, stdoutPlain, stderrPlain } = await s.run('ping -c 3 -i 0.2 example.com');
    s.stop();
    expect(status).toBe(0);
    expect(stderrPlain).toBe('');
    expect(stdoutPlain).toBe(
      [
        'PING example.com (172.66.147.243) over HTTPS',
        'ICMP is not available in a browser: each probe times an HTTPS request to https://example.com/favicon.ico',
        'reply from example.com: seq=1 time=20.0 ms (HTTPS round trip)',
        'reply from example.com: seq=2 time=30.0 ms (HTTPS round trip)',
        'reply from example.com: seq=3 time=25.0 ms (HTTPS round trip)',
        '',
        '--- example.com ping statistics ---',
        '3 requests transmitted, 3 received, 0% loss, time 75ms',
        'rtt min/avg/max/mdev = 20.000/25.000/30.000/4.082 ms',
      ].join('\n'),
    );
    // The name over DNS over HTTPS, then no-cors requests past the cache.
    expect(net.hosts()).toEqual(['cloudflare-dns.com', 'example.com', 'example.com', 'example.com']);
    expect(net.requests[1]).toMatchObject({ url: 'https://example.com/favicon.ico', init: { mode: 'no-cors', cache: 'no-store' } });
  });

  it('prints only the header and the summary with -q', async () => {
    const { s } = await rig([10, 10]);
    const { stdoutPlain } = await s.run('ping -q -c 2 -i 0.2 example.com');
    s.stop();
    expect(stdoutPlain).not.toContain('reply from');
    expect(stdoutPlain).toContain('2 requests transmitted, 2 received, 0% loss');
  });

  it('counts a request that times out or cannot be made as lost, and exits 1 when none was answered', async () => {
    const { s } = await rig([], (n, init) => (n === 1 ? hang(init) : Promise.reject(new TypeError('Failed to fetch'))));
    const { status, stdoutPlain } = await s.run('ping -c 2 -i 0.2 -W 0.05 example.com');
    s.stop();
    expect(status).toBe(1);
    expect(stdoutPlain).toContain('no reply from example.com: seq=1 (no answer within 0.05 s)');
    expect(stdoutPlain).toContain('no reply from example.com: seq=2 (unreachable over HTTPS)');
    expect(stdoutPlain).toContain('2 requests transmitted, 0 received, 100% loss');
    expect(stdoutPlain).not.toContain('rtt min/avg/max/mdev');
  });

  it('prints the statistics on ^C, counting the request in flight as lost', async () => {
    const { s, probes } = await rig([12, 18], (n, init) => (n === 3 ? hang(init) : undefined));
    const pending = s.run('ping -c 10 -i 0.2 example.com');
    await vi.waitFor(() => expect(probes()).toBe(3));
    s.app.shell.abort();
    const { status, stdoutPlain } = await pending;
    s.stop();
    expect(status).toBe(130);
    const lines = stdoutPlain.split('\n');
    expect(lines.slice(-5)).toEqual([
      '',
      '--- example.com ping statistics ---',
      '3 requests transmitted, 2 received, 33.3333% loss, time 30ms',
      'rtt min/avg/max/mdev = 12.000/15.000/18.000/3.000 ms',
      '^C',
    ]);
    expect(stdoutPlain.match(/ping statistics/g)).toHaveLength(1);
  });

  it('stops early, with its statistics, before its five minutes run out', async () => {
    const { s } = await rig([200_000, 200_000, 200_000]);
    const { status, stdoutPlain, stderrPlain } = await s.run('ping -c 3 -i 0.2 example.com');
    s.stop();
    expect(status).toBe(0);
    expect(stderrPlain).toBe('ping: stopping here: a command may run for 5 minutes');
    expect(stdoutPlain).toContain('reply from example.com: seq=2 time=200000 ms (HTTPS round trip)');
    expect(stdoutPlain).toContain('2 requests transmitted, 2 received, 0% loss');
  });

  it('pings an address as it is, at its origin', async () => {
    const { s, net } = await rig([42]);
    const { stdoutPlain } = await s.run('ping -c 1 1.1.1.1');
    s.stop();
    expect(stdoutPlain).toContain('PING 1.1.1.1 (1.1.1.1) over HTTPS');
    expect(stdoutPlain).toContain('reply from 1.1.1.1: seq=1 time=42.0 ms (HTTPS round trip)');
    expect(net.requests.map((request) => request.url)).toEqual(['https://1.1.1.1/']);
  });

  it('says when a name does not resolve, as ping does, with status 2', async () => {
    const { s } = await rig([]);
    expect(await s.run('ping nosuchname-vesen-test.com')).toMatchObject({ status: 2, stderrPlain: 'ping: nosuchname-vesen-test.com: Name or service not known' });
    expect(await s.run('ping dnssec-failed.org')).toMatchObject({ status: 2, stderrPlain: 'ping: dnssec-failed.org: Temporary failure in name resolution' });
    expect(await s.run('ping exa_mple..com')).toMatchObject({ status: 2, stderrPlain: 'ping: exa_mple..com: Name or service not known' });
    s.stop();
    vi.stubGlobal('navigator', { onLine: false });
    const offline = await session();
    expect(await offline.run('ping example.com')).toMatchObject({
      status: 2,
      stderrPlain: 'ping: example.com: Temporary failure in name resolution (the browser is offline)',
    });
    offline.stop();
  });

  it('refuses this device and private networks, which a page may not reach', async () => {
    const { s, net } = await rig([]);
    expect(await s.run('ping localhost')).toMatchObject({ status: 2, stderrPlain: 'ping: localhost (127.0.0.1) is this device: a browser tab cannot time a round trip to itself' });
    // /etc/hosts names this machine too.
    expect((await s.run('ping vesen')).stderrPlain).toBe('ping: vesen (127.0.1.1) is this device: a browser tab cannot time a round trip to itself');
    expect(await s.run('ping 192.168.1.1')).toMatchObject({ status: 2, stderrPlain: 'ping: 192.168.1.1 (192.168.1.1) is a private address, which a page on the internet may not reach' });
    s.stop();
    expect(net.requests).toEqual([]);
  });

  it("checks its options as ping does", async () => {
    const { s } = await rig([]);
    expect(await s.run('ping')).toMatchObject({ status: 2, stderrPlain: 'ping: usage error: Destination address required' });
    expect(await s.run('ping -c 0 example.com')).toMatchObject({ status: 2, stderrPlain: "ping: invalid argument: '0': out of range: 1 <= value <= 1000" });
    expect(await s.run('ping -c x example.com')).toMatchObject({ status: 2, stderrPlain: "ping: invalid argument 'x' for '-c'\nTry 'ping --help' for more information." });
    expect(await s.run('ping -i 0.1 example.com')).toMatchObject({ status: 2, stderrPlain: 'ping: cannot flood; minimal interval allowed for user is 200ms' });
    expect(await s.run('ping -W 99 example.com')).toMatchObject({ status: 2, stderrPlain: 'ping: bad linger time: 99' });
    s.stop();
  });
});

describe("ping's statistics", () => {
  it('gives the loss as %g does, and min/avg/max/mdev with mdev the standard deviation', () => {
    expect(statistics('h', { transmitted: 3, received: 2, rtts: [10, 20] }, 2003.6)).toEqual([
      '--- h ping statistics ---',
      '3 requests transmitted, 2 received, 33.3333% loss, time 2004ms',
      'rtt min/avg/max/mdev = 10.000/15.000/20.000/5.000 ms',
    ]);
    expect(statistics('h', { transmitted: 4, received: 1, rtts: [7.5] }, 0)[1]).toBe('4 requests transmitted, 1 received, 75% loss, time 0ms');
    expect(statistics('h', { transmitted: 3, received: 1, rtts: [1] }, 0)[1]).toContain('66.6667% loss');
    expect(statistics('h', { transmitted: 2, received: 0, rtts: [] }, 1000)).toEqual(['--- h ping statistics ---', '2 requests transmitted, 0 received, 100% loss, time 1000ms']);
    expect(statistics('h', { transmitted: 0, received: 0, rtts: [] }, 0)[1]).toBe('0 requests transmitted, 0 received, 0% loss, time 0ms');
    const [, , rtt] = statistics('h', { transmitted: 4, received: 4, rtts: [1, 2, 3, 4] }, 0);
    expect(rtt).toBe('rtt min/avg/max/mdev = 1.000/2.500/4.000/1.118 ms');
  });

  it('prints a round trip to three significant figures, as ping does', () => {
    expect([0.123, 1.234, 23.44, 99.9, 123.4, 1500].map(formatRtt)).toEqual(['0.123', '1.23', '23.4', '99.9', '123', '1500']);
  });
});
