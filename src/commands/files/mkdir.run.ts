// The body of mkdir; its spec, in mkdir.ts, loads this the first time mkdir runs, so the kernel's
// chunk carries only the spec.

import type { CommandContext, CommandDoc, ExitCode } from '../../shell/types';
import { reason, tryStat } from '../lib/files';
import { parseMode } from '../lib/mode';

/** What --help, help and man say about mkdir, besides its spec (mkdir.ts). */
export const doc: CommandDoc = {
  description:
    'Creates each DIRECTORY. With -p, the folders on the way are made too, and a folder that is already there is not an error. Like Linux, it prints nothing when it works; -v says what it made.',
  man: [{ heading: 'EXIT STATUS', body: '0 when every DIRECTORY was made, 1 otherwise.' }],
};

/** Each folder on the way to `typed`, as typed: a/b/c gives a, a/b, a/b/c. */
export function prefixes(typed: string): string[] {
  const parts = typed.split('/').filter((part) => part !== '');
  let at = typed.startsWith('/') ? '/' : '';
  return parts.map((part) => {
    at = at === '' ? part : at.endsWith('/') ? `${at}${part}` : `${at}/${part}`;
    return at;
  });
}

export async function run(ctx: CommandContext): Promise<ExitCode> {
  if (ctx.args.length === 0) return ctx.usage('missing operand');
  const modeText = typeof ctx.opts.mode === 'string' ? ctx.opts.mode : undefined;
  let mode: number | undefined;
  if (modeText !== undefined) {
    const parsed = parseMode(modeText, 0o777 & ~0o022, true);
    if (parsed === null) return ctx.fail(`invalid mode '${modeText}'`);
    mode = parsed;
  }
  const verbose = ctx.opts.verbose === true;
  const parents = ctx.opts.parents === true;
  let status = 0;

  const make = async (typed: string, shownAs: string): Promise<boolean> => {
    try {
      ctx.fs.mkdir(ctx.resolve(typed));
    } catch (error) {
      status = await ctx.fail(`cannot create directory '${shownAs}': ${reason(error)}`);
      return false;
    }
    if (verbose) await ctx.stdout.write(`mkdir: created directory '${typed}'\n`);
    return true;
  };

  const finish = async (typed: string): Promise<void> => {
    if (mode === undefined) return;
    try {
      ctx.fs.chmod(ctx.resolve(typed), mode);
    } catch (error) {
      status = await ctx.fail(`cannot set permissions of '${typed}': ${reason(error)}`);
    }
  };

  for (const typed of ctx.args) {
    if (!parents) {
      if (await make(typed, typed)) await finish(typed);
      continue;
    }
    const steps = prefixes(typed);
    for (const [i, step] of steps.entries()) {
      const last = i === steps.length - 1;
      const found = tryStat(ctx, ctx.resolve(step));
      if (found?.type === 'directory') continue;
      if (found !== null) {
        status = await ctx.fail(`cannot create directory '${typed}': ${last ? 'File exists' : 'Not a directory'}`);
        break;
      }
      if (!(await make(step, last ? typed : step))) break;
      if (last) await finish(typed);
    }
  }
  return status;
}
