// fastfetch (F050, F041): the device as the browser describes it, every row labelled for what it
// is, beside its system's logo in a columns block that stacks below 60 columns, with a live WM
// Theme, and no request at all unless --net asks for the public IP.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runLine } from '../../../tests/harness';
import { ANDROID_PHONE, APPLE_SILICON_MAC, IPHONE_SAFARI, WINDOWS_PC, type System } from '../../../tests/support/systems';
import { lineText, textWidth, type Block, type ColumnsBlock, type LinesBlock } from '../../output/model';
import { memo } from '../../services/net';
import { createSysInfo } from '../../services/sysinfo';
import { logoFor } from './fastfetch.logos';
import { fastfetchRows, sizeText, uptimeText, type Facts } from './fastfetch.run';

afterEach(() => {
  vi.unstubAllGlobals();
  memo.clear();
});

/** What fastfetch gathers from a system, as its run does. */
async function factsOf(system: System, extra: Partial<Facts> = {}): Promise<Facts> {
  const sys = createSysInfo(system.host);
  return {
    snapshot: sys.snapshot(),
    hints: await sys.platform(),
    gpu: sys.gpu(),
    battery: await sys.battery(),
    storage: await sys.storage(),
    uptimeMs: sys.uptimeMs(),
    theme: 'swamphen',
    version: '2.0.0',
    timeZone: 'Australia/Sydney',
    ...extra,
  };
}

const rowsOf = async (system: System): Promise<Record<string, string>> =>
  Object.fromEntries(fastfetchRows(await factsOf(system)).map((row) => [row.label, row.value]));

describe('the rows', () => {
  it('words an Apple-silicon Mac, with the real version from the client hints', async () => {
    expect(await rowsOf(APPLE_SILICON_MAC())).toEqual({
      OS: 'macOS Sequoia 15.6 arm64',
      'Host (approximate)': 'MacBook Air (13-inch)',
      Kernel: 'Darwin 24',
      Uptime: '1 min (this page)',
      Shell: 'vesh 2.0.0',
      Display: '2940x1912 (as 1470x956)',
      Terminal: 'vesen',
      'WM Theme': 'swamphen',
      Font: 'Vesen Mono',
      CPU: 'Apple M3 (8)',
      GPU: 'Apple M3',
      'Memory (approximate)': '8 GiB or more',
      'Disk (WebStorage)': '2.00 MiB / 100.00 GiB (0%)',
      Battery: '50% [Discharging]',
      Locale: 'en-AU (Australia/Sydney)',
    });
  });

  it('words a Windows PC: 11, told from 10 by the client hints', async () => {
    expect(await rowsOf(WINDOWS_PC())).toMatchObject({
      OS: 'Windows 11 x86_64',
      'Host (approximate)': 'PC',
      Kernel: 'WIN32_NT 10.0',
      Display: '2560x1440',
      CPU: 'x86_64 (16)',
      GPU: 'NVIDIA GeForce RTX 3080',
      Battery: '100% [AC connected]',
    });
  });

  it('words an Android phone, its version and model from the client hints', async () => {
    const rows = await rowsOf(ANDROID_PHONE());
    expect(rows).toMatchObject({
      OS: 'Android 14',
      'Host (approximate)': 'Pixel 7',
      Kernel: 'Linux',
      Display: '1082x2402 (as 412x915)',
      CPU: '8 cores',
      GPU: 'Mali-G710 MC10',
      'Memory (approximate)': 'about 4 GiB',
      Locale: 'nb-NO (Australia/Sydney)',
    });
    // Nothing it cannot know.
    expect(rows.Battery).toBeUndefined();
    expect(rows['Disk (WebStorage)']).toBeUndefined();
  });

  it('words an iPhone in Safari 26, which says iOS 18.6 in its user agent', async () => {
    expect(await rowsOf(IPHONE_SAFARI())).toMatchObject({
      OS: 'iOS 26.0 arm64',
      'Host (approximate)': 'iPhone',
      Kernel: 'Darwin',
      CPU: 'Apple silicon (6)',
      GPU: 'Apple GPU',
    });
  });

  it('adds the public IP only when it was asked for', async () => {
    const asked = fastfetchRows(await factsOf(WINDOWS_PC(), { publicIp: '203.0.113.7' }));
    expect(asked[asked.length - 1]).toEqual({ label: 'Public IP', value: '203.0.113.7' });
    const failed = fastfetchRows(await factsOf(WINDOWS_PC(), { publicIp: null }));
    expect(failed[failed.length - 1]).toEqual({ label: 'Public IP', value: 'unavailable' });
    expect(fastfetchRows(await factsOf(WINDOWS_PC())).map((row) => row.label)).not.toContain('Public IP');
  });

  it('words uptimes and sizes as fastfetch does', () => {
    expect(uptimeText(42_000)).toBe('42 secs');
    expect(uptimeText(3_723_000)).toBe('1 hour, 2 mins');
    expect(uptimeText(90_061_000)).toBe('1 day, 1 hour, 1 min');
    expect(sizeText(50 * 1024 ** 2)).toBe('50.00 MiB');
    expect(sizeText(1.5 * 1024 ** 3)).toBe('1.50 GiB');
    expect(sizeText(12_000)).toBe('11.72 KiB');
  });
});

