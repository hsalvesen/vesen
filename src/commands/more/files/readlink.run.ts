// The body of readlink; its spec, in readlink.ts, loads this the first time readlink runs.

import type { CommandContext, CommandDoc, ExitCode } from '../../../shell/types';
import { canonical, type Existence } from '../../lib/canonical';
import { reason } from '../../lib/files';

/** What --help, help and man say about readlink, besides its spec (readlink.ts). */
export const doc: CommandDoc = {
  description:
    "Prints the target of each symbolic link FILE, as it was written when the link was made. With -f, -e or -m it prints the canonical path instead, every link followed, as realpath does. A FILE that is not a link prints nothing and makes the status 1; errors are said only with -v.",
  man: [{ heading: 'EXIT STATUS', body: '0 when every FILE was a link (or, with -f, -e or -m, could be resolved), 1 otherwise.' }],
};

export async function run(ctx: CommandContext): Promise<ExitCode> {
  if (ctx.args.length === 0) return ctx.usage('missing operand');
  const existence: Existence | null =
    ctx.opts.canonicalize === true ? 'all-but-last' : ctx.opts['canonicalize-existing'] === true ? 'existing' : ctx.opts['canonicalize-missing'] === true ? 'missing' : null;
  const verbose = ctx.opts.verbose === true;
  let noNewline = ctx.opts['no-newline'] === true;
  if (noNewline && ctx.args.length > 1) {
    if (verbose) await ctx.fail('ignoring --no-newline with multiple arguments');
    noNewline = false;
  }
  const end = noNewline ? '' : ctx.opts.zero === true ? '\0' : '\n';
  let status = 0;
  for (const typed of ctx.args) {
    try {
      const value = existence === null ? ctx.fs.readlink(ctx.resolve(typed)) : canonical(ctx, typed, existence);
      await ctx.stdout.write(`${value}${end}`);
    } catch (error) {
      if (verbose) await ctx.fail(`${typed}: ${reason(error)}`);
      status = 1;
    }
  }
  return status;
}
