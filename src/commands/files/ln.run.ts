// The body of ln; its spec, in ln.ts, loads this the first time ln runs, so the
// kernel's chunk carries only the spec.

import { out } from '../../output/model';
import type { CommandContext, ExitCode } from '../../shell/types';
import { basename } from '../../vfs/path';
import { childPath, reason, tryLstat, tryStat } from '../lib/files';

/** Runs ln. */
export async function run(ctx: CommandContext): Promise<ExitCode | void> {
  const args = ctx.args;
  const [first] = args;
  if (first === undefined) return ctx.usage('missing file operand');
  const last = args[args.length - 1] ?? first;
  const lastIsFolder = args.length >= 2 && tryStat(ctx, ctx.resolve(last))?.type === 'directory';
  if (args.length > 2 && !lastIsFolder) return ctx.fail(`target '${last}' is not a directory`);

  // Each TARGET with the name its link gets, as typed.
  const pairs: { target: string; link: string }[] =
    args.length === 1
      ? [{ target: first, link: basename(first) }]
      : lastIsFolder
        ? args.slice(0, -1).map((target) => ({ target, link: childPath(last, basename(target)) }))
        : [{ target: first, link: last }];

  let status = 0;
  for (const { target, link } of pairs) {
    const path = ctx.resolve(link);
    if (ctx.opts.symbolic !== true) {
      status = await ctx.fail(`failed to create hard link '${link}' => '${target}': Operation not permitted`);
      if (ctx.stderr.isTTY) await ctx.stderr.line(out.span('vesen has symbolic links only: try ln -s', { fg: 'muted' }));
      continue;
    }
    const existing = tryLstat(ctx, path);
    if (existing !== null) {
      if (ctx.opts.force !== true) {
        status = await ctx.fail(`failed to create symbolic link '${link}': File exists`);
        continue;
      }
      if (existing.type === 'directory') {
        status = await ctx.fail(`'${link}': cannot overwrite directory`);
        continue;
      }
      try {
        ctx.fs.rm(path);
      } catch (error) {
        status = await ctx.fail(`cannot remove '${link}': ${reason(error)}`);
        continue;
      }
    }
    try {
      ctx.fs.symlink(target, path);
    } catch (error) {
      status = await ctx.fail(`failed to create symbolic link '${link}': ${reason(error)}`);
      continue;
    }
    if (ctx.opts.verbose === true) await ctx.stdout.write(`'${link}' -> '${target}'\n`);
  }
  return status;
}
