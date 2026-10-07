// wait: wait for background jobs, as bash's builtin does. vesen runs every line in the
// foreground, so there is never one to wait for.

import { defineCommand } from '../../../shell/types';

export default defineCommand({
  name: 'wait',
  category: 'shell',
  summary: 'wait for background jobs to finish',
  synopsis: ['wait [ID]...'],
  description:
    'Waits for each background job or process ID to finish, and exits with the status of the last. vesen has no job control and runs every line in the foreground, so with no ID there is nothing to wait for and wait exits 0 at once, and any ID is not a child of this shell.',
  man: [{ heading: 'EXIT STATUS', body: '0 with no ID; 127 for an ID, which is never a child of this shell.' }],
  builtin: true,
  flags: [{ short: 'n', description: 'wait for the next job to finish' }],
  args: [{ name: 'ID', source: { kind: 'int' }, optional: true, variadic: true }],
  examples: [{ line: 'wait', note: 'nothing to wait for', offline: true }],
  seeAlso: ['jobs', 'fg', 'bg'],
  async run(ctx) {
    let status = 0;
    for (const id of ctx.args) {
      if (id.startsWith('%')) status = await ctx.fail(`${id}: no such job`, 127);
      else if (/^\d+$/.test(id)) status = await ctx.fail(`pid ${id} is not a child of this shell`, 127);
      else status = await ctx.fail(`\`${id}': not a pid or valid job spec`, 2);
    }
    return status;
  },
});
