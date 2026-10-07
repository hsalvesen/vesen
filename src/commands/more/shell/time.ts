// time: run a command and report how long it took, as bash's `time` does, after it on standard
// error. A builtin, which runs the rest of its line in the shell. The body is in time.run.ts.

import type { RawArgsSpec } from '../../../shell/flags';
import type { CommandSpec, RunnerChoice } from '../../../shell/types';

// Its words are a command line, taken as they are: `time ls -la` times `ls -la`.
const spec: CommandSpec & RawArgsSpec & RunnerChoice = {
  name: 'time',
  category: 'shell',
  summary: 'run a command and report how long it took',
  synopsis: ['time [-p] COMMAND [ARG]...'],
  builtin: true,
  rawArgs: true,
  flags: [{ short: 'p', description: "print the times in POSIX's format" }],
  args: [{ name: 'COMMAND', source: { kind: 'commandLine' }, optional: true, variadic: true }],
  examples: [
    { line: 'time sleep 0.2', offline: true },
    { line: 'time -p ls /', note: "POSIX's format", offline: true },
  ],
  seeAlso: ['timeout', 'sleep', 'date'],
  load: () => import('./time.run'),
};

export default spec;
