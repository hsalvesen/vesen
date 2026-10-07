import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { lineText, type Block } from '../output/model';
import { harness } from '../testing/shell-harness';
import { CommandRegistry } from '../shell/registry';
import { takesRawArgs } from '../shell/flags';
import { buildRegistry } from './index';
import { legacy, legacyStatus, type LegacyFn } from './legacy';

afterEach(() => {
  vi.useRealTimers();
});

const texts = (blocks: readonly Block[]): string[] =>
  blocks.flatMap((block) => (block.type === 'lines' ? block.lines.map(lineText) : block.type === 'legacyHtml' ? [`<html>${block.html}`] : []));

describe('legacyStatus', () => {
  it('reads the legacy error styles as a failure', () => {
    expect(legacyStatus('<span class="out-error">cat: x: No such file or directory</span>')).toBe(1);
    expect(legacyStatus('<span style="color: var(--role-error);">no</span>')).toBe(1);
    expect(legacyStatus('<span style="color: var(--theme-red); font-weight: bold;">qr: Failed to generate QR code</span>')).toBe(1);
    expect(legacyStatus('<div class="out-panel tone-error">x</div>')).toBe(1);
  });

  it('reads only the markup the legacy code puts first, never the text it shows', () => {
    // qr echoes its input, and curl prints a page: neither decides the status.
    expect(legacyStatus("rm: cannot remove 'x': No such file or directory")).toBe(0);
    expect(legacyStatus('QR Code <span>cannot</span>')).toBe(0);
    expect(legacyStatus('<span style="color: var(--theme-cyan);">QR Code</span> <span>not found</span>')).toBe(0);
    expect(legacyStatus('<pre>&lt;span class="out-error"&gt;</pre> <span class="out-error">late</span>')).toBe(0);
    expect(legacyStatus('body { color: var(--role-error) }')).toBe(0);
  });

  it('does not read colourful success as failure', () => {
    expect(legacyStatus('ok')).toBe(0);
    expect(legacyStatus('')).toBe(0);
    expect(legacyStatus('<span style="color: var(--theme-cyan);">a</span> <span style="color: var(--theme-red);">-1.2%</span>')).toBe(0);
    expect(legacyStatus('line one\nthis cannot be a failure')).toBe(0);
  });
});

