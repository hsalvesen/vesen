// watch: run a command again and again, showing its output, as procps' watch does, until ^C.
// The body is in watch.run.ts.

import { defineCommand } from '../../../shell/types';

export default defineCommand({
  name: 'watch',
  category: 'shell',
  summary: 'run a command again and again, showing its output',
  synopsis: ['watch [-tg] [-n SECONDS] [-q CYCLES] COMMAND'],
  posixArgs: true,
  flags: [
    { short: 'n', long: 'interval', description: 'the seconds between runs: 2 unless given, 0.1 at least', value: { name: 'SECONDS', source: { kind: 'free', placeholder: '2' } } },
    { short: 't', long: 'no-title', description: 'leave out the title line' },
    { short: 'g', long: 'chgexit', description: "stop when the command's output changes" },
    { short: 'q', long: 'equexit', description: "stop when the output has not changed for CYCLES runs", value: { name: 'CYCLES', source: { kind: 'int' } } },
    { short: 'b', long: 'beep', description: 'ring the bell when the command fails' },
  ],
  args: [{ name: 'COMMAND', source: { kind: 'commandLine' }, variadic: true }],
  loadingLabel: () => 'watch: ^C to stop',
  examples: [
    { line: 'watch -n 1 date', note: 'the time, every second, until ^C' },
    { line: 'watch -n 0.5 -q 1 who', note: 'until who stops changing', offline: true },
  ],
  seeAlso: ['sleep', 'timeout', 'top'],
  load: () => import('./watch.run'),
});
