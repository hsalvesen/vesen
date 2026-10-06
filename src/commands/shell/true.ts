// true and `:`: do nothing, successfully. `: > log` empties or creates a file, as in bash.

import type { RawArgsSpec } from '../../shell/flags';
import type { CommandSpec, RunnerChoice } from '../../shell/types';

// Its words are ignored, options included, as bash's builtin ignores them.
const spec: CommandSpec & RawArgsSpec & RunnerChoice = {
  name: 'true',
  aliases: [':'],
  category: 'shell',
  rawArgs: true,
  summary: 'do nothing, successfully',
  description: "Exits with status 0, whatever its arguments. Useful in && and || chains; ': > FILE' empties FILE, or creates it.",
  examples: [
    { line: 'true && echo yes', offline: true },
    { line: ': > empty.txt', note: 'create or empty a file', offline: true },
  ],
  seeAlso: ['false', 'test'],
  run: () => 0,
};

export default spec;
