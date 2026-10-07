// bg: resume a job in the background, as bash's builtin does. vesen has no job control, so it
// says so, as bash does where there is none.

import { defineCommand } from '../../../shell/types';

export default defineCommand({
  name: 'bg',
  category: 'shell',
  summary: 'resume a job in the background',
  synopsis: ['bg [JOBSPEC]...'],
  description:
    'Resumes each JOBSPEC, or the current job, in the background, as if it had been started with &. vesen has no job control: it runs one line at a time in the foreground, so there is never a stopped job to resume, and bg says so.',
  man: [{ heading: 'EXIT STATUS', body: '1: there is no job control.' }],
  builtin: true,
  args: [{ name: 'JOBSPEC', source: { kind: 'free', placeholder: '%1' }, optional: true, variadic: true }],
  examples: [{ line: "bg || echo 'no background here'", offline: true }],
  seeAlso: ['fg', 'jobs', 'wait'],
  run: (ctx) => ctx.fail('no job control'),
});
