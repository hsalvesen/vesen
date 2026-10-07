// The body of realpath; its spec, in realpath.ts, loads this the first time realpath runs.

import type { CommandContext, CommandDoc, ExitCode } from '../../../shell/types';
import { segments } from '../../../vfs/path';
import { canonical, type Existence } from '../../lib/canonical';
import { reason } from '../../lib/files';

/** What --help, help and man say about realpath, besides its spec (realpath.ts). */
export const doc: CommandDoc = {
  description:
    "Prints each FILE as an absolute path with every symbolic link followed and every . and .. resolved, so two names for one file print the same. Every part but the last must exist; -e asks for the last too, and -m for none. -s tidies the path without following links.",
  man: [{ heading: 'EXIT STATUS', body: '0 when every FILE was resolved, 1 otherwise.' }],
};

/** `to` relative to the folder `from`, both absolute: `../projects`. */
export function relative(from: string, to: string): string {
  const a = segments(from);
  const b = segments(to);
  let common = 0;
  while (common < a.length && common < b.length && a[common] === b[common]) common += 1;
  const parts = [...a.slice(common).map(() => '..'), ...b.slice(common)];
  return parts.length === 0 ? '.' : parts.join('/');
}

export async function run(ctx: CommandContext): Promise<ExitCode> {
  if (ctx.args.length === 0) return ctx.usage('missing operand');
  const existence: Existence = ctx.opts['canonicalize-existing'] === true ? 'existing' : ctx.opts['canonicalize-missing'] === true ? 'missing' : 'all-but-last';
  const physical = ctx.opts.strip !== true;
  const quiet = ctx.opts.quiet === true;
  const end = ctx.opts.zero === true ? '\0' : '\n';
  let base: string | null = null;
  if (typeof ctx.opts['relative-to'] === 'string') {
    const dir = ctx.opts['relative-to'];
    try {
      base = canonical(ctx, dir, existence, physical);
    } catch (error) {
      return ctx.fail(`${dir}: ${reason(error)}`);
    }
  }
  let status = 0;
  for (const typed of ctx.args) {
    try {
      const path = canonical(ctx, typed, existence, physical);
      await ctx.stdout.write(`${base === null ? path : relative(base, path)}${end}`);
    } catch (error) {
      if (!quiet) await ctx.fail(`${typed}: ${reason(error)}`);
      status = 1;
    }
  }
  return status;
}
