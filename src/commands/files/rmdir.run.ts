// The body of rmdir; its spec, in rmdir.ts, loads this the first time rmdir runs, so the kernel's
// chunk carries only the spec.

import type { CommandContext, CommandDoc, ExitCode } from '../../shell/types';
import { basename } from '../../vfs/path';
import { errorCode, reason } from '../lib/files';

/** What --help, help and man say about rmdir, besides its spec (rmdir.ts). */
export const doc: CommandDoc = {
  description:
    'Removes each DIRECTORY, which must be empty; rm -r removes a folder with what is in it. With -p, the parents named in DIRECTORY go too, as long as they are empty in turn.',
  man: [{ heading: 'EXIT STATUS', body: '0 when every DIRECTORY was removed, 1 otherwise.' }],
};

/** The parent of a path as typed, or null at the top: a/b/c gives a/b, then a, then null. */
function parentTyped(typed: string): string | null {
  const trimmed = typed.replace(/\/+$/, '');
  const slash = trimmed.lastIndexOf('/');
  if (slash <= 0) return null;
  return trimmed.slice(0, slash).replace(/\/+$/, '') || null;
}

export async function run(ctx: CommandContext): Promise<ExitCode> {
  if (ctx.args.length === 0) return ctx.usage('missing operand');
  const verbose = ctx.opts.verbose === true;
  const ignore = ctx.opts.ignore === true;
  let status = 0;

  /** Removes one folder; false when it could not (or was not empty and that is ignored). */
  const removeOne = async (typed: string): Promise<boolean> => {
    if (verbose) await ctx.stdout.write(`rmdir: removing directory, '${typed}'\n`);
    // rmdir(2) refuses a path ending in `.`, whatever folder that is.
    if (basename(typed) === '.') {
      status = await ctx.fail(`failed to remove '${typed}': Invalid argument`);
      return false;
    }
    try {
      ctx.fs.rmdir(ctx.resolve(typed));
      return true;
    } catch (error) {
      if (ignore && errorCode(error) === 'ENOTEMPTY') return false;
      status = await ctx.fail(`failed to remove '${typed}': ${reason(error)}`);
      return false;
    }
  };

  for (const typed of ctx.args) {
    if (!(await removeOne(typed)) || ctx.opts.parents !== true) continue;
    for (let parent = parentTyped(typed); parent !== null; parent = parentTyped(parent)) {
      if (!(await removeOne(parent))) break;
    }
  }
  return status;
}
