// A shell for kernel tests: a registry of tiny stand-in commands, a small file tree in the VFS,
// and fakes for every service. run(line) returns the status and what reached the screen, split
// by stream.

import { lineText, plain, type Block } from '../output/model';
import { createClock } from '../services/clock';
import { createNet } from '../services/net';
import { createSysInfoStub } from '../services/sysinfo';
import type { Appearance, Clock, KV, Net, Opener } from '../services/types';
import { createShell, type JobResult, type ScreenCommit, type Shell, type TerminalInfo } from '../shell/index';
import { CommandRegistry } from '../shell/registry';
import { defineCommand, type CommandContext, type CommandSpec } from '../shell/types';
import { strerror } from '../vfs/errors';
import { VfsError, type VirtualFile } from '../vfs/types';
import { Vfs } from '../vfs/vfs';

/** Reads the files named in ctx.args, or stdin when there are none; reports missing files. */
async function inputs(ctx: CommandContext, each: (text: string) => Promise<void>): Promise<number> {
  if (ctx.args.length === 0) {
    await each(await ctx.stdin.text());
    return 0;
  }
  let status = 0;
  for (const name of ctx.args) {
    if (name === '-') {
      await each(await ctx.stdin.text());
      continue;
    }
    try {
      await each(ctx.fs.readFile(ctx.resolve(name)));
    } catch (error) {
      if (!(error instanceof VfsError)) throw error;
      status = await ctx.fail(`${name}: ${strerror(error.code)}`);
    }
  }
  return status;
}

/** Stand-ins for the commands the executor tests need. */
export function stubCommands(): CommandSpec[] {
  return [
    defineCommand({
      name: 'echo',
      category: 'text',
      summary: 'display a line of text',
      posixArgs: true,
      flags: [{ short: 'n', description: 'do not print the trailing newline' }],
      run: async (ctx) => {
        await ctx.stdout.write(ctx.args.join(' ') + (ctx.opts.n ? '' : '\n'));
      },
    }),
    defineCommand({
      name: 'cat',
      category: 'files',
      summary: 'concatenate files',
      args: [{ name: 'FILE', source: { kind: 'path', accept: 'file' }, optional: true, variadic: true }],
      run: (ctx) => inputs(ctx, (text) => ctx.stdout.write(text)),
    }),
    defineCommand({
      name: 'wc',
      category: 'text',
      summary: 'count lines, words and characters',
      flags: [
        { short: 'l', long: 'lines', description: 'count lines' },
        { short: 'w', long: 'words', description: 'count words' },
        { short: 'c', long: 'bytes', description: 'count characters' },
      ],
      examples: [{ line: 'echo a b | wc -w', offline: true }],
      seeAlso: ['cat'],
      run: async (ctx) => {
        let all = '';
        const status = await inputs(ctx, async (text) => {
          all += text;
        });
        const counts: number[] = [];
        if (ctx.opts.lines) counts.push(all.split('\n').length - 1);
        if (ctx.opts.words) counts.push(all.split(/\s+/).filter(Boolean).length);
        if (ctx.opts.bytes) counts.push(all.length);
        if (counts.length === 0) counts.push(all.split('\n').length - 1, all.split(/\s+/).filter(Boolean).length, all.length);
        await ctx.stdout.write(`${counts.join(' ')}\n`);
        return status;
      },
    }),
    defineCommand({
      name: 'yes',
      category: 'text',
      summary: 'print y until stopped',
      run: async (ctx) => {
        const text = `${ctx.args[0] ?? 'y'}\n`;
        while (!ctx.signal.aborted) await ctx.stdout.write(text);
      },
    }),
    defineCommand({
      name: 'head',
      category: 'text',
      summary: 'output the first lines',
      numericShortcut: 'lines',
      flags: [{ short: 'n', long: 'lines', value: { name: 'NUM', source: { kind: 'int' }, default: '10' }, description: 'print the first NUM lines' }],
      run: async (ctx) => {
        const n = Number(ctx.opts.lines);
        let seen = 0;
        if (n <= 0) return;
        for await (const line of ctx.stdin.lines()) {
          await ctx.stdout.write(`${line}\n`);
          seen += 1;
          if (seen >= n) break;
        }
      },
    }),
    defineCommand({ name: 'true', category: 'shell', summary: 'do nothing, successfully', run: () => 0 }),
    defineCommand({ name: 'false', category: 'shell', summary: 'do nothing, unsuccessfully', run: () => 1 }),
    defineCommand({
      name: 'printenv',
      category: 'shell',
      summary: 'print a variable from the environment',
      run: async (ctx) => {
        const value = ctx.env.get(ctx.args[0] ?? '');
        if (value === undefined || !ctx.env.isExported(ctx.args[0] ?? '')) return 1;
        await ctx.stdout.write(`${value}\n`);
        return 0;
      },
    }),
    defineCommand({
      name: 'hang',
      category: 'shell',
      summary: 'never finish, and ignore ^C',
      run: () => new Promise<number>(() => {}),
    }),
    defineCommand({
      name: 'late',
      category: 'shell',
      summary: 'write once the line has been interrupted',
      run: async (ctx) => {
        await new Promise((resolve) => ctx.signal.addEventListener('abort', resolve, { once: true }));
        await ctx.stdout.write('too late\n');
      },
    }),
    defineCommand({
      name: 'fetch',
      category: 'network',
      summary: 'fetch a URL',
      network: true,
      run: async (ctx) => {
        const response = await ctx.net.text(ctx.args[0] ?? '', { signal: ctx.signal });
        await ctx.stdout.write(response.body);
      },
    }),
    defineCommand({
      name: 'clear',
      category: 'shell',
      summary: 'clear the screen',
      run: (ctx) => {
        ctx.tty.clear();
      },
    }),
    defineCommand({
      name: 'reset',
      category: 'shell',
      summary: 'reset the session',
      run: (ctx) => {
        ctx.shell.reset();
      },
    }),
    defineCommand({
      name: 'ls',
      category: 'files',
      summary: 'list a folder',
      flags: [{ short: 'a', long: 'all', description: 'show dotfiles' }],
      run: async (ctx) => {
        const names = ctx.fs.readdir(ctx.resolve(ctx.args[0] ?? '.'), { all: Boolean(ctx.opts.all) });
        for (const name of names) await ctx.stdout.write(`${name}\n`);
      },
    }),
    defineCommand({
      name: 'cd',
      category: 'files',
      summary: 'change the folder',
      builtin: true,
      run: (ctx) => {
        ctx.shell.chdir(ctx.args[0] ?? ctx.env.get('HOME') ?? '/');
      },
    }),
    defineCommand({
      name: 'pwd',
      category: 'files',
      summary: 'print the folder',
      run: async (ctx) => {
        await ctx.stdout.write(`${ctx.shell.cwd()}\n`);
      },
    }),
    defineCommand({
      name: 'fail',
      category: 'shell',
      summary: 'complain on stderr',
      run: (ctx) => ctx.fail(ctx.args.join(' ') || 'something went wrong'),
    }),
  ];
}

