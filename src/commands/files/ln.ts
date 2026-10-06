// ln: make links, as GNU ln -s does: TARGET to LINK_NAME, TARGET into the working directory, or
// TARGETs into a folder. The target is stored as typed, so a relative one is read from where
// the link is. The VFS has no hard links, so ln without -s says so in Linux's words.

import { out } from '../../output/model';
import { defineCommand } from '../../shell/types';
import { basename } from '../../vfs/path';
import { childPath, reason, tryLstat, tryStat } from '../lib/files';

export default defineCommand({
  name: 'ln',
  category: 'files',
  summary: 'make links between files',
  synopsis: ['ln -s [OPTION]... TARGET [LINK_NAME]', 'ln -s [OPTION]... TARGET... DIRECTORY'],
  description:
    'With -s, makes LINK_NAME a symbolic link to TARGET: opening the link opens TARGET. With no LINK_NAME, the link is made here, with TARGET\'s name; with a DIRECTORY, inside it. A relative TARGET is read from the folder the link is in. Hard links are not available here, so -s is needed.',
  flags: [
    { short: 'f', long: 'force', description: 'replace a file that is already at LINK_NAME' },
    { short: 's', long: 'symbolic', description: 'make symbolic links' },
    { short: 'v', long: 'verbose', description: 'print the name of each link made' },
  ],
  args: [
    { name: 'TARGET', source: { kind: 'path', accept: 'any' } },
    { name: 'LINK_NAME', source: { kind: 'path', accept: 'any' }, optional: true, variadic: true },
  ],
  examples: [
    { line: 'ln -s documents/linux.txt linux', note: 'linux now opens documents/linux.txt', offline: true },
    { line: 'ln -sv /etc/hostname', note: 'a link called hostname, here', offline: true },
  ],
  seeAlso: ['ls', 'stat', 'cp'],
  man: [{ heading: 'EXIT STATUS', body: '0 when every link was made, 1 otherwise.' }],
  async run(ctx) {
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
  },
});
