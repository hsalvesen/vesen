// find: search for files in a folder tree, as GNU find does: tests, operators and actions, -exec
// through the shell, and -delete; the body, with the expression's parser, is in find.run.ts.

import type { RawArgsSpec } from '../../../shell/flags';
import { defineCommand, type CommandSpec, type RunnerChoice } from '../../../shell/types';

// The expression is read by the body: -name, -type and the rest are not options in getopt's sense.
const spec: CommandSpec & RawArgsSpec & RunnerChoice = {
  name: 'find',
  category: 'files',
  // Named in help's short index, where the catalogue's other file tools are counted.
  featured: true,
  summary: 'search for files in a folder tree',
  synopsis: ['find [-H] [-L] [-P] [STARTING-POINT...] [EXPRESSION]'],
  rawArgs: true,
  handlesHelp: true,
  args: [
    { name: 'STARTING-POINT', source: { kind: 'path', accept: 'any' }, optional: true },
    { name: 'EXPRESSION', source: { kind: 'free', placeholder: "-name '*.txt'" }, optional: true, variadic: true },
  ],
  examples: [
    { line: "find . -name '*.txt'", note: 'by name, anywhere below', offline: true },
    { line: 'find ~ -maxdepth 1 -type d', note: 'folders, one level down', offline: true },
    { line: 'find ~ -type f -size +1k', note: 'files over 1 KiB', offline: true },
    { line: "find . -name '*.sh' -exec ls -l {} +", note: 'run a command on what it finds', offline: true },
    { line: 'find ~ -type f \\( -perm -u+x -o -empty \\) -ls', note: 'programs and empty files', offline: true },
    { line: 'find downloads -type f -delete', note: 'remove what it finds', offline: true },
  ],
  seeAlso: ['ls', 'tree', 'du'],
  load: () => import('./find.run'),
};

export default defineCommand(spec);