describe('fastfetch on the terminal', () => {
  const columnsOf = (blocks: readonly Block[]): ColumnsBlock => {
    const found = blocks.find((block): block is ColumnsBlock => block.type === 'columns');
    if (found === undefined) throw new Error('no columns block');
    return found;
  };

  it('puts the logo on the left and the details on the right, stacked below 60 columns', async () => {
    const { status, blocks } = await runLine('fastfetch', { sys: createSysInfo(APPLE_SILICON_MAC().host) });
    expect(status).toBe(0);
    const columns = columnsOf(blocks);
    expect(columns.stackBelowCols).toBe(60);
    // The details start just past the logo: the apple's widest row, 19 cells.
    expect(columns.leftCh).toBe(19);
    expect(columns.left).toEqual([expect.objectContaining({ type: 'art', alt: 'macOS logo', fit: 'scale' })]);
    const details = columns.right[0] as LinesBlock;
    const text = details.lines.map(lineText);
    expect(text.slice(0, 3)).toEqual(['guest@vesen', '───────────', 'OS: macOS Sequoia 15.6 arm64']);
    expect(text).toContain('WM Theme: swamphen');
  });

  it("names the theme with a live binding, so earlier output follows a theme change", async () => {
    const { blocks } = await runLine('fastfetch', { sys: createSysInfo(WINDOWS_PC().host) });
    const details = columnsOf(blocks).right[0] as LinesBlock;
    const row = details.lines.find((line) => line[0]?.text === 'WM Theme');
    expect(row?.[2]).toEqual({ text: 'swamphen', live: { kind: 'currentThemeName' } });
    expect(columnsOf(blocks).left).toEqual([expect.objectContaining({ alt: 'Windows logo', style: { fg: 'blue', bold: true } })]);
  });

  it('draws every logo in block and quadrant characters, about 20 columns wide and 10 to 13 rows tall', () => {
    const BLOCKS = /^[ ▀-▟]*$/u;
    for (const [os, alt, colour, width, height] of [
      ['macOS', 'macOS logo', 'green', 19, 13],
      ['iOS', 'iOS logo', 'green', 19, 13],
      ['Android', 'Android logo', 'green', 19, 10],
      ['Windows', 'Windows logo', 'blue', 20, 11],
      ['Linux', 'Linux logo', 'yellow', 20, 13],
      ['unknown', 'Linux logo', 'yellow', 20, 13],
    ] as const) {
      const logo = logoFor(os);
      const rows = logo.art.split('\n');
      expect(logo.alt, os).toBe(alt);
      expect(logo.colour, os).toBe(colour);
      expect(rows, os).toHaveLength(height);
      expect(Math.max(...rows.map(textWidth)), os).toBe(width);
      for (const row of rows) expect(row, os).toMatch(BLOCKS);
    }
  });

  it("ends with the theme's sixteen colours as coloured spaces, which a screen reader passes over", async () => {
    const { blocks } = await runLine('fastfetch');
    const lines = (columnsOf(blocks).right[0] as LinesBlock).lines;
    const palette = lines.slice(-2);
    expect(palette.map((line) => line.map((span) => span.style?.bg))).toEqual([
      ['black', 'red', 'green', 'yellow', 'blue', 'purple', 'cyan', 'white'],
      ['brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightPurple', 'brightCyan', 'brightWhite'],
    ]);
    expect(palette.flat().every((span) => span.text.trim() === '')).toBe(true);
  });

  it('works with nothing to read, as in a test: the rows it can be sure of', async () => {
    const { status, stdoutPlain } = await runLine('neofetch');
    expect(status).toBe(0);
    expect(stdoutPlain).toContain('OS: unknown');
    expect(stdoutPlain).toMatch(/^Shell: vesh \d+\.\d+\.\d+$/m);
    expect(stdoutPlain).toContain('WM Theme: swamphen');
  });

  it('refuses an operand', async () => {
    expect(await runLine('fastfetch now')).toMatchObject({ status: 1, stderrPlain: "fastfetch: extra operand 'now'\nTry 'fastfetch --help' for more information." });
  });
});

describe('fastfetch in a pipe', () => {
  it('writes the details alone, a Label: value a line, for grep', async () => {
    const { stdoutPlain } = await runLine('fastfetch', { tty: false, sys: createSysInfo(ANDROID_PHONE().host) });
    const lines = stdoutPlain.split('\n');
    expect(lines.slice(0, 3)).toEqual(['guest@vesen', '───────────', 'OS: Android 14']);
    expect(lines).toContain('Host (approximate): Pixel 7');
    expect(stdoutPlain).not.toContain('MMMM');
  });
});

describe('fastfetch and the network', () => {
  it('asks nothing of the network without --net', async () => {
    const fetchMock = vi.fn(async () => Response.json({ ip: '203.0.113.7' }));
    vi.stubGlobal('fetch', fetchMock);
    await runLine('fastfetch', { sys: createSysInfo(WINDOWS_PC().host) });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('adds the Public IP from api.ipify.org with --net, and says where it came from', async () => {
    const fetchMock = vi.fn(async () => Response.json({ ip: '203.0.113.7' }));
    vi.stubGlobal('fetch', fetchMock);
    const { status, stdoutPlain } = await runLine('fastfetch --net', { sys: createSysInfo(WINDOWS_PC().host) });
    expect(status).toBe(0);
    expect(stdoutPlain).toContain('Public IP: 203.0.113.7');
    expect(stdoutPlain).toContain('Public IP from api.ipify.org, asked because of --net.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
