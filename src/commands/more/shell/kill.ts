// kill: send a signal to a process, as bash's builtin does, over the table ps shows: init
// refuses, the shell ignores what an interactive shell ignores, and a command of the running line
// ends the line. It reads its own words (`kill -9 PID`). The body is in kill.run.ts.

import type { RawArgsSpec } from '../../../shell/flags';
import type { CommandSpec, RunnerChoice } from '../../../shell/types';

const spec: CommandSpec & RawArgsSpec & RunnerChoice = {
  name: 'kill',
  category: 'shell',
  summary: 'send a signal to a process',
  synopsis: ['kill [-s SIGSPEC | -n SIGNUM | -SIGSPEC] PID...', 'kill -l [SIGSPEC]'],
  builtin: true,
  rawArgs: true,
  flags: [
    { short: 's', description: 'send the signal named SIGSPEC', value: { name: 'SIGSPEC', source: { kind: 'free', placeholder: 'TERM' } } },
    { short: 'n', description: 'send the signal numbered SIGNUM', value: { name: 'SIGNUM', source: { kind: 'int' } } },
    { short: 'l', description: 'list the signals, or name the one numbered SIGSPEC' },
    { short: 'L', description: 'the same as -l' },
  ],
  args: [{ name: 'PID', source: { kind: 'int' }, variadic: true }],
  examples: [
    { line: 'kill -l', note: 'the signals', offline: true },
    { line: 'kill -l 9', offline: true },
    { line: 'kill -0 $$', note: 'is the shell there?', offline: true },
    { line: 'kill 1', note: 'init is not yours to stop' },
  ],
  seeAlso: ['ps', 'pkill', 'pgrep', 'timeout'],
  load: () => import('./kill.run'),
};

export default spec;
