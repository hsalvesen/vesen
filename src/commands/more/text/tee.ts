// tee: copy standard input to each FILE, and also to standard output. Small enough to keep its
// body here.

import { defineCommand } from '../../../shell/types';
import { reason } from '../../lib/files';

export default defineCommand({
  name: 'tee',
  category: 'text',
  summary: 'copy standard input to files and the screen',
  synopsis: ['tee [OPTION]... [FILE]...'],
  description:
    'Copies standard input to standard output, and to each FILE as well, as it arrives. Each FILE is emptied first, unless -a is given, which adds to its end instead. A FILE that cannot be written is reported, and the rest are still written.',
  flags: [
    { short: 'a', long: 'append', description: 'append to the given FILEs, do not overwrite' },
    { short: 'i', long: 'ignore-interrupts', description: 'ignore interrupt signals' },
  ],
  args: [{ name: 'FILE', source: { kind: 'path' }, optional: true, variadic: true }],
  examples: [
    { line: 'echo hello | tee greeting.txt', note: 'to the screen and a file', offline: true },
    { line: 'seq 3 | tee -a log.txt | wc -l', note: 'add to a file in the middle of a pipe', offline: true },
  ],
  seeAlso: ['cat', 'echo'],
  man: [{ heading: 'EXIT STATUS', body: '0 when every FILE was written, 1 when any could not be.' }],
  async run(ctx) {
    const append = ctx.opts.append === true;
    let status = 0;
    const open: { name: string; path: string }[] = [];
    for (const name of ctx.args) {
      const path = ctx.resolve(name);
      try {
        // Created, or emptied, before anything arrives, as tee opens its files first.
        ctx.fs.writeFile(path, '', { append });
        open.push({ name, path });
      } catch (error) {
        status = await ctx.fail(`${name}: ${reason(error)}`);
      }
    }
    for await (const chunk of ctx.stdin.chunks()) {
      for (const file of [...open]) {
        try {
          ctx.fs.writeFile(file.path, chunk, { append: true });
        } catch (error) {
          status = await ctx.fail(`${file.name}: ${reason(error)}`);
          open.splice(open.indexOf(file), 1);
        }
      }
      await ctx.stdout.write(chunk);
    }
    return status;
  },
});
