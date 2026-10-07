// traceroute, ssh, telnet, nc and ftp (docs/plan/08 wave D): what a browser tab cannot be, said
// in one line, with status 1, whatever the options, and with no request.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runLine } from '../../../../tests/harness';
import { serveNet } from '../../../../tests/support/net';
import { targetOf } from '../../lib/sandbox';

afterEach(() => vi.unstubAllGlobals());

describe('the commands a browser tab cannot be', () => {
  it.each([
    ['traceroute -n vesen.app', 'traceroute: a browser cannot send packets with a chosen time to live, so there is no route to trace; ping times HTTPS round trips instead'],
    ['ssh -p 2222 guest@vesen.app', 'ssh: connect to host vesen.app port 22: a browser tab cannot open raw TCP connections, so there is no SSH here'],
    ['ssh', 'ssh: a browser tab cannot open raw TCP connections, so there is no SSH here'],
    ['telnet example.com 23', 'telnet: could not connect to example.com: a browser tab cannot open raw TCP connections'],
    ['nc -zv vesen.app 443', 'nc: a browser tab cannot open raw TCP or UDP sockets; curl and wget speak HTTPS'],
    ['netcat -l 8080', 'netcat: a browser tab cannot open raw TCP or UDP sockets; curl and wget speak HTTPS'],
    ['ftp ftp.example.org', 'ftp: a browser cannot speak FTP or open the connections it needs; wget and curl fetch https:// URLs'],
  ])('%s says why not, and exits 1', async (line, message) => {
    const net = serveNet();
    expect(await runLine(line)).toMatchObject({ status: 1, stdoutPlain: '', stderrPlain: message });
    expect(net.requests).toEqual([]);
  });

  it('still answers --help', async () => {
    const { status, stdoutPlain } = await runLine('ssh --help', { tty: false });
    expect(status).toBe(0);
    expect(stdoutPlain).toContain('SSH needs a raw TCP connection, which a browser tab cannot open');
  });

  it('names the host a line gives', () => {
    expect(targetOf(['-p', '22', 'me@host.example'])).toBe('22');
    expect(targetOf(['-p', '22', 'me@host.example'], 'p')).toBe('host.example');
    expect(targetOf(['-v', 'me@host.example'], 'p')).toBe('host.example');
    expect(targetOf(['-v'])).toBeNull();
  });
});
