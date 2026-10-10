// privacy and debug (docs/plan/10-tooling-hosting-docs.md, 0.10): what vesen sends where, and a
// report to paste into an issue.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runLine, session } from '../../../tests/harness';
import { lineText, type Block } from '../../output/model';
import { buildRegistry } from '../index';
import { thirdParties } from './privacy.run';

const tableRows = (blocks: readonly Block[]): string[] =>
  blocks.flatMap((block) => (block.type === 'table' ? block.rows.map((row) => lineText(row[0] ?? [])) : []));

describe('privacy', () => {
  // A developer's .env.local may name a stock Worker; each test says which build it is.
  beforeEach(() => vi.stubEnv('VITE_STOCK_API', ''));
  afterEach(() => vi.unstubAllEnvs());

  it('lists the third party of every command this shell has, who asks and what it is sent', async () => {
    const { status, blocks, stdoutPlain } = await runLine('privacy');
    expect(status).toBe(0);
    expect(tableRows(blocks)).toEqual([
      'Open-Meteo',
      'OpenStreetMap Nominatim',
      'GeoJS, then ipinfo.io',
      // No VITE_STOCK_API: the interim proxy, until the stock Worker is deployed.
      'allorigins.win, then Yahoo Finance',
      'Cloudflare speed test',
      // The network commands of the catalogue (wave D).
      'Cloudflare or Google DNS-over-HTTPS',
      'RDAP (rdap.org and the registries)',
      'GitHub',
      'Cloudflare (cdn-cgi/trace)',
      'ipify',
    ]);
    expect(stdoutPlain).toContain('IP address and location lookups happen only on request: weather with no place, ip addr, ifconfig and fastfetch --net.');
    expect(stdoutPlain).toContain('What you type at sudo is never kept.');
    expect(stdoutPlain).toContain('the commits git log showed for 10 (session storage)');
  });

  it('leaves out the services of commands this shell does not have', async () => {
    // Before the catalogue arrives, only the kernel's commands are there to ask.
    const registry = buildRegistry([]);
    const shown = thirdParties().filter((row) => row.commands.some((name) => registry.get(name) !== undefined));
    expect(shown.map((row) => row.service)).not.toContain('GitHub');
    expect(shown.map((row) => row.service)).not.toContain('Cloudflare (cdn-cgi/trace)');
  });

  it("names the stock Worker in a build that has one", async () => {
    vi.stubEnv('VITE_STOCK_API', 'https://stock.example.workers.dev');
    expect(tableRows((await runLine('privacy')).blocks)).toContain("vesen's stock Worker");
  });

  it('says how location and place searches are kept, as weather does', async () => {
    const { stdoutPlain } = await runLine('privacy');
    expect(stdoutPlain).toContain('Only weather --here asks the browser for this device');
    expect(stdoutPlain).toContain('no location is ever saved');
    expect(stdoutPlain).toContain('up to 50 place searches for 30 days');
  });

  it('names no source a ported command has left behind', () => {
    // weather left wttr.in, and stock's interim proxy is the labelled row above until its Worker runs.
    const services = thirdParties().map((row) => row.service).join(' ');
    expect(services).not.toMatch(/wttr/);
    expect(thirdParties().map((row) => row.askedBy).join(' ')).not.toMatch(/for now/);
    expect(buildRegistry([]).get('privacy')).toBeDefined();
  });

  it('is plain text in a pipe', async () => {
    const { stdoutPlain } = await runLine('privacy', { tty: false });
    expect(stdoutPlain).toContain('Open-Meteo');
    expect(stdoutPlain).toContain('No analytics, and no cookies.');
  });
});

describe('debug report', () => {
  it('copies the browser, screen, build and recent errors, and prints them', async () => {
    const copy = vi.fn(async () => true);
    const s = await session({ clipboard: { copy }, inApp: 'instagram', touch: true });
    const { status, stdoutPlain } = await s.run('debug report');
    s.stop();
    expect(status).toBe(0);
    const report = (copy.mock.calls[0] as unknown as [string])[0];
    expect(report.split('\n')[0]).toBe('vesen debug report');
    expect(report).toMatch(/^build: +\S+$/m);
    expect(report).toMatch(/^in-app: +instagram$/m);
    expect(report).toMatch(/^touch: +yes$/m);
    expect(report).toMatch(/^terminal: +80x24$/m);
    expect(report).toMatch(/^crt: +\S+ \(.+\)$/m);
    expect(report).toMatch(/^errors: +none$/m);
    expect(stdoutPlain).toContain('vesen debug report');
    expect(stdoutPlain).toContain('✓ Copied.');
  });

  it('offers a Copy chip when copying needs a tap', async () => {
    const s = await session({ clipboard: { copy: async () => false } });
    const { status, blocks, stdoutPlain } = await s.run('debug report');
    s.stop();
    expect(status).toBe(0);
    expect(stdoutPlain).toContain('Could not copy without a tap here');
    const chips = blocks.find((block) => block.type === 'chips');
    expect(chips?.type === 'chips' ? chips.items.map((item) => [item.label, item.action.kind]) : []).toEqual([['Copy report', 'copy']]);
  });

  it('asks for the subcommand', async () => {
    expect(await runLine('debug')).toMatchObject({ status: 1, stderrPlain: expect.stringContaining("a subcommand is required: 'debug report'") });
    expect(await runLine('debug nope')).toMatchObject({ status: 1, stderrPlain: expect.stringContaining("unknown subcommand 'nope'") });
  });

  it('prints the report alone in a pipe', async () => {
    const { stdoutPlain } = await runLine('debug report', { tty: false });
    expect(stdoutPlain.split('\n')[0]).toBe('vesen debug report');
  });
});
