// The body of cp; its spec, in cp.ts, loads this the first time cp runs, so the
// kernel's chunk carries only the spec.

import type { CommandContext, ExitCode } from '../../shell/types';
import { basename, isWithin, join } from '../../vfs/path';
import type { Stat } from '../../vfs/types';
import { childPath, errorCode, realOrSelf, reason, tryLstat, tryStat } from '../lib/files';

interface Options {
  readonly recursive: boolean;
  readonly noClobber: boolean;
  readonly verbose: boolean;
}

/** Copies `from` to `to`, folders recursively; false when anything could not be copied. */
async function copy(ctx: CommandContext, from: { typed: string; path: string; stat: Stat }, to: { typed: string; path: string }, options: Options): Promise<boolean> {
  const existing = tryLstat(ctx, to.path);
  if (from.stat.type === 'directory') {
    if (existing !== null && tryStat(ctx, to.path)?.type !== 'directory') {
      await ctx.fail(`cannot overwrite non-directory '${to.typed}' with directory '${from.typed}'`);
      return false;
    }
    if (existing === null) {
      try {
        ctx.fs.mkdir(to.path, { mode: from.stat.mode });
      } catch (error) {
        await ctx.fail(`cannot create directory '${to.typed}': ${reason(error)}`);
        return false;
      }
      if (options.verbose) await ctx.stdout.write(`'${from.typed}' -> '${to.typed}'\n`);
    }
    let names: string[];
    try {
      names = ctx.fs.readdir(from.path, { all: true });
    } catch (error) {
      await ctx.fail(`cannot access '${from.typed}': ${reason(error)}`);
      return false;
    }
    let ok = true;
    for (const name of names.sort()) {
      if (ctx.signal.aborted) throw ctx.signal.reason;
      const path = join(from.path, name);
      const stat = tryLstat(ctx, path);
      if (stat === null) continue;
      const done = await copy(ctx, { typed: childPath(from.typed, name), path, stat }, { typed: childPath(to.typed, name), path: join(to.path, name) }, options);
      if (!done) ok = false;
    }
    return ok;
  }

  if (existing !== null) {
    if (options.noClobber) return true;
    if (tryStat(ctx, to.path)?.type === 'directory') {
      await ctx.fail(`cannot overwrite directory '${to.typed}' with non-directory`);
      return false;
    }
  }
  try {
    if (from.stat.type === 'symlink') {
      // Inside a recursive copy a link is copied as a link, as cp -r does.
      if (existing !== null) ctx.fs.rm(to.path);
      ctx.fs.symlink(ctx.fs.readlink(from.path), to.path);
    } else {
      ctx.fs.copy(from.path, to.path);
    }
  } catch (error) {
    const code = errorCode(error);
    const fromSource = error instanceof Error && 'path' in error && (error as { path: string }).path === from.path;
    if (fromSource || (code === 'EACCES' && !ctx.fs.access(from.path, 'r'))) {
      await ctx.fail(`cannot open '${from.typed}' for reading: ${reason(error)}`);
    } else {
      await ctx.fail(`cannot create regular file '${to.typed}': ${reason(error)}`);
    }
    return false;
  }
  if (options.verbose) await ctx.stdout.write(`'${from.typed}' -> '${to.typed}'\n`);
  return true;
}

/** Runs cp. */
export async function run(ctx: CommandContext): Promise<ExitCode | void> {
  const options: Options = { recursive: ctx.opts.recursive === true, noClobber: ctx.opts['no-clobber'] === true, verbose: ctx.opts.verbose === true };
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
      // With -r a link named on the command line is copied as a link; without, what it points to.
      stat = options.recursive ? ctx.fs.lstat(path) : ctx.fs.stat(path);
    } catch (error) {
      status = await ctx.fail(`cannot stat '${source}': ${reason(error)}`);
      continue;
    }
    if (stat.type === 'directory' && !options.recursive) {
      status = await ctx.fail(`-r not specified; omitting directory '${source}'`);
      continue;
    }
    const target = intoFolder ? { typed: childPath(dest, basename(source)), path: join(destPath, basename(source)) } : { typed: dest, path: destPath };
    const targetReal = realOrSelf(ctx, target.path);
    if (tryLstat(ctx, target.path) !== null && realOrSelf(ctx, path) === targetReal) {
      status = await ctx.fail(`'${source}' and '${target.typed}' are the same file`);
      continue;
    }
    if (stat.type === 'directory' && isWithin(targetReal, realOrSelf(ctx, path))) {
      status = await ctx.fail(`cannot copy a directory, '${source}', into itself, '${target.typed}'`);
      continue;
    }
    if (!(await copy(ctx, { typed: source, path, stat }, target, options))) status = 1;
  }
  return status;
}
