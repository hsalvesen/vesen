import { afterEach, describe, expect, it, vi } from 'vitest';
import { lineText, type Block } from '../output/model';
import { harness } from '../testing/shell-harness';
import { CommandRegistry } from '../shell/registry';
import { takesRawArgs } from '../shell/flags';
import { isLegacySpec, LEGACY_NAMES, legacy, legacySpecs, legacyStatus, type LegacyFn, type LegacyName, type LegacySource } from './legacy';

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

/** Every legacy command, each printing its own name and words. */
function fakeSource(): LegacySource & { calls: string[] } {
  const calls: string[] = [];
  const commands = Object.fromEntries(
    LEGACY_NAMES.map((name) => [name, ((args: string[]) => {
      calls.push([name, ...args].join(' '));
      return `${name}:${args.join(',')}`;
    }) satisfies LegacyFn]),
  ) as Record<LegacyName, LegacyFn>;
  return {
    calls,
    commands,
    help: (name) => (name === 'stock' ? '<div>stock help</div>' : undefined),
  };
}

describe('the legacy table', () => {
  it('wraps the 4 commands not yet ported, each once, with a category and a summary', () => {
    const specs = legacySpecs(fakeSource());
    expect(specs).toHaveLength(4);
    expect(new Set(specs.map((spec) => spec.name)).size).toBe(4);
    expect(specs.every(isLegacySpec)).toBe(true);
    // Ported to src/commands: the file and text core, history, clear, cd, pwd, reset, help, theme,
    // cathode, banner, sudo, the openers, the power commands, weather and qr.
    const ported = ['cd', 'ls', 'cat', 'echo', 'mkdir', 'touch', 'rm', 'history', 'clear', 'help', 'theme', 'cathode', 'banner', 'sudo', 'weather', 'qr'];
    for (const name of [...ported, 'whoami', 'email', 'repo', 'poweroff']) {
      expect(specs.map((spec) => spec.name)).not.toContain(name);
    }
    const registry = new CommandRegistry(specs);
    expect(registry.validate()).toEqual([]);
    expect(specs.every((spec) => takesRawArgs(spec))).toBe(true);
    expect(registry.get('stock')).toMatchObject({ category: 'network', summary: 'show the price of a stock', legacyHelp: '<div>stock help</div>' });
    expect(registry.get('stock')).toMatchObject({ network: true, budgetMs: 10_000 });
    expect(registry.get('curl')?.network).toBe(true);
    expect(registry.get('fastfetch')?.category).toBe('system');
  });

  it('gives every command a lower-case summary of 50 characters or fewer, as the specs have', () => {
    for (const spec of legacySpecs(fakeSource())) {
      expect(spec.summary.length, spec.name).toBeLessThanOrEqual(50);
      expect(spec.summary.charAt(0), spec.name).toBe(spec.summary.charAt(0).toLowerCase());
    }
  });

  it('describes arguments for completion', () => {
    const registry = new CommandRegistry(legacySpecs(fakeSource()));
    expect(registry.get('stock')?.args?.[0]?.source).toEqual({ kind: 'examples', caseInsensitive: true });
  });

  it('passes every word, unparsed, to the legacy function', async () => {
    const source = fakeSource();
    const { run } = harness({ specs: legacySpecs(source) });
    await run('stock -x AAPL');
    expect(source.calls).toEqual(['stock -x AAPL']);
  });
});
