// privacy and debug (docs/plan/10-tooling-hosting-docs.md, 0.10): what vesen sends where, and a
// report to paste into an issue.
import { describe, expect, it, vi } from 'vitest';
import { runLine, session } from '../../../tests/harness';
import { lineText, type Block } from '../../output/model';
import { legacy } from '../legacy';
import { buildRegistry } from '../index';
import { createAppShell } from '../../app/shell';
import { createScreen } from '../../stores/screen';
import { THIRD_PARTIES } from './privacy.run';

const tableRows = (blocks: readonly Block[]): string[] =>
  blocks.flatMap((block) => (block.type === 'table' ? block.rows.map((row) => lineText(row[0] ?? [])) : []));

describe('privacy', () => {
  it('lists every third party, who asks and what it is sent', async () => {
    const { status, blocks, stdoutPlain } = await runLine('privacy');
    expect(status).toBe(0);
    expect(tableRows(blocks)).toEqual([
      'Open-Meteo',
      'OpenStreetMap Nominatim',
      'GeoJS, then ipinfo.io',
      "vesen's stock Worker",
      'Cloudflare speed test',
      'Cloudflare or Google DNS-over-HTTPS',
      'RDAP (rdap.org and the registries)',
      'GitHub',
      'ipify',
    ]);
    expect(stdoutPlain).toContain('IP address and location lookups happen only on request');
    expect(stdoutPlain).toContain('What you type at sudo is never kept.');
  });

  it('adds what a legacy command still uses, while it is legacy', async () => {
    const stock = legacy('stock', () => '', { category: 'network', summary: 'x' });
    const app = createAppShell({ banner: () => '', specs: [stock], screen: createScreen(), version: 'test' });
    await app.boot();
    const result = await app.shell.run('privacy');
    expect(tableRows(result.blocks)).toContain('allorigins.win, then Yahoo Finance');
    app.stop();
    const without = createAppShell({ banner: () => '', specs: [], screen: createScreen(), version: 'test' });
    await without.boot();
    expect(tableRows((await without.shell.run('privacy')).blocks)).not.toContain('allorigins.win, then Yahoo Finance');
    without.stop();
    // weather is ported: its old source is gone from the table.
    expect(THIRD_PARTIES.filter((row) => row.legacy === true).map((row) => row.commands)).toEqual([['stock']]);
    expect(THIRD_PARTIES.map((row) => row.service).join(' ')).not.toMatch(/wttr/);
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
    expect(chips?.type === 'chips' ? chips.items.map((item) => [item.label, item.action.kind]) : []).toEqual([['⧉ Copy report', 'copy']]);
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
