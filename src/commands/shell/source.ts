// source and `.`: run a file's lines in this shell, so the aliases and variables it sets stay,
// as bash's builtin does. Login reads /etc/profile and ~/.bashrc this way.

import { out } from '../../output/model';
import { defineCommand } from '../../shell/types';

export default defineCommand({
  name: 'source',
  aliases: ['.'],
  category: 'shell',
  summary: 'run the lines of a file in this shell',
  synopsis: ['source FILE [ARG]...', '. FILE [ARG]...'],
  description:
    'Reads FILE and runs its lines in this shell, so what it defines (aliases, variables, the folder it moves to) stays. ARGs are $1, $2 and so on while it runs. A FILE without a slash that is not here is looked for on $PATH.',
  builtin: true,
  posixArgs: true,
  args: [
    { name: 'FILE', source: { kind: 'path', accept: 'file' } },
    { name: 'ARG', source: { kind: 'free', placeholder: 'arg' }, optional: true, variadic: true },
  ],
  examples: [
    { line: 'source ~/.bashrc', note: 'read the aliases again', offline: true },
    { line: '. /etc/profile', offline: true },
  ],
  seeAlso: ['alias', 'export'],
  async run(ctx) {
    const [file, ...args] = ctx.args;
    if (file === undefined) {
      await ctx.stderr.line(out.span(`vesen: ${ctx.name}: filename argument required`, { fg: 'error' }));
      await ctx.stderr.line(out.span(`${ctx.name}: usage: ${ctx.name} filename [arguments]`, { fg: 'muted' }));
      return 2;
    }
    return ctx.shell.source(file, args.length > 0 ? args : undefined);
  },
});
