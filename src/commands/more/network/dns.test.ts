// dig, host and nslookup (docs/plan/08 wave D): DNS over HTTPS to Cloudflare, then Google,
// answered from the recorded fixtures in tests/fixtures/net, with NXDOMAIN, SERVFAIL, a resolver
// that times out, one that fails, the browser offline, and a request the browser refuses.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runLine, session } from '../../../../tests/harness';
import { doh, hang, json, serveNet } from '../../../../tests/support/net';
import { createNet } from '../../../services/net';
import { DnsUnreachable, addressScope, ask, caaData, ipVersion, isPrivateAddress, parseDoh, reverseName, shown, txtData, RR_TYPES } from '../../lib/dns';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** The TTL the recorded answer gives its first record. */
const ttl = (body: Record<string, unknown>): number => ((body.Answer as { TTL: number }[])[0] ?? { TTL: 0 }).TTL;

describe('dig', () => {
  it("prints dig's sections for an answer from Cloudflare, and says it came over HTTPS", async () => {
    const net = serveNet();
    const { status, stdoutPlain, stderrPlain } = await runLine('dig example.com');
    expect(status).toBe(0);
    expect(stderrPlain).toBe('');
    const recorded = doh('cloudflare-dns.com', 'example.com', 'A');
    const lines = stdoutPlain.split('\n');
    expect(lines.slice(0, 6)).toEqual([
      '',
      '; <<>> dig <<>> example.com',
      ';; global options: +cmd',
      ';; Got answer:',
      ';; ->>HEADER<<- opcode: QUERY, status: NOERROR, id: 0',
      ';; flags: qr rd ra ad; QUERY: 1, ANSWER: 2, AUTHORITY: 0, ADDITIONAL: 0',
    ]);
    expect(lines).toContain(';; QUESTION SECTION:');
    expect(lines).toContain(';example.com.\t\t\tIN\tA');
    expect(lines).toContain(';; ANSWER SECTION:');
    expect(lines).toContain(`example.com.\t\t${ttl(recorded)}\tIN\tA\t172.66.147.243`);
    expect(lines).toContain(`example.com.\t\t${ttl(recorded)}\tIN\tA\t104.20.23.154`);
    expect(lines).toContain(';; SERVER: cloudflare-dns.com#443(cloudflare-dns.com) (HTTPS)');
    expect(lines).toContain(';; WHEN: Tue Oct 06 20:01:00 AEDT 2026');
    expect(lines).toContain(';; via DNS over HTTPS (Cloudflare)');
    expect(lines.some((line) => /^;; Query time: \d+ msec$/.test(line))).toBe(true);
    // One question, to Cloudflare's JSON endpoint, with the header it asks for.
    expect(net.requests).toHaveLength(1);
    expect(net.requests[0]?.url).toBe('https://cloudflare-dns.com/dns-query?name=example.com&type=1');
    expect(net.requests[0]?.init.headers).toEqual({ accept: 'application/dns-json' });
  });

  it('prints only the answers with +short, CNAMEs included, and only the answer section with +noall +answer', async () => {
    serveNet();
    expect(await runLine('dig +short www.github.com')).toMatchObject({ status: 0, stdoutPlain: 'github.com.\n4.237.22.38' });
    const caa = await runLine('dig +noall +answer letsencrypt.org CAA', { tty: false });
    const rows = caa.stdoutPlain.split('\n');
    expect(rows).toHaveLength(12);
    expect(rows.every((row) => /^letsencrypt\.org\.\t\d+\tIN\tCAA\t0 issue(wild)? "[a-z.]+"$/.test(row))).toBe(true);
    expect(rows).toContain('letsencrypt.org.\t300\tIN\tCAA\t0 issue "letsencrypt.org"');
  });

  it('takes the type as a word or with -t, and quotes TXT strings as dig does', async () => {
    serveNet();
    const txt = '"v=spf1 -all"\n"_k2n1y4vw3qtb4skdx9e7dxt97qrmmq9"';
    expect((await runLine('dig example.com TXT +short')).stdoutPlain).toBe(txt);
    expect((await runLine('dig -t txt example.com +short')).stdoutPlain).toBe(txt);
    // Google gives TXT strings bare; dig shows them quoted all the same.
    expect((await runLine('dig @google example.com TXT +short')).stdoutPlain).toBe('"_k2n1y4vw3qtb4skdx9e7dxt97qrmmq9"\n"v=spf1 -all"');
  });

  it('asks for ANY, and shows what each resolver makes of it: NOTIMP, or the RFC 8482 stand-in', async () => {
    const net = serveNet();
    const cloudflare = await runLine('dig example.com ANY', { tty: false });
    expect(cloudflare.status).toBe(0);
    const rows = cloudflare.stdoutPlain.split('\n');
    expect(rows).toContain(';; ->>HEADER<<- opcode: QUERY, status: NOTIMP, id: 0');
    expect(rows).toContain('; EDE(21): Not Supported');
    expect(rows).toContain(';example.com.\t\t\tIN\tANY');
    // The type may come first, and * is ANY too; Google answers with HINFO and its signature.
    const google = await runLine('dig @google ANY example.com +noall +answer', { tty: false });
    expect(google.stdoutPlain.split('\n')[0]).toBe('example.com.\t\t3600\tIN\tHINFO\tRFC8482 ');
    expect(google.stdoutPlain.split('\n')[1]).toMatch(/^example\.com\.\t\t3600\tIN\tRRSIG\thinfo 13 2 3600 /);
    await runLine("dig example.com '*' +short", { tty: false });
    expect(net.requests.map((request) => request.url)).toEqual([
      'https://cloudflare-dns.com/dns-query?name=example.com&type=255',
      'https://dns.google/resolve?name=example.com&type=255',
      'https://cloudflare-dns.com/dns-query?name=example.com&type=255',
    ]);
    // host and nslookup ask the same, and say NOTIMP in their own words.
    expect(await runLine('host -t ANY example.com', { tty: false })).toMatchObject({ status: 1, stderrPlain: 'Host example.com not found: 4(NOTIMP)' });
    expect((await runLine('nslookup -type=any example.com', { tty: false })).stdoutPlain).toContain("** server can't find example.com: NOTIMP");
  });

  it('knows every type IANA has named, and TYPEn, so none is taken for a host; zone transfers it refuses', async () => {
    const naptr = { Status: 0, Question: [{ name: 'example.com', type: 35 }], Answer: [{ name: 'example.com', type: 35, TTL: 60, data: '100 10 "u" "E2U+sip" "!^.*$!sip:info@example.com!" .' }] };
    const net = serveNet((url) => (url.searchParams.get('type') === '35' || url.searchParams.get('type') === '99' ? json(naptr) : undefined));
    expect(await runLine('dig example.com naptr +short', { tty: false })).toMatchObject({ status: 0, stdoutPlain: '100 10 "u" "E2U+sip" "!^.*$!sip:info@example.com!" .' });
    expect((await runLine('dig -t TYPE99 example.com +short', { tty: false })).status).toBe(0);
    expect((await runLine('nslookup -type=NAPTR example.com', { tty: false })).status).toBe(0);
    expect(net.requests.map((request) => request.url)).toEqual([
      'https://cloudflare-dns.com/dns-query?name=example.com&type=35',
      'https://cloudflare-dns.com/dns-query?name=example.com&type=99',
      'https://cloudflare-dns.com/dns-query?name=example.com&type=35',
    ]);
    const transfer = "AXFR is a zone transfer, which needs a TCP connection to the zone's own name server: a browser cannot make one";
    expect(await runLine('dig example.com AXFR', { tty: false })).toMatchObject({ status: 1, stderrPlain: `dig: ${transfer}\nTry 'dig --help' for more information.` });
    expect((await runLine('dig -t ixfr example.com', { tty: false })).stderrPlain).toContain('dig: IXFR is a zone transfer');
    expect(await runLine('host -t AXFR example.com', { tty: false })).toMatchObject({ status: 1, stderrPlain: `host: ${transfer}` });
    expect(net.requests).toHaveLength(3);
  });

  it('looks an address up in reverse with -x', async () => {
    const net = serveNet();
    expect(await runLine('dig -x 1.1.1.1 +short')).toMatchObject({ status: 0, stdoutPlain: 'one.one.one.one.' });
    expect(net.requests[0]?.url).toBe('https://cloudflare-dns.com/dns-query?name=1.1.1.1.in-addr.arpa&type=12');
    expect(await runLine('dig -x 300.1.1.1')).toMatchObject({ status: 1, stderrPlain: "dig: '300.1.1.1' is not an IP address\nTry 'dig --help' for more information." });
  });

  it('asks for the root name servers with no name', async () => {
    const net = serveNet();
    const { status, stdoutPlain } = await runLine('dig +short');
    expect(status).toBe(0);
    expect(stdoutPlain.split('\n')).toHaveLength(13);
    expect(net.requests[0]?.url).toBe('https://cloudflare-dns.com/dns-query?name=.&type=2');
  });

  it('shows NXDOMAIN and SERVFAIL as answers, with status 0, and asks no one else', async () => {
    const net = serveNet();
    const missing = await runLine('dig nosuchname-vesen-test.com');
    expect(missing.status).toBe(0);
    expect(missing.stdoutPlain).toContain(';; ->>HEADER<<- opcode: QUERY, status: NXDOMAIN, id: 0');
    expect(missing.stdoutPlain).toContain(';; AUTHORITY SECTION:\ncom.\t\t\t900\tIN\tSOA\ta.gtld-servers.net. nstld.verisign-grs.com.');
    const broken = await runLine('dig dnssec-failed.org');
    expect(broken.status).toBe(0);
    expect(broken.stdoutPlain).toContain('status: SERVFAIL');
    // Cloudflare's extended error says why.
    expect(broken.stdoutPlain).toContain('; EDE(9): DNSKEY Missing no SEP matching the DS found for dnssec-failed.org.');
    expect(net.hosts()).toEqual(['cloudflare-dns.com', 'cloudflare-dns.com']);
  });

  it("asks Google when Cloudflare fails, and says which answered", async () => {
    const net = serveNet((url) => (url.host === 'cloudflare-dns.com' ? new Response('busy', { status: 503 }) : undefined));
    const { status, stdoutPlain, stderrPlain } = await runLine('dig example.com');
    expect(status).toBe(0);
    expect(stderrPlain).toBe(';; communications error to cloudflare-dns.com#443(cloudflare-dns.com): HTTP 503');
    expect(stdoutPlain).toContain(';; SERVER: dns.google#443(dns.google) (HTTPS)');
    expect(stdoutPlain).toContain(';; via DNS over HTTPS (Google, after Cloudflare failed)');
    expect(net.requests.map((request) => request.url)).toEqual([
      'https://cloudflare-dns.com/dns-query?name=example.com&type=1',
      'https://dns.google/resolve?name=example.com&type=1',
    ]);
  });

  it('asks only the resolver named with @, and refuses one a browser cannot reach', async () => {
    const net = serveNet();
    expect((await runLine('dig @8.8.8.8 example.com MX +short')).stdoutPlain).toBe('0 .');
    expect(net.hosts()).toEqual(['dns.google']);
    expect(await runLine('dig @9.9.9.9 example.com')).toMatchObject({
      status: 1,
      stderrPlain: "dig: 9.9.9.9: a browser can ask only @cloudflare or @google, over HTTPS\nTry 'dig --help' for more information.",
    });
    expect((await runLine('dig +bogus example.com')).stderrPlain).toBe("dig: invalid query option: +bogus\nTry 'dig --help' for more information.");
  });

  it('exits 9 when both resolvers time out', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    serveNet((url, init) => (url.host.includes('dns') ? hang(init) : undefined));
    const s = await session();
    const pending = s.run('dig example.com');
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(5000);
    const { status, stdoutPlain, stderrPlain } = await pending;
    s.stop();
    expect(status).toBe(9);
    expect(stdoutPlain).toBe('');
    expect(stderrPlain).toBe(
      [
        ';; communications error to cloudflare-dns.com#443(cloudflare-dns.com): timed out',
        ';; communications error to dns.google#443(dns.google): timed out',
        ';; no servers could be reached',
      ].join('\n'),
    );
  });

  it('exits 9 at once when the browser is offline, asking nothing', async () => {
    const net = serveNet();
    vi.stubGlobal('navigator', { onLine: false });
    expect(await runLine('dig example.com')).toMatchObject({ status: 9, stderrPlain: ';; the browser is offline; no servers could be reached' });
    expect(net.requests).toEqual([]);
  });

  it('calls a request the browser refuses (CORS, or the network) unreachable', async () => {
    serveNet((url) => (url.host.includes('dns') ? Promise.reject(new TypeError('Failed to fetch')) : undefined));
    const { status, stderrPlain } = await runLine('dig +short example.com');
    expect(status).toBe(9);
    expect(stderrPlain).toContain(';; communications error to cloudflare-dns.com#443(cloudflare-dns.com): unreachable');
    expect(stderrPlain).toContain(';; communications error to dns.google#443(dns.google): unreachable');
  });

  it('answers localhost here without asking (RFC 6761), and says so', async () => {
    const net = serveNet();
    expect(await runLine('dig localhost +short')).toMatchObject({ status: 0, stdoutPlain: '127.0.0.1' });
    const full = await runLine('dig sub.localhost AAAA');
    expect(full.stdoutPlain).toContain('sub.localhost.\t\t0\tIN\tAAAA\t::1');
    expect(full.stdoutPlain).toContain(';; answered here: localhost is this device (RFC 6761), so nothing was asked');
    expect(full.stdoutPlain).not.toContain(';; SERVER:');
    expect(net.requests).toEqual([]);
  });

  it('keeps an answer for its TTL: the second ask is from memory, its TTLs counted down', async () => {
    const net = serveNet();
    const s = await session();
    await s.run('dig example.com');
    // The harness's clock moves a minute between lines.
    const again = await s.run('dig +noall +answer +stats example.com');
    s.stop();
    const recorded = ttl(doh('cloudflare-dns.com', 'example.com', 'A'));
    expect(again.stdoutPlain).toContain(`example.com.\t\t${recorded - 60}\tIN\tA\t172.66.147.243`);
    expect(again.stdoutPlain).toContain(';; Query time: 0 msec');
    expect(again.stdoutPlain).toContain(';; via DNS over HTTPS (Cloudflare), kept from an earlier answer');
    expect(net.requests).toHaveLength(1);
  });

  it("keeps Google's answer when Cloudflare failed, so the next ask waits on neither", async () => {
    const net = serveNet((url) => (url.host === 'cloudflare-dns.com' ? new Response('busy', { status: 503 }) : undefined));
    const s = await session();
    await s.run('dig example.com');
    const again = await s.run('dig +short example.com');
    s.stop();
    expect(again).toMatchObject({ status: 0, stdoutPlain: '172.66.147.243\n104.20.23.154', stderrPlain: '' });
    expect(net.hosts()).toEqual(['cloudflare-dns.com', 'dns.google']);
  });

  it('never lets an answer write escape sequences to the terminal', async () => {
    serveNet((url) =>
      url.host === 'cloudflare-dns.com'
        ? json({ Status: 0, Question: [{ name: 'evil.example', type: 16 }], Answer: [{ name: 'evil.example', type: 16, TTL: 60, data: '"\u001b[2J\u001b]8;;https://x\u0007hi‮"' }] })
        : undefined,
    );
    const { stdoutPlain } = await runLine('dig +short evil.example TXT');
    expect(stdoutPlain).toBe('"\\027[2J\\027]8;;https://x\\007hi�"');
  });
});

