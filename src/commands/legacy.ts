// The legacy adapter (docs/plan/designs/shell-architecture.md, section 4). Temporary: it wraps
// the 26 commands in src/utils so that every one of them runs under the shell kernel, and so
// gains quotes, pipes, redirection, $? and ^C, until each is ported to its own spec file. It is
// deleted with the last port.
//
// This module stays DOM-free: the legacy functions, their help and their descriptions live in
// src/utils, which touches the page, so the app layer (src/app/legacy-commands.ts) hands them in.

import { htmlToText } from '../output/html-to-text';
import { out } from '../output/model';
import type { RawArgsSpec } from '../shell/flags';
import { writeLegacyHtml } from '../shell/streams';
import type { ArgSpec, CommandContext, CommandSpec, EnumValue, Example, ExitCode, SubcommandSpec } from '../shell/types';

/** A legacy command: words in, HTML out. The signal aborts on ^C and when the budget runs out. */
export type LegacyFn = (args: string[], signal?: AbortSignal) => string | Promise<string>;

/** What the adapter adds to a legacy function to make it a command. */
export interface LegacyMeta
  extends Pick<
    CommandSpec,
    | 'category'
    | 'aliases'
    | 'args'
    | 'subcommands'
    | 'network'
    | 'budgetMs'
    | 'featured'
    | 'hidden'
    | 'examples'
    | 'builtin'
    | 'loadingLabel'
  > {
  readonly summary: string;
  /** The legacy help, already laid out as panels; shown for --help and -h. */
  readonly help?: string;
  /** A URL the command opens: opened inside the Enter gesture on a desktop, and linked otherwise. */
  readonly opens?: (argv: readonly string[]) => string | null;
  /** Runs first; a status ends the command there, without the legacy function. */
  readonly prelude?: (ctx: CommandContext) => ExitCode | undefined | Promise<ExitCode | undefined>;
  /** The words the legacy function gets, when they differ from the operands. */
  readonly argsFor?: (ctx: CommandContext) => readonly string[];
}

/**
 * A legacy command's status. Legacy commands report failure only in their HTML, so their error
 * styles mean 1: the out-error class or the error role anywhere, a first line in the red palette
 * colour, or 'not found' or 'cannot' in the first line of text. Coloured text further in (a
 * stock's fall, fastfetch's palette, the owner's documents) is not a failure.
 */
