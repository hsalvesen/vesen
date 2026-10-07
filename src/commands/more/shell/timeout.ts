// timeout: run a command with a time limit, as coreutils' timeout does: when the time is up the
// command is stopped, as ^C would stop it, and timeout exits 124. The body is in timeout.run.ts.

import { defineCommand } from '../../../shell/types';

export default defineCommand({
  name: 'timeout',
  category: 'shell',
  summary: 'run a command with a time limit',
  synopsis: ['timeout [OPTION]... DURATION COMMAND [ARG]...'],
  posixArgs: true,
  usageStatus: 125,
  flags: [
    { short: 's', long: 'signal', description: 'the signal to stop it with: TERM unless given', value: { name: 'SIGNAL', source: { kind: 'free', placeholder: 'TERM' } } },
    { short: 'k', long: 'kill-after', description: 'send KILL if it is still running DURATION later', value: { name: 'DURATION', source: { kind: 'free', placeholder: '5s' } } },
    { long: 'preserve-status', description: "exit with the command's status even when it timed out" },
    { long: 'foreground', description: 'let the command read from the terminal' },
    { short: 'v', long: 'verbose', description: 'say when the signal is sent' },
  ],
  args: [
    { name: 'DURATION', source: { kind: 'free', placeholder: '10s' } },
    { name: 'COMMAND', source: { kind: 'commandLine' }, variadic: true },
  ],
  examples: [
    { line: 'timeout 0.5 sleep 3; echo $?', note: '124: it ran out of time', offline: true },
    { line: 'timeout 5 echo in time', offline: true },
  ],
  seeAlso: ['time', 'sleep', 'kill'],
  load: () => import('./timeout.run'),
});