describe('host', () => {
  it("gives a name's addresses and mail servers in host's sentences", async () => {
    serveNet();
    const { status, stdoutPlain, stderrPlain } = await runLine('host vesen.app');
    expect(status).toBe(0);
    expect(stdoutPlain).toBe(['vesen.app has address 199.36.158.100', 'vesen.app mail is handled by 10 mxb.mailgun.org.', 'vesen.app mail is handled by 10 mxa.mailgun.org.'].join('\n'));
    expect(stderrPlain).toBe(';; via DNS over HTTPS (Cloudflare)');
    // In a pipe, only host's own lines.
    expect((await runLine('host vesen.app', { tty: false })).stderrPlain).toBe('');
  });

  it('says an alias once, then follows it', async () => {
    serveNet();
    const { stdoutPlain } = await runLine('host www.github.com', { tty: false });
    expect(stdoutPlain).toBe(['www.github.com is an alias for github.com.', 'github.com has address 4.237.22.38', 'github.com mail is handled by 0 github-com.mail.protection.outlook.com.'].join('\n'));
  });

  it('asks for one type with -t, says when there is none, and looks addresses up in reverse', async () => {
    serveNet();
    expect((await runLine('host -t TXT example.com', { tty: false })).stdoutPlain).toBe(
      'example.com descriptive text "v=spf1 -all"\nexample.com descriptive text "_k2n1y4vw3qtb4skdx9e7dxt97qrmmq9"',
    );
    expect((await runLine('host -t CAA example.com', { tty: false })).stdoutPlain).toBe('example.com has no CAA record');
    expect((await runLine('host 1.1.1.1', { tty: false })).stdoutPlain).toBe('1.1.1.1.in-addr.arpa domain name pointer one.one.one.one.');
  });

  it('exits 1 for NXDOMAIN and SERVFAIL, in its own words', async () => {
    serveNet();
    expect(await runLine('host nosuchname-vesen-test.com')).toMatchObject({ status: 1, stdoutPlain: '', stderrPlain: 'Host nosuchname-vesen-test.com not found: 3(NXDOMAIN)' });
    expect(await runLine('host dnssec-failed.org')).toMatchObject({ status: 1, stderrPlain: 'Host dnssec-failed.org not found: 2(SERVFAIL)' });
  });

  it('names the server it was given, and exits 1 when no resolver can be reached', async () => {
    serveNet();
    const google = await runLine('host -t MX example.com google', { tty: false });
    expect(google.stdoutPlain).toBe('Using domain server:\nName: dns.google\nAddress: https://dns.google/resolve (DNS over HTTPS)\nAliases: \n\nexample.com mail is handled by 0 .');
    vi.stubGlobal('navigator', { onLine: false });
    expect(await runLine('host vesen.app')).toMatchObject({ status: 1, stderrPlain: ';; the browser is offline; no servers could be reached' });
  });
});