export function legacyStatus(html: string): ExitCode {
  if (/\bout-error\b|var\(--role-error\)/.test(html)) return 1;
  if (/^\s*<span style="color: var\(--theme-red\)/.test(html)) return 1;
  const first = htmlToText(html).split('\n', 1)[0] ?? '';
  return /not found|cannot/i.test(first) ? 1 : 0;
}

/** Wraps one legacy function as a command spec. */
export function legacy(name: string, fn: LegacyFn, meta: LegacyMeta): CommandSpec {
  const { help, opens, prelude, argsFor, ...shown } = meta;
  const spec: CommandSpec & RawArgsSpec = {
    name,
    ...shown,
    rawArgs: true,
    ...(help === undefined ? {} : { legacyHelp: help }),
    ...(opens === undefined ? {} : { opens }),
    async run(ctx) {
      const early = await prelude?.(ctx);
      if (early !== undefined) return early;

      // The opener runs before the output, as the legacy command did; off the screen it does not.
      const url = ctx.stdout.isTTY ? (opens?.(ctx.argv) ?? null) : null;
      const opened = url === null ? null : await ctx.tty.open(url, name);

      // The legacy function gets its own controller, linked to the job's ^C and budget.
      const controller = new AbortController();
      const onAbort = (): void => controller.abort(ctx.signal.reason);
      if (ctx.signal.aborted) controller.abort(ctx.signal.reason);
      else ctx.signal.addEventListener('abort', onAbort, { once: true });
      let html: string;
      try {
        html = await fn([...(argsFor?.(ctx) ?? ctx.args)], controller.signal);
      } finally {
        ctx.signal.removeEventListener('abort', onAbort);
      }
      // Interrupted or out of time: the kernel says so, not the legacy notice.
      if (ctx.signal.aborted) throw ctx.signal.reason;

      // A legacy error goes to stderr, so `2>/dev/null` hides it and a pipe does not carry it.
      const status = legacyStatus(html);
      await writeLegacyHtml(status === 0 ? ctx.stdout : ctx.stderr, html);
      if (url !== null && opened !== 'opened') await ctx.stdout.line(out.link(url, url));
      return status;
    },
  };
  return spec;
}

// ── The table ──────────────────────────────────────────────────────────────────────────────

/** The legacy command names, in the order help lists them today. */
export const LEGACY_NAMES = [
  'banner', 'cathode', 'curl', 'email', 'fastfetch', 'help', 'poweroff', 'qr', 'repo', 'speedtest', 'stock', 'sudo',
  'theme', 'weather', 'whoami',
] as const;
export type LegacyName = (typeof LEGACY_NAMES)[number];

/** What the app layer supplies from src/utils and the stores. */
export interface LegacySource {
  readonly commands: Readonly<Record<LegacyName, LegacyFn>>;
  /** The legacy help panels for a command, as `<cmd> --help` showed them. */
  help(name: LegacyName): string | undefined;
  /** The one-line descriptions help.ts and Tab completion show. */
  readonly descriptions: Readonly<Partial<Record<LegacyName, string>>>;
  /** URLs the openers open: whoami, repo and email. */
  readonly opens?: Readonly<Partial<Record<LegacyName, (argv: readonly string[]) => string | null>>>;
  readonly themes: () => readonly EnumValue[];
  readonly cathodeModes: () => readonly EnumValue[];
  readonly crtQualities: () => readonly EnumValue[];
}

const examples = (...lines: string[]): Example[] => lines.map((line) => ({ line }));
const offline = (...lines: string[]): Example[] => lines.map((line) => ({ line, offline: true }));

/** `help NAME` for a command that has been ported: the help its spec generates. */
async function specHelp(ctx: CommandContext): Promise<ExitCode | undefined> {
  const name = ctx.args[0];
  const spec = name === undefined ? undefined : ctx.shell.registry.get(name);
  if (spec === undefined || spec.legacyHelp !== undefined) return undefined;
  const { commandHelp } = await import('../shell/help');
  for (const block of commandHelp(spec)) await ctx.stdout.block(block);
  return 0;
}

type StaticMeta = Omit<LegacyMeta, 'summary' | 'help' | 'opens'> & { readonly summary?: string };

function tableFor(source: LegacySource): Record<LegacyName, StaticMeta> {
  const subcommand = (summary: string, args?: ArgSpec[]): SubcommandSpec => (args ? { summary, args } : { summary });
  return {
    banner: { category: 'portfolio', examples: offline('banner') },
    cathode: {
      category: 'portfolio',
      subcommands: {
        ls: subcommand('list the CRT variations'),
        set: subcommand('turn a variation on', [{ name: 'VARIATION', source: { kind: 'enum', values: source.cathodeModes } }]),
        off: subcommand('turn the effect off'),
        quality: subcommand('choose how much of the effect to draw', [
          { name: 'QUALITY', source: { kind: 'enum', values: source.crtQualities }, optional: true },
        ]),
      },
      examples: offline('cathode ls', 'cathode set vintage', 'cathode off'),
    },
    curl: {
      category: 'network',
      network: true,
      loadingLabel: (argv) => `fetching ${argv[1] ?? 'the page'}…`,
      args: [{ name: 'URL', source: { kind: 'url' } }],
      examples: examples('curl https://httpbin.org/get', 'curl explainshell.com'),
    },
    email: { category: 'portfolio', examples: examples('email') },
    fastfetch: {
      category: 'system',
      featured: true,
      loadingLabel: () => 'gathering system information…',
      examples: examples('fastfetch'),
    },
    help: {
      category: 'shell',
      featured: true,
      args: [{ name: 'COMMAND', source: { kind: 'command' }, optional: true }],
      examples: offline('help', 'help ls'),
      prelude: specHelp,
    },
    poweroff: { category: 'system', examples: examples('poweroff') },
    qr: {
      category: 'portfolio',
      args: [{ name: 'TEXT', source: { kind: 'examples' }, variadic: true }],
      examples: offline('qr https://tldr.sh', 'qr explainshell.com', 'qr https://shellcheck.net'),
    },
    repo: { category: 'portfolio', examples: examples('repo') },
    speedtest: {
      category: 'network',
      network: true,
      budgetMs: 120_000,
      loadingLabel: () => 'measuring the connection…',
      examples: examples('speedtest'),
    },
    stock: {
      category: 'network',
      network: true,
      budgetMs: 10_000,
      loadingLabel: (argv) => `fetching ${argv[1]?.toUpperCase() ?? 'the quote'}…`,
      args: [{ name: 'TICKER', source: { kind: 'examples', caseInsensitive: true } }],
      examples: examples('stock AAPL', 'stock TEAM'),
    },
    sudo: {
      category: 'shell',
      args: [{ name: 'COMMAND', source: { kind: 'commandLine' }, optional: true }],
      examples: examples('sudo ls'),
    },
    theme: {
      category: 'portfolio',
      featured: true,
      subcommands: {
        ls: subcommand('list the themes'),
        set: subcommand('switch to a theme', [{ name: 'THEME', source: { kind: 'enum', values: source.themes, caseInsensitive: true } }]),
      },
      examples: offline('theme ls', 'theme set swamphen'),
    },
    weather: {
      category: 'network',
      network: true,
      budgetMs: 25_000,
      loadingLabel: (argv) => (argv.length > 1 ? `fetching the weather for ${argv.slice(1).join(' ')}…` : 'fetching the weather…'),
      args: [{ name: 'PLACE', source: { kind: 'examples', caseInsensitive: true, fromHistory: true }, optional: true, variadic: true }],
      examples: examples('weather Gadigal', 'weather Oslo', 'weather Aotearoa'),
    },
    whoami: {
      category: 'portfolio',
      featured: true,
      examples: examples('whoami'),
      // In a pipe whoami is the Linux command again.
      prelude: async (ctx) => {
        if (ctx.stdout.isTTY) return undefined;
        await ctx.stdout.write(`${ctx.user.name}\n`);
        return 0;
      },
    },
  };
}

/** Every legacy command as a spec. */
export function legacySpecs(source: LegacySource): CommandSpec[] {
  const table = tableFor(source);
  return LEGACY_NAMES.map((name) => {
    const { summary, ...meta } = table[name];
    const help = source.help(name);
    const opens = source.opens?.[name];
    return legacy(name, source.commands[name], {
      ...meta,
      summary: summary ?? source.descriptions[name] ?? name,
      ...(help === undefined ? {} : { help }),
      ...(opens === undefined ? {} : { opens }),
    });
  });
}
