// The body of mv; its spec, in mv.ts, loads this the first time mv runs, so the
// kernel's chunk carries only the spec.

import type { CommandContext, CommandDoc, ExitCode } from '../../shell/types';
import { basename, isWithin, join } from '../../vfs/path';
import type { Stat } from '../../vfs/types';
import { childPath, entryPath, errorCode, realOrSelf, reason, tryLstat, tryStat } from '../lib/files';

/** What --help, help and man say about mv, besides its spec (mv.ts). */
export const doc: CommandDoc = {
  description:
    'Renames SOURCE to DEST, or moves each SOURCE into DIRECTORY. A file at DEST is replaced, unless -n is given. It prints nothing when it works; -v says what moved.',
  man: [{ heading: 'EXIT STATUS', body: '0 when everything was moved, 1 otherwise.' }],
};

/** Runs mv. */
export async function run(ctx: CommandContext): Promise<ExitCode | void> {
  const [first] = ctx.args;
  if (first === undefined) return ctx.usage('missing file operand');
  if (ctx.args.length === 1) return ctx.usage(`missing destination file operand after '${first}'`);
  const sources = ctx.args.slice(0, -1);
  const dest = ctx.args[ctx.args.length - 1] ?? '';
  const destPath = ctx.resolve(dest);
  const intoFolder = tryStat(ctx, destPath)?.type === 'directory';
  if (sources.length > 1 && !intoFolder) return ctx.fail(`target '${dest}' is not a directory`);

  let status = 0;
  for (const source of sources) {
    const path = ctx.resolve(source);
    let stat: Stat;
    try {
      stat = ctx.fs.lstat(path);
    } catch (error) {
      status = await ctx.fail(`cannot stat '${source}': ${reason(error)}`);
      continue;
    }
    const target = intoFolder ? { typed: childPath(dest, basename(source)), path: join(destPath, basename(source)) } : { typed: dest, path: destPath };
    const there = tryLstat(ctx, target.path);
    if (there !== null && entryPath(ctx, target.path) === entryPath(ctx, path)) {
      status = await ctx.fail(`'${source}' and '${target.typed}' are the same file`);
      continue;
    }
    if (there !== null && ctx.opts['no-clobber'] === true) continue;
    if (stat.type === 'directory' && isWithin(realOrSelf(ctx, target.path), realOrSelf(ctx, path))) {
      status = await ctx.fail(`cannot move '${source}' to a subdirectory of itself, '${target.typed}'`);
      continue;
    }
    try {
      ctx.fs.rename(path, target.path);
    } catch (error) {
      const code = errorCode(error);
      if (code === 'EISDIR') status = await ctx.fail(`cannot overwrite directory '${target.typed}' with non-directory`);
      else if (code === 'ENOTDIR' && there !== null) status = await ctx.fail(`cannot overwrite non-directory '${target.typed}' with directory '${source}'`);
      else status = await ctx.fail(`cannot move '${source}' to '${target.typed}': ${reason(error)}`);
      continue;
    }
    if (ctx.opts.verbose === true) await ctx.stdout.write(`renamed '${source}' -> '${target.typed}'\n`);
  }
  return status;
}
