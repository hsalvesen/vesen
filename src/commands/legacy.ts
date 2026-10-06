// The legacy adapter (docs/plan/designs/shell-architecture.md, section 4). Temporary: it wraps
// the 26 commands in src/utils so that every one of them runs under the shell kernel, and so
// gains quotes, pipes, redirection, $? and ^C, until each is ported to its own spec file. It is
// deleted with the last port.
//
// This module stays DOM-free: the legacy functions, their help and their descriptions live in
// src/utils, which touches the page, so the app layer (src/app/legacy-commands.ts) hands them in.

import { out } from '../output/model';
import type { RawArgsSpec } from '../shell/flags';
import { writeLegacyHtml } from '../shell/streams';
import type { CommandContext, CommandSpec, Example, ExitCode } from '../shell/types';

/**
 * A legacy command: words in, HTML out. The signal aborts on ^C and when the budget runs out;
 * `status` sets what the status line says while it runs (speedtest's phase).
 */
export type LegacyFn = (args: string[], signal?: AbortSignal, status?: (text: string | null) => void) => string | Promise<string>;

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
    | 'interactiveOnly'
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
  /**
   * What the link is called when the URL could not open in the gesture (a phone, an in-app
   * browser): `LinkedIn: linkedin.com/in/…` replaces the legacy `Opening…` line.
   */
  readonly linkLabel?: string;
}

/**
 * A legacy command's status. Legacy commands report failure only in their HTML, so the error
 * markup the legacy code itself puts first means 1: errorLine's out-error span, a span in the red
 * palette colour or the error role, or an error-toned panel. Only the start counts, and never the
 * text: qr echoes what it was given and curl prints a page, either of which may say 'cannot' or
 * contain `out-error`. Coloured text further in (a stock's fall, fastfetch's palette) is not a
 * failure either.
 */
export function legacyStatus(html: string): ExitCode {
  if (/^\s*<span class="out-error">/.test(html)) return 1;
  if (/^\s*<span style="color: var\(--(?:theme-red|role-error)\)/.test(html)) return 1;
  if (/^\s*<div class="out-panel tone-error\b/.test(html)) return 1;
  return 0;
}

/** A URL as people read it: `linkedin.com/in/harrysalvesen`, `has@salvesen.app`. */
export function readableUrl(url: string): string {
  if (url.startsWith('mailto:')) return url.slice('mailto:'.length).split('?', 1)[0] ?? url;
  return url.replace(/^https?:\/\/(?:www\.)?/, '').replace(/\/$/, '');
}

/** Wraps one legacy function as a command spec. */
export function legacy(name: string, fn: LegacyFn, meta: LegacyMeta): CommandSpec {
  const { help, opens, prelude, argsFor, linkLabel, ...shown } = meta;
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
      if (url !== null && opened !== 'opened') {
        // Nothing opened (a phone, an in-app browser, a blocked pop-up), so the legacy
        // `Opening…` line would be untrue: one readable link instead.
        const label = linkLabel === undefined ? [] : [`${linkLabel}: `];
        await ctx.stdout.line(...label, out.link(readableUrl(url), url));
        return 0;
      }

      // The legacy function gets its own controller, linked to the job's ^C and budget.
      const controller = new AbortController();
      const onAbort = (): void => controller.abort(ctx.signal.reason);
      if (ctx.signal.aborted) controller.abort(ctx.signal.reason);
      else ctx.signal.addEventListener('abort', onAbort, { once: true });
      let html: string;
      try {
        html = await fn([...(argsFor?.(ctx) ?? ctx.args)], controller.signal, (text) => ctx.tty.status(text));
      } finally {
        ctx.signal.removeEventListener('abort', onAbort);
      }
      // Interrupted or out of time: the kernel says so, not the legacy notice.
      if (ctx.signal.aborted) throw ctx.signal.reason;

      // A legacy error goes to stderr, so `2>/dev/null` hides it and a pipe does not carry it.
      const status = legacyStatus(html);
      await writeLegacyHtml(status === 0 ? ctx.stdout : ctx.stderr, html);
      return status;
    },
  };
  return spec;
}

// ── The table ──────────────────────────────────────────────────────────────────────────────

/** The legacy command names, in the order help lists them today. */
export const LEGACY_NAMES = [
  'curl', 'email', 'fastfetch', 'poweroff', 'qr', 'repo', 'speedtest', 'stock', 'weather', 'whoami',
] as const;
export type LegacyName = (typeof LEGACY_NAMES)[number];

