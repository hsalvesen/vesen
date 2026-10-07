// whois (docs/plan/08 wave D): RDAP through rdap.org, which redirects to the registry, answered
// from recorded fixtures; a domain that is not registered, a TLD with no RDAP service, rate
// limits, unreadable answers, the browser offline, a timeout, and a refused request.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runLine, session } from '../../../../tests/harness';
import { fixture, hang, responseAt, serveNet } from '../../../../tests/support/net';
import { eppStatus, parseRdap } from './whois.run';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('whois', () => {
  it("prints the registrar, dates, status, name servers and DNSSEC, and says it asked over RDAP", async () => {
    const net = serveNet();
    const { status, stdoutPlain } = await runLine('whois example.com', { tty: false });
    expect(status).toBe(0);
    expect(stdoutPlain).toBe(
      [
        "% Asked over RDAP: whois's own port 43 is out of a browser's reach.",
        '% From rdap.verisign.com, found through rdap.org',
        '',
        '   Domain Name: EXAMPLE.COM',
        '   Registry Domain ID: 2336799_DOMAIN_COM-VRSN',
        '   Registrar: RESERVED-Internet Assigned Numbers Authority',
        '   Registrar IANA ID: 376',
        '   Creation Date: 1995-08-14T04:00:00Z',
        '   Updated Date: 2026-08-14T08:01:43Z',
        '   Registry Expiry Date: 2027-08-13T04:00:00Z',
        '   Domain Status: clientDeleteProhibited',
        '   Domain Status: clientTransferProhibited',
        '   Domain Status: clientUpdateProhibited',
        '   Name Server: ELLIOTT.NS.CLOUDFLARE.COM',
        '   Name Server: HERA.NS.CLOUDFLARE.COM',
        '   DNSSEC: signedDelegation',
      ].join('\n'),
    );
    expect(net.requests).toHaveLength(1);
    expect(net.requests[0]).toMatchObject({ url: 'https://rdap.org/domain/example.com', init: { headers: { accept: 'application/rdap+json' } } });
  });

  it('reads another registry the same way', async () => {
    serveNet();
    const { stdoutPlain } = await runLine('whois VESEN.app.', { tty: false });
    expect(stdoutPlain).toContain('% From pubapi.registry.google, found through rdap.org');
    expect(stdoutPlain).toContain('   Registrar: Squarespace Domains II LLC.');
    expect(stdoutPlain).toContain('   Name Server: ns-cloud-c1.googledomains.com');
    expect(stdoutPlain).toContain('   DNSSEC: unsigned');
  });

  it('says when the registry has no such domain, and when no RDAP service covers the TLD', async () => {
    serveNet();
    expect(await runLine('whois nosuchname-vesen-test.com')).toMatchObject({ status: 1, stdoutPlain: 'No match for "NOSUCHNAME-VESEN-TEST.COM".' });
    expect(await runLine('whois example.es')).toMatchObject({ status: 1, stderrPlain: 'whois: no RDAP service for .es' });
  });

  it('says when the registry limits requests or sends something unreadable', async () => {
    serveNet(() => responseAt('https://rdap.verisign.com/com/v1/domain/example.com', '{}', { status: 429 }, true));
    expect(await runLine('whois example.com')).toMatchObject({ status: 1, stderrPlain: 'whois: rdap.verisign.com is limiting requests (HTTP 429); try again in a minute' });
    serveNet(() => responseAt('https://rdap.verisign.com/com/v1/domain/example.com', '<html>', {}, true));
    expect(await runLine('whois example.com')).toMatchObject({ status: 1, stderrPlain: 'whois: rdap.verisign.com sent an answer that could not be read' });
    serveNet(() => responseAt('https://rdap.verisign.com/com/v1/domain/example.com', 'busy', { status: 503 }, true));
    expect((await runLine('whois example.com')).stderrPlain).toBe('whois: rdap.verisign.com: HTTP 503');
  });

  it('says when the browser is offline, the request is refused, or nothing answers', async () => {
    const net = serveNet();
    vi.stubGlobal('navigator', { onLine: false });
    expect(await runLine('whois example.com')).toMatchObject({ status: 1, stderrPlain: 'whois: rdap.org: the browser is offline' });
    expect(net.requests).toEqual([]);
    vi.unstubAllGlobals();

    serveNet(() => Promise.reject(new TypeError('Failed to fetch')));
    expect((await runLine('whois example.com')).stderrPlain).toBe('whois: rdap.org: blocked by CORS or unreachable (the browser does not say which)');

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    serveNet((_url, init) => hang(init));
    const s = await session();
    const pending = s.run('whois example.com');
    await vi.advanceTimersByTimeAsync(8000);
    expect(await pending).toMatchObject({ status: 1, stderrPlain: 'whois: rdap.org: no answer within 8 s' });
    s.stop();
  });

  it('asks only about domain names', async () => {
    const net = serveNet();
    expect(await runLine('whois 192.0.2.1')).toMatchObject({ status: 1, stderrPlain: 'whois: 192.0.2.1: vesen looks up domain names only, such as whois vesen.app' });
    expect(await runLine('whois localhost')).toMatchObject({ status: 1, stderrPlain: "whois: 'localhost' is not a domain name, such as vesen.app" });
    expect(await runLine('whois "a b.com"')).toMatchObject({ status: 1 });
    expect(await runLine('whois')).toMatchObject({ status: 1, stderrPlain: "whois: missing DOMAIN\nTry 'whois --help' for more information." });
    expect(net.requests).toEqual([]);
  });
});

describe('reading RDAP', () => {
  it("turns RDAP's statuses into EPP's, and keeps control characters out", () => {
    expect(['client delete prohibited', 'active', 'pending Delete', 'server transfer prohibited'].map(eppStatus)).toEqual([
      'clientDeleteProhibited',
      'active',
      'pendingDelete',
      'serverTransferProhibited',
    ]);
    const tampered = { ...(fixture('rdap-example.com.json') as Record<string, unknown>), ldhName: 'EVIL\u001b[2J.COM‮' };
    expect(parseRdap(tampered)?.name).toBe('EVIL [2J.COM');
    expect(parseRdap({ objectClassName: 'entity' })).toBeNull();
    expect(parseRdap(null)).toBeNull();
  });
});
