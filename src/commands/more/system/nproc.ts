// nproc: print the number of processing units available, as coreutils' nproc does: the cores
// the browser reports, as /proc/cpuinfo lists them.

import { defineCommand } from '../../../shell/types';

export default defineCommand({
  name: 'nproc',
  category: 'system',
  summary: 'print the number of processing units available',
  synopsis: ['nproc [--all] [--ignore=N]'],
  description:
    "Prints how many processing units are available: the cores your browser reports (navigator.hardwareConcurrency), which /proc/cpuinfo lists one by one. --all prints the same, as every one is available. --ignore=N takes N away, leaving at least 1.",
  flags: [
    { long: 'all', description: 'print the number of installed processors' },
    { long: 'ignore', description: 'leave out N processing units if there are more', value: { name: 'N', source: { kind: 'int' } } },
  ],
  examples: [
    { line: 'nproc', offline: true },
    { line: 'nproc --ignore=1', offline: true },
  ],
  seeAlso: ['lscpu', 'free'],
  async run(ctx) {
    if (ctx.args[0] !== undefined) return ctx.usage(`extra operand '${ctx.args[0]}'`);
    let text = '';
    try {
      text = ctx.fs.readFile('/proc/cpuinfo');
    } catch {
      // No /proc: one processor, as nproc says when it cannot tell.
    }
    const count = Math.max(1, text.split('\n').filter((line) => /^processor\s*:/.test(line)).length);
    const ignore = typeof ctx.opts.ignore === 'number' ? ctx.opts.ignore : 0;
    if (ignore < 0) return ctx.fail(`invalid number: '${ignore}'`);
    await ctx.stdout.write(`${ctx.opts.all === true ? count : Math.max(1, count - ignore)}\n`);
    return 0;
  },
});
