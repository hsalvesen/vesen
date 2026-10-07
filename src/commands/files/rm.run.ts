// The body of rm; its spec, in rm.ts, loads this the first time rm runs, so the kernel's chunk
// carries only the spec (and not the listing helpers that name a file's type).

import { out } from '../../output/model';
import type { CommandContext, CommandDoc, ExitCode } from '../../shell/types';
import { rmRefusal } from '../../vfs/errors';
import { join } from '../../vfs/path';
import type { Stat } from '../../vfs/types';
import { ask, childPath, errorCode, reason } from '../lib/files';
import { fileType } from '../lib/listing';

/** What --help, help and man say about rm, besides its spec (rm.ts). */
export const doc: CommandDoc = {
  description:
    'Removes each FILE. Folders need -r, which removes everything in them first, or -d when they are empty. It prints nothing when it works; -v names each thing removed. There is no bin: a removed file is gone until reset.',
  man: [
    {
      heading: 'SAFETY',
      body: "rm refuses '.' and '..', and will not work recursively on '/'. Everything else under ~ is yours to remove; reset brings the original files back.",
    },
    { heading: 'EXIT STATUS', body: '0 when every FILE was removed (or, with -f, was not there), 1 otherwise.' },
  ],
};

interface Options {
  readonly force: boolean;
  readonly interactive: boolean;
  readonly recursive: boolean;
  readonly dir: boolean;
  readonly verbose: boolean;
}

/** Removes `typed` (at `path`); returns false when something could not be removed. */
async function remove(ctx: CommandContext, typed: string, path: string, options: Options): Promise<boolean> {
  let stat: Stat;
  try {
    stat = ctx.fs.lstat(path);
  } catch (error) {
    if (options.force && errorCode(error) === 'ENOENT') return true;
    await ctx.fail(`cannot remove '${typed}': ${reason(error)}`);
    return false;
  }

  if (stat.type !== 'directory') {
    if (options.interactive && !(await ask(ctx, `rm: remove ${fileType(stat)} '${typed}'? `))) return true;
    try {
      ctx.fs.rm(path);
    } catch (error) {
      await ctx.fail(`cannot remove '${typed}': ${reason(error)}`);
      return false;
    }
    if (options.verbose) await ctx.stdout.write(`removed '${typed}'\n`);
    return true;
  }

  if (!options.recursive) {
    if (!options.dir) {
      await ctx.fail(`cannot remove '${typed}': Is a directory`);
      return false;
    }
    if (options.interactive && !(await ask(ctx, `rm: remove directory '${typed}'? `))) return true;
    return removeFolder(ctx, typed, path, options);
  }

  let names: string[];
  try {
    names = ctx.fs.readdir(path, { all: true });
  } catch (error) {
    await ctx.fail(`cannot remove '${typed}': ${reason(error)}`);
    return false;
  }
  if (options.interactive && names.length > 0 && !(await ask(ctx, `rm: descend into directory '${typed}'? `))) return true;
  let ok = true;
  for (const name of names.sort()) {
    if (ctx.signal.aborted) throw ctx.signal.reason;
    if (!(await remove(ctx, childPath(typed, name), join(path, name), options))) ok = false;
  }
  if (!ok) return false;
  if (options.interactive && !(await ask(ctx, `rm: remove directory '${typed}'? `))) return true;
  return removeFolder(ctx, typed, path, options);
}

async function removeFolder(ctx: CommandContext, typed: string, path: string, options: Options): Promise<boolean> {
  try {
    ctx.fs.rmdir(path);
  } catch (error) {
    await ctx.fail(`cannot remove '${typed}': ${reason(error)}`);
    return false;
  }
  if (options.verbose) await ctx.stdout.write(`removed directory '${typed}'\n`);
  return true;
}

export async function run(ctx: CommandContext): Promise<ExitCode> {
  const options: Options = {
    force: ctx.opts.force === true,
    interactive: ctx.opts.interactive === true && ctx.opts.force !== true,
    recursive: ctx.opts.recursive === true,
    dir: ctx.opts.dir === true,
    verbose: ctx.opts.verbose === true,
  };
  if (ctx.args.length === 0) return options.force ? 0 : ctx.usage('missing operand');
  let status = 0;
  for (const typed of ctx.args) {
    const path = ctx.resolve(typed);
    // As in GNU rm, a folder named without -r or -d is simply "Is a directory", `.` included.
    const refusal = options.recursive || options.dir ? rmRefusal(typed, path, options.recursive) : null;
    if (refusal !== null) {
      for (const line of refusal) await ctx.fail(line.replace(/^rm: /, ''));
      // `rm -rf /` at the prompt earns a wink after GNU's refusal.
      if (path === '/' && options.recursive && options.force && ctx.stderr.isTTY) await ctx.stderr.line(out.span('Nice try. / stays right where it is. ;)', { fg: 'muted' }));
      status = 1;
      continue;
    }
    if (!(await remove(ctx, typed, path, options))) status = 1;
  }
  return status;
}