/** A home folder with two text files and a dotfile, the visitor's; the rest is root's. */
export function sampleTree(): VirtualFile {
  return {
    name: '',
    type: 'directory',
    children: {
      home: {
        name: 'home',
        type: 'directory',
        children: {
          guest: {
            name: 'guest',
            type: 'directory',
            owner: 'guest',
            group: 'guest',
            children: {
              'a.txt': { name: 'a.txt', type: 'file', content: 'alpha\n' },
              'b.txt': { name: 'b.txt', type: 'file', content: 'beta\n' },
              '.bashrc': { name: '.bashrc', type: 'file', content: "alias ll='ls -la'\n" },
              docs: { name: 'docs', type: 'directory', children: {} },
            },
          },
        },
      },
      etc: { name: 'etc', type: 'directory', children: { hostname: { name: 'hostname', type: 'file', content: 'vesen\n' } } },
      tmp: { name: 'tmp', type: 'directory', mode: 0o1777, children: {} },
    },
  };
}

/** Two themes and the CRT modes, held in plain variables: an Appearance for kernel tests. */
export function stubAppearance(): Appearance & { resets: number; cathode: string; quality: string; keys: string; hardware: boolean } {
  const swatches = (base: string) => [base, '#ff0000', '#00ff00', '#ffff00', '#0000ff', '#ff00ff', '#00ffff', '#808080'];
  const themes = [
    { name: 'swamphen', background: '#222235', foreground: '#ffffff', swatches: swatches('#ffffff') },
    { name: 'wombat', background: '#1c1814', foreground: '#e6ddd4', swatches: swatches('#e6ddd4') },
  ];
  const modes = [
    { name: 'off', summary: 'No effect.' },
    { name: 'scanlines', summary: 'Subtle scanlines.' },
    { name: 'vintage', summary: 'The full retro set.' },
  ];
  const qualities = ['auto', 'full', 'lite', 'off'];
  let theme = 'swamphen';
  const state = {
    resets: 0,
    cathode: 'scanlines',
    quality: 'auto',
    keys: 'auto',
    hardware: false,
    themes: () => themes,
    currentTheme: () => theme,
    setTheme: (name: string) => {
      const found = themes.find((t) => t.name === name.trim().toLowerCase());
      if (found === undefined) return false;
      theme = found.name;
      return true;
    },
    cathodeModes: () => modes,
    currentCathode: () => state.cathode,
    setCathode: (mode: string) => {
      const found = modes.find((m) => m.name === mode.trim().toLowerCase());
      if (found === undefined) return false;
      state.cathode = found.name;
      return true;
    },
    cathodeQualities: () => qualities,
    setCathodeQuality: (quality: string) => {
      const found = qualities.find((q) => q === quality.trim().toLowerCase());
      if (found === undefined) return false;
      state.quality = found;
      return true;
    },
    cathodeTier: () =>
      state.quality === 'auto'
        ? { tier: 'full', reason: 'a desktop', quality: 'auto' }
        : { tier: state.quality, reason: `set with cathode quality ${state.quality}`, quality: state.quality },
    keyBar: () => ({ mode: state.keys, hardware: state.hardware, shown: state.keys === 'on' || (state.keys === 'auto' && !state.hardware) }),
    keyBarModes: () => ['auto', 'on', 'off'],
    setKeyBar: (mode: string) => {
      const found = ['auto', 'on', 'off'].find((m) => m === mode.trim().toLowerCase());
      if (found === undefined) return false;
      state.keys = found;
      return true;
    },
    resetDefaults: () => {
      state.resets += 1;
      theme = 'swamphen';
    },
  };
  return state;
}

