// pwd: print the working directory. -P resolves symbolic links, as /bin/pwd does.

import { defineCommand } from '../../shell/types';
import { strerror } from '../../vfs/errors';
import { VfsError } from '../../vfs/types';

export default defineCommand({
  name: 'pwd',
  category: 'files',
  // A usage error exits 2, as bash builtins do.
  usageStatus: 2,
  summary: 'print the working directory',
  synopsis: ['pwd [-L|-P]'],
  description: 'Prints the full path of the working directory: the one the prompt shows, with ~ written out.',
  flags: [
    { short: 'L', description: 'print the path with its symbolic links (the default)' },
    { short: 'P', description: 'print the physical path, with links resolved' },
  ],
  examples: [{ line: 'pwd', offline: true }, { line: 'pwd -P', offline: true }],
  seeAlso: ['cd', 'ls'],
  async run(ctx) {
    let path = ctx.shell.cwd();
    if (ctx.opts.P === true) {
      try {
        path = ctx.fs.realpath(path);
      } catch (error) {
        if (!(error instanceof VfsError)) throw error;
        return ctx.fail(`error retrieving current directory: getcwd: cannot access parent directories: ${strerror(error.code)}`);
      }
    }
    await ctx.stdout.write(`${path}\n`);
    return 0;
  },
});
