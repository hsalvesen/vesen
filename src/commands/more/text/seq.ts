// seq: print a sequence of numbers. Its body is in seq.run.ts. It reads its own options, as GNU
// seq does, so a negative number such as `seq -5 5` is an operand, not an option.

import type { RawArgsSpec } from '../../../shell/flags';
import { defineCommand, type CommandSpec, type RunnerChoice } from '../../../shell/types';

const spec: CommandSpec & RawArgsSpec & RunnerChoice = {
  name: 'seq',
  category: 'text',
  summary: 'print a sequence of numbers',
  synopsis: ['seq [OPTION]... LAST', 'seq [OPTION]... FIRST LAST', 'seq [OPTION]... FIRST INCREMENT LAST'],
  rawArgs: true,
  flags: [
    { short: 'f', long: 'format', description: 'use printf style floating-point FORMAT', value: { name: 'FORMAT', source: { kind: 'free', placeholder: '%g' } } },
    { short: 's', long: 'separator', description: 'use STRING to separate numbers (default: \\n)', value: { name: 'STRING', source: { kind: 'free', placeholder: 'STRING' } } },
    { short: 'w', long: 'equal-width', description: 'equalize width by padding with leading zeroes' },
  ],
  args: [
    { name: 'FIRST', source: { kind: 'free', placeholder: 'number' } },
    { name: 'NUMBER', source: { kind: 'free', placeholder: 'number' }, optional: true, variadic: true },
  ],
  examples: [
    { line: 'seq 5', offline: true },
    { line: 'seq 2 2 10', note: 'from 2 to 10 in steps of 2', offline: true },
    { line: 'seq -s , 10 -2 0', note: 'down, separated by commas', offline: true },
    { line: 'seq -w 8 11', note: 'padded to the same width', offline: true },
    { line: 'seq -f %.2f 0 0.25 1', note: 'with a format', offline: true },
    { line: 'seq 10 | sort -rn | head -3', note: 'the three largest', offline: true },
  ],
  seeAlso: ['printf', 'yes'],
  load: () => import('./seq.run'),
};

export default defineCommand(spec);
