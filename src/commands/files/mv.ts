// mv: move (rename) files, as GNU mv does: SOURCE to DEST, or SOURCEs into a folder; -n to keep
// what is there; silent unless -v. Moving the folder you are in leaves the prompt where it was,
// as on Linux, until you cd somewhere real.

import { defineCommand } from '../../shell/types';
import { basename, isWithin, join } from '../../vfs/path';
import type { Stat } from '../../vfs/types';
import { childPath, entryPath, errorCode, realOrSelf, reason, tryLstat, tryStat } from '../lib/files';

export default defineCommand({
  name: 'mv',
  category: 'files',
  summary: 'move or rename files',
  synopsis: ['mv [OPTION]... SOURCE DEST', 'mv [OPTION]... SOURCE... DIRECTORY'],
  description:
    'Renames SOURCE to DEST, or moves each SOURCE into DIRECTORY. A file at DEST is replaced, unless -n is given. It prints nothing when it works; -v says what moved.',
  flags: [
    { short: 'f', long: 'force', description: 'do not ask before overwriting (mv never asks here)' },
    { short: 'n', long: 'no-clobber', description: 'do not overwrite a file that exists' },
    { short: 'v', long: 'verbose', description: 'say what is being moved' },
  ],
  // SOURCE... DEST: the last word is the destination, so the one variadic argument covers both.
  args: [{ name: 'SOURCE', source: { kind: 'path', accept: 'any' }, variadic: true }],
  examples: [
    { line: 'mv history.txt documents/', note: 'into a folder', offline: true },
    { line: 'mv -v README.md readme.md', note: 'rename', offline: true },
  ],
  seeAlso: ['cp', 'rm', 'ln'],
  man: [{ heading: 'EXIT STATUS', body: '0 when everything was moved, 1 otherwise.' }],
  async run(ctx) {
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
  },
});
