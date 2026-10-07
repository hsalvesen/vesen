// sync: flush file system buffers. vesen saves the files under ~ to the browser's storage within
// a third of a second of each change, so there is nothing to wait for: sync checks its FILEs exist,
// as GNU sync opens them, and is done.

import { defineCommand } from '../../../shell/types';
import { reason } from '../../lib/files';

export default defineCommand({
  name: 'sync',
  category: 'files',
  summary: 'flush file system buffers',
  synopsis: ['sync [OPTION] [FILE]...'],
  description:
    'Writes what is waiting to be saved to storage. vesen saves your files under ~ to this browser within a third of a second of each change, so sync has nothing to wait for; with FILEs it checks that each one exists.',
  flags: [
    { short: 'd', long: 'data', description: "sync only each FILE's data" },
    { short: 'f', long: 'file-system', description: 'sync the file systems each FILE is on' },
  ],
  args: [{ name: 'FILE', source: { kind: 'path', accept: 'any' }, optional: true, variadic: true }],
  examples: [
    { line: 'sync', offline: true },
    { line: 'sync README.md', offline: true },
  ],
  seeAlso: ['df'],
  async run(ctx) {
    let status = 0;
    for (const typed of ctx.args) {
      try {
        ctx.fs.stat(ctx.resolve(typed));
      } catch (error) {
        status = await ctx.fail(`error opening '${typed}': ${reason(error)}`);
      }
    }
    return status;
  },
});