describe('nslookup', () => {
  it("prints the server, then the addresses, in nslookup's layout", async () => {
    serveNet();
    const { status, stdoutPlain } = await runLine('nslookup example.com', { tty: false });
    expect(status).toBe(0);
    expect(stdoutPlain).toBe(
      [
        'Server:\t\tcloudflare-dns.com',
        'Address:\thttps://cloudflare-dns.com/dns-query (DNS over HTTPS)',
        '',
        'Non-authoritative answer:',
        'Name:\texample.com',
        'Address: 172.66.147.243',
        'Name:\texample.com',
        'Address: 104.20.23.154',
        'Name:\texample.com',
        'Address: 2606:4700:10::6814:179a',
        'Name:\texample.com',
        'Address: 2606:4700:10::ac42:93f3',
        // nslookup ends with a blank line.
        '',
      ].join('\n'),
    );
  });

  it('takes -type=TYPE, follows a CNAME, and lays out an SOA record', async () => {
    serveNet();
    expect((await runLine('nslookup -type=MX vesen.app', { tty: false })).stdoutPlain).toContain('vesen.app\tmail exchanger = 10 mxa.mailgun.org.');
    expect((await runLine('nslookup -query=mx vesen.app', { tty: false })).stdoutPlain).toContain('vesen.app\tmail exchanger = 10 mxb.mailgun.org.');
    const alias = await runLine('nslookup www.github.com', { tty: false });
    expect(alias.stdoutPlain).toContain('www.github.com\tcanonical name = github.com.\nName:\tgithub.com\nAddress: 4.237.22.38');
    const soa = await runLine('nslookup -type=soa example.com', { tty: false });
    expect(soa.stdoutPlain).toContain('example.com\n\torigin = elliott.ns.cloudflare.com.\n\tmail addr = dns.cloudflare.com.\n\tserial = ');
  });

  it("says NXDOMAIN and SERVFAIL as nslookup does, and exits 1", async () => {
    serveNet();
    const missing = await runLine('nslookup nosuchname-vesen-test.com', { tty: false });
    expect(missing.status).toBe(1);
    expect(missing.stdoutPlain).toContain("** server can't find nosuchname-vesen-test.com: NXDOMAIN");
    expect((await runLine('nslookup dnssec-failed.org', { tty: false })).stdoutPlain).toContain("** server can't find dnssec-failed.org: SERVFAIL");
    expect(await runLine('nslookup -type=CAA example.com', { tty: false })).toMatchObject({ status: 0, stdoutPlain: expect.stringContaining("*** Can't find example.com: No answer") });
  });

  it('exits 1 when no resolver can be reached: offline, refused, or silent', async () => {
    serveNet((url) => (url.host.includes('dns') ? Promise.reject(new TypeError('Failed to fetch')) : undefined));
    expect(await runLine('nslookup vesen.app')).toMatchObject({
      status: 1,
      stdoutPlain: '',
      stderrPlain: [
        ';; communications error to cloudflare-dns.com#443(cloudflare-dns.com): unreachable',
        ';; communications error to dns.google#443(dns.google): unreachable',
        ';; no servers could be reached',
      ].join('\n'),
    });
    vi.stubGlobal('navigator', { onLine: false });
    expect(await runLine('nslookup vesen.app')).toMatchObject({ status: 1, stderrPlain: ';; the browser is offline; no servers could be reached' });
    vi.unstubAllGlobals();

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    serveNet((url, init) => (url.host.includes('dns') ? hang(init) : undefined));
    const s = await session();
    const pending = s.run('host vesen.app');
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toMatchObject({ status: 1, stderrPlain: expect.stringContaining('dns.google#443(dns.google): timed out\n;; no servers could be reached') });
    s.stop();
  });

  it('asks the server named, looks addresses up in reverse, and has no interactive mode', async () => {
    const net = serveNet();
    expect((await runLine('nslookup 1.1.1.1', { tty: false })).stdoutPlain).toContain('1.1.1.1.in-addr.arpa\tname = one.one.one.one.');
    expect((await runLine('nslookup -type=TXT example.com dns.google', { tty: false })).stdoutPlain).toContain('Server:\t\tdns.google');
    expect(net.hosts()).toEqual(['cloudflare-dns.com', 'dns.google']);
    expect(await runLine('nslookup')).toMatchObject({
      status: 1,
      stderrPlain: 'nslookup: interactive mode is not supported here; give the name on the line: nslookup vesen.app',
    });
    expect((await runLine('nslookup -type=BOGUS example.com')).stderrPlain).toBe('nslookup: unknown query type: BOGUS');
  });
});

