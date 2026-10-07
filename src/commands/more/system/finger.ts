// finger: user information lookup, as BSD's finger does: `finger has` reads the owner's .plan
// and about.md. The body is in finger.run.ts.

import { defineCommand } from '../../../shell/types';

export default defineCommand({
  name: 'finger',
  category: 'system',
  summary: 'user information lookup',
  synopsis: ['finger [-l | -s] [-m] [USER]...'],
  flags: [
    { short: 'l', description: 'the long format, as for a named USER' },
    { short: 's', description: 'the short format, one line a user' },
    { short: 'm', description: 'match USER against login names only, not real names' },
  ],
  args: [{ name: 'USER', source: { kind: 'user' }, optional: true, variadic: true }],
  examples: [
    { line: 'finger has', note: 'the owner, with his plan', offline: true },
    { line: 'finger', note: 'who is logged on', offline: true },
  ],
  seeAlso: ['who', 'id', 'about'],
  // After the owner's plan, the ways to reach him.
  next: ({ status, argv }) => (status === 0 && argv.includes('has') ? ['about', 'contact'] : []),
  load: () => import('./finger.run'),
});
