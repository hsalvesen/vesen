// command: run a command without its alias, or with -v and -V say what a name runs, as bash's
// builtin does. The body is in command.run.ts.

import { defineCommand } from '../../shell/types';

export default defineCommand({
  name: 'command',
  category: 'shell',
  summary: 'run a command, or say what a name runs',
  synopsis: ['command [-pVv] COMMAND [ARG]...'],
  builtin: true,
  posixArgs: true,
  flags: [
    { short: 'v', description: 'print what COMMAND would run' },
    { short: 'V', description: 'describe what COMMAND would run, as type does' },
    { short: 'p', description: 'search the default $PATH (vesen keeps one)' },
  ],
  args: [
    { name: 'COMMAND', source: { kind: 'command' }, optional: true },
    { name: 'ARG', source: { kind: 'commandLine' }, optional: true, variadic: true },
  ],
  examples: [
    { line: 'command -v ls', offline: true },
    { line: 'command -v ll', note: 'an alias, as it was defined', offline: true },
    { line: 'command ls', note: 'ls itself, never an alias', offline: true },
  ],
  seeAlso: ['type', 'which', 'alias'],
  load: () => import('./command.run'),
});
