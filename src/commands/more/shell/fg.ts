// fg: move a job to the foreground, as bash's builtin does. vesen has no job control, so it
// says so, as bash does where there is none.

import { defineCommand } from '../../../shell/types';

export default defineCommand({
  name: 'fg',
  category: 'shell',
  summary: 'move a job to the foreground',
  synopsis: ['fg [JOBSPEC]'],
  description:
    'Moves JOBSPEC, or the current job, to the foreground. vesen has no job control: every line already runs in the foreground, one at a time, so there is never a job to move, and fg says so.',
  man: [{ heading: 'EXIT STATUS', body: '1: there is no job control.' }],
  builtin: true,
  args: [{ name: 'JOBSPEC', source: { kind: 'free', placeholder: '%1' }, optional: true }],
  examples: [{ line: "fg || echo 'every line runs in the foreground'", offline: true }],
  seeAlso: ['bg', 'jobs', 'wait'],
  run: (ctx) => ctx.fail('no job control'),
});
