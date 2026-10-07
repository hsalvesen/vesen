// The legacy adapter (docs/plan/designs/shell-architecture.md, section 4). Temporary: it wrapped
// the 26 commands in src/utils so that every one of them ran under the shell kernel, and so
// gained quotes, pipes, redirection, $? and ^C, until each was ported to its own spec file. Every
// command is now ported, so no table remains; the adapter and the legacy HTML block it writes are
// deleted in the clean-up that follows the last port (docs/plan/08-shell-and-commands.md).
//
// This module stays DOM-free: a legacy function and its help are handed in by the caller.

import type { RawArgsSpec } from '../shell/flags';
import { writeLegacyHtml } from '../shell/streams';
import type { CommandContext, CommandSpec, ExitCode } from '../shell/types';

/**
 * A legacy command: words in, HTML out. The signal aborts on ^C and when the budget runs out;
 * `status` sets what the status line says while it runs.
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
  /** Runs first; a status ends the command there, without the legacy function. */
  readonly prelude?: (ctx: CommandContext) => ExitCode | undefined | Promise<ExitCode | undefined>;
  /** The words the legacy function gets, when they differ from the operands. */
  readonly argsFor?: (ctx: CommandContext) => readonly string[];
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

/** The specs `legacy` made, so privacy can tell which backend a command still uses. */
const LEGACY_SPECS = new WeakSet<CommandSpec>();

/** True for a spec the legacy adapter wrapped, until that command is ported. */
export function isLegacySpec(spec: CommandSpec): boolean {
  return LEGACY_SPECS.has(spec);
}

/** Wraps one legacy function as a command spec. */
export function legacy(name: string, fn: LegacyFn, meta: LegacyMeta): CommandSpec {
  const { help, prelude, argsFor, ...shown } = meta;
  const spec: CommandSpec & RawArgsSpec = {
    name,
    ...shown,
    rawArgs: true,
    ...(help === undefined ? {} : { legacyHelp: help }),
    async run(ctx) {
      const early = await prelude?.(ctx);
      if (early !== undefined) return early;

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
  LEGACY_SPECS.add(spec);
  return spec;
}
