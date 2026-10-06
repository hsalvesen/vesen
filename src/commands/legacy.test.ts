import { afterEach, describe, expect, it, vi } from 'vitest';
import { lineText, type Block } from '../output/model';
import { harness } from '../testing/shell-harness';
import { CommandRegistry } from '../shell/registry';
import { takesRawArgs } from '../shell/flags';
import { LEGACY_NAMES, legacy, legacySpecs, legacyStatus, type LegacyFn, type LegacyName, type LegacySource } from './legacy';

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
    expect(legacyStatus("rm: cannot remove 'x': No such file or directory")).toBe(1);
    expect(legacyStatus('help: no help available for x: not found')).toBe(1);
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

  it('turns clear into a shell effect', async () => {
    const legacyFn = vi.fn(() => '');
    const { run } = harness({ specs: [legacy('clear', legacyFn, { category: 'shell', summary: 'x', effect: 'clearScreen' })] });
    expect((await run('echo a; clear')).screen).toBe('clear');
    expect(legacyFn).not.toHaveBeenCalled();
  });

  it('prints a link when its opener did not open, and nothing more when it did', async () => {
    const spec = legacy('whoami', () => 'Opening...', { category: 'portfolio', summary: 'x', opens: () => 'https://www.linkedin.com/in/harrysalvesen/' });
    const opened: string[] = [];
    const opener = {
      autoOpen: true,
      preflight: (url: string) => {
        opened.push(url);
        return 'opened' as const;
      },
      open: () => 'opened' as const,
      escapeHref: () => null,
      menuHint: () => null,
      canShare: () => false,
      share: async () => 'unavailable' as const,
    };
    const desktop = harness({ specs: [spec], opener });
    desktop.shell.preflight('whoami');
    expect(texts((await desktop.shell.run('whoami')).blocks)).toEqual(['<html>Opening...']);
    expect(opened).toHaveLength(1);

    const inApp = harness({ specs: [spec], opener: { ...opener, autoOpen: false, preflight: () => 'skipped' as const } });
    inApp.shell.preflight('whoami');
    const result = await inApp.shell.run('whoami');
    expect(texts(result.blocks)).toEqual(['<html>Opening...', 'https://www.linkedin.com/in/harrysalvesen/']);
    const link = result.blocks[1]?.type === 'lines' ? result.blocks[1].lines[0]?.[0] : undefined;
    expect(link?.href).toBe('https://www.linkedin.com/in/harrysalvesen/');
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
    help: (name) => (name === 'ls' ? '<div>ls help</div>' : undefined),
    descriptions: { ls: 'List files', theme: 'Change theme' },
    opens: { repo: () => 'https://github.com/hsalvesen/vesen' },
    themes: () => [{ value: 'swamphen' }, { value: 'wombat' }],
    cathodeModes: () => [{ value: 'vintage' }],
    crtQualities: () => [{ value: 'auto' }],
  };
}

describe('the legacy table', () => {
  it('wraps the 23 commands not yet ported, each once, with a category and a summary', () => {
    const specs = legacySpecs(fakeSource());
    expect(specs).toHaveLength(23);
    expect(new Set(specs.map((spec) => spec.name)).size).toBe(23);
    // Ported to src/commands: cd and pwd (files) and reset (shell).
    expect(specs.map((spec) => spec.name)).not.toContain('cd');
    const registry = new CommandRegistry(specs);
    expect(registry.validate()).toEqual([]);
    expect(specs.every((spec) => takesRawArgs(spec))).toBe(true);
    expect(registry.get('ls')).toMatchObject({ category: 'files', summary: 'List files', legacyHelp: '<div>ls help</div>' });
    expect(registry.get('whoami')?.category).toBe('portfolio');
    expect(registry.get('weather')).toMatchObject({ network: true, budgetMs: 25_000 });
    expect(registry.get('stock')).toMatchObject({ network: true, budgetMs: 10_000 });
    expect(registry.get('curl')?.network).toBe(true);
    expect(registry.get('repo')?.opens?.(['repo'])).toBe('https://github.com/hsalvesen/vesen');
    expect(registry.get('rm')?.summary).toBe('rm');
  });

  it('describes arguments and subcommands for completion', () => {
    const registry = new CommandRegistry(legacySpecs(fakeSource()));
    const theme = registry.get('theme');
    expect(Object.keys(theme?.subcommands ?? {})).toEqual(['ls', 'set']);
    const source = theme?.subcommands?.set?.args?.[0]?.source;
    expect(source?.kind === 'enum' && source.values().map((value) => value.value)).toEqual(['swamphen', 'wombat']);
    expect(registry.get('ls')?.args?.[0]?.source).toEqual({ kind: 'path', accept: 'dir', includeParent: true });
    expect(registry.get('help')?.args?.[0]?.source).toEqual({ kind: 'command' });
  });

  it('keeps a subcommand in the words the legacy function reads', async () => {
    const source = fakeSource();
    const { run } = harness({ specs: legacySpecs(source) });
    await run('theme set wombat');
    expect(source.calls).toEqual(['theme set wombat']);
  });

  it('clears history with history -c, and copies stdin for cat', async () => {
    const source = fakeSource();
    const { run, shell } = harness({ specs: legacySpecs(source) });
    await run('echo one');
    expect(shell.history.list().length).toBeGreaterThan(0);
    await run('history -c');
    expect(shell.history.list()).toEqual([]);
    expect((await run('cat a.txt | cat')).stdout).toBe('cat:a.txt');
    expect(source.calls.filter((call) => call.startsWith('cat'))).toEqual(['cat a.txt']);
    expect((await run('cat README.md')).blocks).toEqual([{ type: 'legacyHtml', html: 'cat:README.md' }]);
  });

  it('draws an owner document on a terminal from its styled lines, and gives a pipe its text', async () => {
    const source = fakeSource();
    const h = harness({ specs: legacySpecs(source) });
    const node = h.tree.children?.home?.children?.guest?.children?.['a.txt'];
    if (node === undefined) throw new Error('no a.txt');
    node.styled = [[{ text: 'alpha', style: { fg: 'yellow', bold: true } }]];
    const result = await h.run('cat a.txt');
    expect(result.blocks).toEqual([{ type: 'lines', stream: 'stdout', lines: [[{ text: 'alpha', style: { fg: 'yellow', bold: true } }]] }]);
    expect(source.calls).toEqual([]);
    // Piped, or with more than one file, the legacy cat prints the plain text.
    await h.run('cat a.txt | cat');
    await h.run('cat a.txt b.txt');
    expect(source.calls).toEqual(['cat a.txt', 'cat a.txt b.txt']);
  });

  it('answers help NAME for a ported command from its spec', async () => {
    const source = fakeSource();
    const pwd = { name: 'pwd', category: 'files' as const, summary: 'print the working directory', run: () => 0 };
    const { run } = harness({ specs: [...legacySpecs(source), pwd] });
    const result = await run('help pwd');
    expect(result.stdout).toContain('print the working directory');
    expect(source.calls).toEqual([]);
    await run('help ls');
    expect(source.calls).toEqual(['help ls']);
  });

  it('prints guest for whoami in a pipe, as the Linux command does', async () => {
    const source = fakeSource();
    const { run } = harness({ specs: legacySpecs(source) });
    expect((await run('whoami | cat')).stdout).toBe('guest');
    expect(source.calls).toEqual([]);
  });
});