export interface HarnessOptions {
  readonly specs?: readonly CommandSpec[];
  /** The seed; a fresh copy is built again for `reset`. */
  readonly tree?: () => VirtualFile;
  readonly net?: Net;
  readonly clock?: Clock;
  readonly storage?: KV<'local'> | null;
  readonly opener?: Opener;
  readonly terminal?: TerminalInfo;
}

export interface RunResult extends JobResult {
  /** The stdout lines and plain text of other blocks, joined with newlines. */
  readonly stdout: string;
  readonly stderr: string;
}

/** The text a stream put on the screen. */
export function screenText(blocks: readonly Block[], stream: 'stdout' | 'stderr'): string {
  const parts: string[] = [];
  for (const block of blocks) {
    if (block.type === 'lines') {
      if (block.stream === stream) parts.push(...block.lines.map(lineText));
    } else if (stream === 'stdout') {
      parts.push(plain(block).replace(/\n$/, ''));
    }
  }
  return parts.join('\n');
}

export function harness(options: HarnessOptions = {}) {
  const fs = new Vfs({ seed: options.tree ?? sampleTree, now: () => Date.UTC(2026, 9, 6, 9, 0, 0) });
  const tree = fs.root;
  const commits: ScreenCommit[] = [];
  let bells = 0;
  const appearance = stubAppearance();
  const shell: Shell = createShell({
    registry: new CommandRegistry([...stubCommands().filter((stub) => !options.specs?.some((spec) => spec.name === stub.name)), ...(options.specs ?? [])]),
    fs,
    storage: options.storage ?? null,
    net: options.net ?? createNet(),
    clock: options.clock ?? createClock({ random: () => 0.5 }),
    sys: createSysInfoStub(null),
    appearance,
    screen: { commit: (entry) => commits.push(entry) },
    bell: { ring: () => (bells += 1), onFlash: () => () => {} },
    yieldToHost: () => Promise.resolve(),
    ...(options.opener ? { opener: options.opener } : {}),
    ...(options.terminal ? { terminal: options.terminal } : {}),
  });
  const run = async (line: string): Promise<RunResult> => {
    const result = await shell.run(line);
    return { ...result, stdout: screenText(result.blocks, 'stdout'), stderr: screenText(result.blocks, 'stderr') };
  };
  return {
    shell,
    fs,
    tree,
    commits,
    appearance,
    run,
    get bells() {
      return bells;
    },
  };
}