/** What the app layer supplies from src/utils. */
export interface LegacySource {
  readonly commands: Readonly<Record<LegacyName, LegacyFn>>;
  /** The legacy help panels for a command, as `<cmd> --help` showed them. */
  help(name: LegacyName): string | undefined;
  /** URLs the openers open: whoami, repo and email. */
  readonly opens?: Readonly<Partial<Record<LegacyName, (argv: readonly string[]) => string | null>>>;
}

const examples = (...lines: string[]): Example[] => lines.map((line) => ({ line }));
const offline = (...lines: string[]): Example[] => lines.map((line) => ({ line, offline: true }));

type StaticMeta = Omit<LegacyMeta, 'help' | 'opens'>;

/** Each legacy command's spec fields, until it is ported. */
const TABLE: Readonly<Record<LegacyName, StaticMeta>> = {
  curl: {
    category: 'network',
    summary: 'transfer a URL',
    network: true,
    loadingLabel: (argv) => `fetching ${argv[1] ?? 'the page'}…`,
    args: [{ name: 'URL', source: { kind: 'url' } }],
    examples: examples('curl https://httpbin.org/get', 'curl explainshell.com'),
  },
  email: { category: 'portfolio', summary: 'write an email to the developer', examples: examples('email'), linkLabel: 'Email' },
  fastfetch: {
    category: 'system',
    summary: 'show information about this system',
    featured: true,
    loadingLabel: () => 'gathering system information…',
    examples: [{ line: 'fastfetch', note: 'this system, at a glance', starter: 3 }],
  },
  // It takes over the whole page, so only a line typed at the prompt may run it: never ~/.bashrc.
  poweroff: { category: 'system', summary: 'shut down the terminal', examples: examples('poweroff'), interactiveOnly: true },
  qr: {
    category: 'portfolio',
    summary: 'draw a QR code for a URL or text',
    args: [{ name: 'TEXT', source: { kind: 'examples' }, variadic: true }],
    examples: offline('qr https://tldr.sh', 'qr explainshell.com', 'qr https://shellcheck.net'),
  },
  repo: { category: 'portfolio', summary: "open this terminal's source code", examples: examples('repo'), linkLabel: 'Source' },
  speedtest: {
    category: 'network',
    summary: 'measure the speed of the connection',
    network: true,
    budgetMs: 120_000,
    // It downloads megabytes, so only a line typed at the prompt may start it.
    interactiveOnly: true,
    loadingLabel: () => 'measuring the connection…',
    examples: examples('speedtest'),
  },
  stock: {
    category: 'network',
    summary: 'show the price of a stock',
    network: true,
    budgetMs: 10_000,
    loadingLabel: (argv) => `fetching ${argv[1]?.toUpperCase() ?? 'the quote'}…`,
    args: [{ name: 'TICKER', source: { kind: 'examples', caseInsensitive: true } }],
    examples: examples('stock AAPL', 'stock TEAM'),
  },
  weather: {
    category: 'network',
    summary: 'show the weather forecast for a place',
    network: true,
    budgetMs: 25_000,
    loadingLabel: (argv) => (argv.length > 1 ? `fetching the weather for ${argv.slice(1).join(' ')}…` : 'fetching the weather…'),
    args: [{ name: 'PLACE', source: { kind: 'examples', caseInsensitive: true, fromHistory: true }, optional: true, variadic: true }],
    examples: examples('weather Gadigal', 'weather Oslo', 'weather Aotearoa'),
  },
  whoami: {
    category: 'portfolio',
    summary: 'meet the developer; in a pipe, your user name',
    featured: true,
    examples: examples('whoami'),
    linkLabel: 'LinkedIn',
    // In a pipe whoami is the Linux command again.
    prelude: async (ctx) => {
      if (ctx.stdout.isTTY) return undefined;
      await ctx.stdout.write(`${ctx.user.name}\n`);
      return 0;
    },
  },
};

/** Every legacy command as a spec. */
export function legacySpecs(source: LegacySource): CommandSpec[] {
  return LEGACY_NAMES.map((name) => {
    const help = source.help(name);
    const opens = source.opens?.[name];
    return legacy(name, source.commands[name], {
      ...TABLE[name],
      ...(help === undefined ? {} : { help }),
      ...(opens === undefined ? {} : { opens }),
    });
  });
}
