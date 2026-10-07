// pkill: signal processes by name, as procps' pkill does, over the table ps shows. Its body is
// pgrep's (pgrep.run.ts).

import type { RawArgsSpec } from '../../../shell/flags';
import type { CommandSpec, RunnerChoice } from '../../../shell/types';
import { MATCH_FLAGS } from './pgrep';

const spec: CommandSpec & RawArgsSpec & RunnerChoice = {
  name: 'pkill',
  category: 'system',
  summary: 'signal processes by name',
  synopsis: ['pkill [-SIGNAL] [OPTION]... PATTERN'],
  rawArgs: true,
  usageStatus: 2,
  flags: [
    ...(MATCH_FLAGS ?? []),
    { long: 'signal', description: 'the signal to send, by name or number: TERM unless given', value: { name: 'SIGNAL', source: { kind: 'free', placeholder: 'TERM' } } },
    { short: 'e', long: 'echo', description: 'say which processes were signalled' },
  ],
  args: [{ name: 'PATTERN', source: { kind: 'free', placeholder: 'name' } }],
  examples: [{ line: 'pkill -0 vesh', note: 'signal 0 only asks whether it is there', offline: true }],
  seeAlso: ['pgrep', 'kill', 'ps'],
  load: () => import('./pgrep.run').then(({ runPkill, pkillDoc }) => ({ run: runPkill, doc: pkillDoc })),
};

export default spec;