describe('the adapter', () => {
  it('passes the words through unparsed, and draws the HTML as a legacyHtml block on the screen', async () => {
    const seen: string[][] = [];
    const fn: LegacyFn = (args) => {
      seen.push(args);
      return `<b>${args.join(' ')}</b>`;
    };
    const { run } = harness({ specs: [legacy('old', fn, { category: 'files', summary: 'x' })] });
    const result = await run('old -rf "a b" --weird');
    expect(seen).toEqual([['-rf', 'a b', '--weird']]);
    expect(result.status).toBe(0);
    expect(result.blocks).toEqual([{ type: 'legacyHtml', html: '<b>-rf a b --weird</b>' }]);
  });

  it('turns the HTML into text in a pipe or a file', async () => {
    const { run, fs } = harness({ specs: [legacy('old', () => 'a<br>b&amp;c', { category: 'files', summary: 'x' })] });
    expect((await run('old | cat')).stdout).toBe('a\nb&c');
    await run('old > out.txt');
    expect(fs.readFile('/home/guest/out.txt')).toBe('a\nb&c\n');
  });

  it('reports a legacy error with status 1 on stderr, so 2>/dev/null hides it and && stops', async () => {
    const { run } = harness({
      specs: [legacy('old', () => '<span class="out-error">old: nope: No such file or directory</span>', { category: 'files', summary: 'x' })],
    });
    expect((await run('old && echo next')).status).toBe(1);
    expect(texts((await run('old')).blocks)).toEqual(['<html><span class="out-error">old: nope: No such file or directory</span>']);
    expect(await run('old 2>/dev/null || echo missing')).toMatchObject({ status: 0, stdout: 'missing' });
  });

  it('shows the legacy help for --help, and for -h first', async () => {
    const fn = vi.fn((args: string[]) => args.join(' '));
    const { run } = harness({ specs: [legacy('old', fn, { category: 'files', summary: 'x', help: '<div>old help</div>' })] });
    expect((await run('old x --help')).blocks).toEqual([{ type: 'legacyHtml', html: '<div>old help</div>' }]);
    expect((await run('old -h')).blocks).toEqual([{ type: 'legacyHtml', html: '<div>old help</div>' }]);
    expect(fn).not.toHaveBeenCalled();
    // F032: echo say -h says it.
    expect((await run('old say -h')).blocks).toEqual([{ type: 'legacyHtml', html: 'say -h' }]);
  });

  it('links its signal to ^C', async () => {
    let signal: AbortSignal | undefined;
    const fn: LegacyFn = (_args, given) => {
      signal = given;
      return new Promise(() => {});
    };
    const { shell } = harness({ specs: [legacy('old', fn, { category: 'files', summary: 'x' })] });
    const handle = shell.start('old');
    await vi.waitFor(() => expect(signal).toBeDefined());
    handle.abort();
    expect((await handle.done).status).toBe(130);
    expect(signal?.aborted).toBe(true);
  });

  it('gives a network command the budget, and says when it ran out', async () => {
    vi.useFakeTimers();
    const fn: LegacyFn = (_args, signal) =>
      new Promise((resolve) => signal?.addEventListener('abort', () => resolve('<div class="out-panel tone-warn">Request cancelled</div>')));
    const { shell } = harness({ specs: [legacy('weather', fn, { category: 'network', summary: 'x', network: true, budgetMs: 25_000 })] });
    const done = shell.run('weather Oslo');
    await vi.advanceTimersByTimeAsync(25_000);
    const result = await done;
    expect(result.status).toBe(124);
    expect(texts(result.blocks)).toEqual(['weather: timed out after 25 s']);
  });

  it('runs a command that takes over the page only at the prompt: never in a pipe, $( ), a script or a sourced file', async () => {
    const fn = vi.fn(() => '<div>System Shutdown Complete</div>');
    const { run, fs } = harness({ specs: [legacy('poweroff', fn, { category: 'system', summary: 'x', interactiveOnly: true })] });
    expect(await run('poweroff | cat')).toMatchObject({ status: 0, stderr: 'poweroff: only at the prompt' });
    expect(await run('X=$(poweroff); echo $?')).toMatchObject({ stdout: '1', stderr: 'poweroff: only at the prompt' });
    fs.writeFile('/home/guest/rc', 'poweroff\n', { mode: 0o755 });
    expect(await run('./rc')).toMatchObject({ status: 1, stderr: 'poweroff: only at the prompt' });
    expect(await run('poweroff > out.txt')).toMatchObject({ status: 1, stderr: 'poweroff: only at the prompt' });
    expect(fn).not.toHaveBeenCalled();
    expect((await run('poweroff')).status).toBe(0);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('the adapter', () => {
  it('passes every word, unparsed, to the legacy function, and carries its help', async () => {
    const calls: string[] = [];
    const fn: LegacyFn = (args) => {
      calls.push(args.join(' '));
      return 'ok';
    };
    const spec = legacy('old', fn, { category: 'network', summary: 'an old command', help: '<div>old help</div>' });
    expect(takesRawArgs(spec)).toBe(true);
    const registry = new CommandRegistry([spec]);
    expect(registry.validate()).toEqual([]);
    expect(registry.get('old')).toMatchObject({ category: 'network', summary: 'an old command', legacyHelp: '<div>old help</div>' });
    const { run } = harness({ specs: [spec] });
    await run('old -x AAPL');
    expect(calls).toEqual(['-x AAPL']);
  });
});

describe('the catalogue', () => {
  it('has no legacy command left: every command is a spec of its own, and only tests reach the adapter', () => {
    const registry = buildRegistry([]);
    for (const name of ['weather', 'qr', 'stock', 'curl', 'speedtest', 'fastfetch', 'ls', 'help', 'poweroff']) {
      const spec = registry.get(name);
      expect(spec, name).toBeDefined();
      expect(spec && 'legacyHelp' in spec, name).toBe(false);
    }
    const src = fileURLToPath(new URL('..', import.meta.url));
    const importers = readdirSync(src, { recursive: true, encoding: 'utf8' })
      .filter((file) => /\.(?:ts|svelte)$/.test(file) && !/\.test\.ts$/.test(file) && !file.startsWith('testing'))
      .filter((file) => /from '(?:\.{1,2}\/)+(?:commands\/)?legacy'/.test(readFileSync(join(src, file), 'utf8')));
    expect(importers).toEqual([]);
  });
});
