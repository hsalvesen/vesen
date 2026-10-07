// pgrep: look up processes by name, as procps' pgrep does, over the table ps shows. The body,
// shared with pkill, is in pgrep.run.ts.

import type { RawArgsSpec } from '../../../shell/flags';
import type { CommandSpec, RunnerChoice } from '../../../shell/types';

/** The options pgrep and pkill share; pkill also takes a signal. */
export const MATCH_FLAGS: CommandSpec['flags'] = [
  { short: 'f', long: 'full', description: 'match against the whole command line, not only the name' },
  { short: 'x', long: 'exact', description: 'match only names that are exactly PATTERN' },
  { short: 'i', long: 'ignore-case', description: 'match without regard to case' },
  { short: 'v', long: 'inverse', description: 'select the processes that do not match' },
  { short: 'n', long: 'newest', description: 'select only the newest of them' },
  { short: 'o', long: 'oldest', description: 'select only the oldest of them' },
  { short: 'u', long: 'euid', description: 'only the processes of these users', value: { name: 'USER', source: { kind: 'user' } } },
];

const spec: CommandSpec & RawArgsSpec & RunnerChoice = {
  name: 'pgrep',
  category: 'system',
  summary: 'look up processes by name',
  synopsis: ['pgrep [OPTION]... PATTERN'],
  rawArgs: true,
  usageStatus: 2,
  flags: [
    ...(MATCH_FLAGS ?? []),
    { short: 'l', long: 'list-name', description: 'print the name beside each pid' },
    { short: 'a', long: 'list-full', description: 'print the whole command line beside each pid' },
    { short: 'c', long: 'count', description: 'print how many match, not their pids' },
    { short: 'd', long: 'delimiter', description: 'put STRING between the pids, not a newline', value: { name: 'STRING', source: { kind: 'free', placeholder: ',' } } },
  ],
  args: [{ name: 'PATTERN', source: { kind: 'free', placeholder: 'name' } }],
  examples: [
    { line: 'pgrep -l vesh', note: 'the shell', offline: true },
    { line: 'pgrep -a -u root .', note: "root's processes", offline: true },
  ],
  seeAlso: ['pkill', 'ps', 'kill'],
  load: () => import('./pgrep.run'),
};

export default spec;
