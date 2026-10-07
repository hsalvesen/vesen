// jobs: list the background jobs, as bash's builtin does. vesen has no job control, so there are
// none; at the prompt, a dim line says why.

import { out } from '../../../output/model';
import { defineCommand } from '../../../shell/types';

export default defineCommand({
  name: 'jobs',
  category: 'shell',
  summary: 'list the background jobs',
  synopsis: ['jobs [-lnprs] [JOBSPEC]...'],
  description:
    "Lists the jobs running in the background or stopped. vesen has no job control: it runs one line at a time in the foreground, and a line ending in & runs in the foreground too, so there are never any jobs to list. At the prompt jobs says so; in a pipe or a script it prints nothing, as bash does with no jobs.",
  man: [{ heading: 'EXIT STATUS', body: '0, or 1 for a JOBSPEC, which never names a job.' }],
  builtin: true,
  flags: [
    { short: 'l', description: 'list process ids too' },
    { short: 'p', description: 'list only process ids' },
    { short: 'n', description: 'list only jobs that changed' },
    { short: 'r', description: 'list only running jobs' },
    { short: 's', description: 'list only stopped jobs' },
  ],
  args: [{ name: 'JOBSPEC', source: { kind: 'free', placeholder: '%1' }, optional: true, variadic: true }],
  examples: [{ line: 'jobs', offline: true }],
  seeAlso: ['fg', 'bg', 'wait', 'ps'],
  async run(ctx) {
    let status = 0;
    for (const spec of ctx.args) status = await ctx.fail(`${spec}: no such job`);
    if (ctx.args.length === 0 && ctx.stdout.isTTY && ctx.tty.interactive) {
      await ctx.stdout.block(out.text('No jobs: vesen has no job control, so every line runs in the foreground.', { fg: 'muted' }));
    }
    return status;
  },
});
