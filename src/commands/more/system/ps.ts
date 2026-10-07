// ps: report a snapshot of the current processes, as procps' ps does, in its Unix (-ef) and BSD
// (aux) styles: init, the shell, and the commands of the line running now. It reads its own
// words, as procps does, because `ps aux` has no dash. The body is in ps.run.ts.

import type { RawArgsSpec } from '../../../shell/flags';
import type { CommandSpec, RunnerChoice } from '../../../shell/types';

const spec: CommandSpec & RawArgsSpec & RunnerChoice = {
  name: 'ps',
  category: 'system',
  summary: 'report a snapshot of the current processes',
  synopsis: ['ps [-e] [-f] [-p PID[,PID]...] [-u USER]', 'ps [a][u][x]'],
  rawArgs: true,
  flags: [
    { short: 'e', description: 'every process (also -A)' },
    { short: 'f', description: 'the full format: UID, PID, PPID, C, STIME, TTY, TIME and CMD' },
    { short: 'p', description: 'only the processes with these ids', value: { name: 'PID', source: { kind: 'int' } } },
    { short: 'u', description: 'only the processes of USER', value: { name: 'USER', source: { kind: 'user' } } },
  ],
  args: [{ name: 'aux', source: { kind: 'enum', values: () => [{ value: 'aux', summary: 'every process, with users and memory' }] }, optional: true }],
  examples: [
    { line: 'ps', offline: true },
    { line: 'ps aux', note: 'every process, BSD style', offline: true },
    { line: 'ps -ef', note: 'every process, Unix style', offline: true },
  ],
  seeAlso: ['top', 'kill', 'pgrep', 'w'],
  load: () => import('./ps.run'),
};

export default spec;
