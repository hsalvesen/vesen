// set: list the shell's variables, or turn its options on and off, as bash's builtin does. vesen
// has two options: noclobber (-C), which stops > overwriting a file, and noglob (-f), which turns
// off pathname expansion. Positional parameters are not supported, and say so.

import type { RawArgsSpec } from '../../shell/flags';
import { defineCommand, type CommandSpec, type RunnerChoice } from '../../shell/types';

/** The options set -o knows, as its completion offers them. */
const OPTION_NAMES = ['noclobber', 'noglob'] as const;

const spec: CommandSpec & RawArgsSpec & RunnerChoice = {
  name: 'set',
  category: 'shell',
  summary: "list variables, or set the shell's options",
  synopsis: ['set', 'set [-Cf] [-o OPTION] [+o OPTION]', 'set -o'],
  builtin: true,
  rawArgs: true,
  handlesHelp: true,
  flags: [
    {
      short: 'o',
      description: 'turn on OPTION (+o turns it off); alone, list the options',
      value: { name: 'OPTION', source: { kind: 'enum', values: () => OPTION_NAMES.map((value) => ({ value })) } },
    },
    { short: 'C', description: 'the same as -o noclobber' },
    { short: 'f', description: 'the same as -o noglob' },
  ],
  examples: [
    { line: 'set -o', note: 'list the options', offline: true },
    { line: 'set -o noclobber', note: '> no longer overwrites a file', offline: true },
    { line: 'set +o noclobber', offline: true },
    { line: 'set', note: 'every variable', offline: true },
  ],
  seeAlso: ['export', 'unset', 'env'],
  load: () => import('./set.run'),
};

export default defineCommand(spec);
