// touch: change file timestamps, creating files that are not there, as GNU touch does (F019):
// every operand, folders too, -c to create nothing, and silent on success.

import { defineCommand } from '../../shell/types';
import { reason, tryStat } from '../lib/files';

export default defineCommand({
  name: 'touch',
  category: 'files',
  summary: 'change file timestamps, or create files',
  synopsis: ['touch [OPTION]... FILE...'],
  description:
    "Sets each FILE's modification time to now. A FILE that does not exist is created empty, unless -c is given. It works on folders too, and prints nothing when it works.",
  flags: [{ short: 'c', long: 'no-create', description: 'do not create any files' }],
  args: [{ name: 'FILE', source: { kind: 'path', accept: 'any' }, variadic: true }],
  examples: [
    { line: 'touch notes.txt', note: 'a new empty file', offline: true },
    { line: 'touch a.txt b.txt c.txt', offline: true },
    { line: 'touch -c missing.txt', note: 'nothing is created', offline: true },
  ],
  seeAlso: ['ls', 'mkdir', 'stat'],
  man: [{ heading: 'EXIT STATUS', body: '0 when every FILE was touched (or, with -c, skipped), 1 otherwise.' }],
  async run(ctx) {
    if (ctx.args.length === 0) return ctx.usage('missing file operand');
    let status = 0;
    for (const typed of ctx.args) {
      const path = ctx.resolve(typed);
      const existed = tryStat(ctx, path) !== null;
      if (ctx.opts['no-create'] === true && !existed) continue;
      try {
        ctx.fs.touch(path);
      } catch (error) {
        // GNU's two messages: one for a file it could not make, one for times it could not set.
        status = await ctx.fail(existed ? `setting times of '${typed}': ${reason(error)}` : `cannot touch '${typed}': ${reason(error)}`);
      }
    }
    return status;
  },
});