describe('the DNS library', () => {
  it('reads both resolvers\' JSON, trailing dots or not', () => {
    const google = parseDoh(doh('dns.google', 'example.com', 'MX'));
    const cloudflare = parseDoh(doh('cloudflare-dns.com', 'example.com', 'MX'));
    expect(google.answer[0]).toMatchObject({ name: 'example.com', type: 15, data: '0 .' });
    expect(cloudflare.answer[0]).toMatchObject({ name: 'example.com', type: 15, data: '0 .' });
    expect(google.comments).toEqual([expect.stringMatching(/^Response from /)]);
    expect(() => parseDoh({ Answer: [] })).toThrow();
    expect(() => parseDoh('nope')).toThrow();
  });

  it('makes reverse names for IPv4 and IPv6, and knows private addresses', () => {
    expect(reverseName('192.0.2.1')).toBe('1.2.0.192.in-addr.arpa');
    expect(reverseName('2001:db8::1')).toBe(`1.${'0.'.repeat(23)}8.b.d.0.1.0.0.2.ip6.arpa`);
    expect(reverseName('::ffff:192.0.2.1')).toBe(reverseName('0:0:0:0:0:ffff:c000:201'));
    expect(reverseName('example.com')).toBeNull();
    expect(['1.2.3.4', '::1', '1::2::3', '12345::', 'fe80::1'].map(ipVersion)).toEqual([4, 6, null, null, 6]);
    expect(['10.0.0.1', '172.20.1.1', '192.168.1.1', '127.0.0.1', '169.254.0.1', '::1', 'fd00::1', 'fe80::1'].every(isPrivateAddress)).toBe(true);
    expect(['1.1.1.1', '172.32.0.1', '2606:4700::1111'].some(isPrivateAddress)).toBe(false);
  });

  // Before, an IPv4 address inside an IPv6 one (::ffff:192.168.1.1) was judged as IPv6, which
  // let it through, and multicast and reserved ranges were not known at all.
  it.each([
    ['127.0.0.1', 'this device'],
    ['0.0.0.0', 'this device'],
    ['::', 'this device'],
    ['::1', 'this device'],
    ['::ffff:127.0.0.1', 'this device'],
    ['::ffff:7f00:1', 'this device'],
    ['::127.0.0.1', 'this device'],
    ['::ffff:192.168.1.1', 'private'],
    ['0:0:0:0:0:ffff:c0a8:101', 'private'],
    ['::ffff:0:10.0.0.1', 'private'],
    ['::10.1.2.3', 'private'],
    ['::ffff:100.64.0.1', 'private'],
    ['::ffff:169.254.169.254', 'private'],
    ['::ffff:172.16.0.1', 'private'],
    ['64:ff9b::192.168.1.1', 'private'],
    ['2002:c0a8:101::1', 'private'],
    ['100.64.0.1', 'private'],
    ['100.127.255.255', 'private'],
    ['fc00::1', 'private'],
    ['fd12:3456::1', 'private'],
    ['fe80::1', 'private'],
    ['febf::1', 'private'],
    ['fec0::1', 'private'],
    ['224.0.0.1', 'multicast'],
    ['239.255.255.250', 'multicast'],
    ['::ffff:224.0.0.251', 'multicast'],
    ['ff02::1', 'multicast'],
    ['ff05::fb', 'multicast'],
    ['240.0.0.1', 'reserved'],
    ['255.255.255.255', 'reserved'],
    ['::ffff:255.255.255.255', 'reserved'],
  ])('knows %s as %s', (address, scope) => {
    expect(addressScope(address)).toBe(scope);
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each(['1.1.1.1', '8.8.8.8', '100.63.255.255', '100.128.0.1', '172.32.0.1', '223.255.255.255', '2606:4700::1111', '::ffff:1.1.1.1', '64:ff9b::1.1.1.1', '2002:101:101::1', 'fbff::1', 'ff:1::1', 'example.com'])(
    'lets %s through',
    (address) => {
      expect(addressScope(address)).toBeNull();
      expect(isPrivateAddress(address)).toBe(false);
    },
  );

  it('shows TXT and CAA data as dig does, and escapes controls', () => {
    expect(txtData('v=spf1 -all')).toBe('"v=spf1 -all"');
    expect(txtData('"quoted"')).toBe('"quoted"');
    // The generic form (RFC 3597) some resolvers give for CAA.
    expect(caaData('\\# 21 00 05 69 73 73 75 65 6c 65 74 73 65 6e 63 72 79 70 74 2e 6f 72 67')).toBe('0 issue "letsencrypt.org"');
    expect(shown('a\u0000b\u001bc⁦d')).toBe('a\\000b\\027c�d');
  });

  it('times each resolver out on its own, and stops at once on ^C', async () => {
    serveNet((_url, init) => hang(init));
    const net = createNet();
    const deps = { net, clock: { now: () => Date.now() } };
    const failed = await ask(deps, 'example.com', RR_TYPES.A, { timeoutMs: 20 }).catch((error: unknown) => error);
    expect(failed).toBeInstanceOf(DnsUnreachable);
    expect((failed as DnsUnreachable).failures.map((failure) => [failure.resolver.name, failure.reason])).toEqual([
      ['cloudflare', 'timed out'],
      ['google', 'timed out'],
    ]);
    const stop = new AbortController();
    const asking = ask({ ...deps, signal: stop.signal }, 'example.com', RR_TYPES.A);
    stop.abort();
    await expect(asking).rejects.toMatchObject({ kind: 'abort' });
  });
});
