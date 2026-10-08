// tty: print the name of the terminal standard input is, as coreutils' tty does: /dev/pts/0,
// which is in /dev and is the terminal ps and who name, when typed at the prompt; `not a tty` in
// a pipe or from a file.

import { defineCommand } from '../../../shell/types';
import { TERMINAL } from '../../../vfs/identity';

export default defineCommand({
  name: 'tty',
  category: 'system',
  summary: 'print the terminal connected to standard input',
  synopsis: ['tty [-s]'],
  description:
    'Prints the file name of the terminal standard input comes from: /dev/pts/0 when you type at the prompt. When standard input is a pipe, a file or a here-string, prints `not a tty` and exits 1. With -s, prints nothing and only exits 0 or 1.',
  man: [{ heading: 'EXIT STATUS', body: '0 when standard input is a terminal, 1 when it is not, 2 for bad options.' }],
  usageStatus: 2,
  flags: [{ short: 's', long: 'silent', description: 'print nothing, only return an exit status' }],
  examples: [
    { line: 'tty', note: 'at the prompt: /dev/pts/0' },
    { line: "tty -s && echo 'at a terminal' || echo 'not a terminal'", offline: true },
    { line: 'echo | tty || true', note: 'a pipe is not a terminal', offline: true },
  ],
  seeAlso: ['who', 'ps'],
  async run(ctx) {
    if (ctx.args[0] !== undefined) return ctx.usage(`extra operand '${ctx.args[0]}'`);
    const terminal = ctx.stdin.isTTY;
    if (ctx.opts.silent !== true) await ctx.stdout.write(terminal ? `/dev/${TERMINAL}\n` : 'not a tty\n');
    return terminal ? 0 : 1;
  },
});
