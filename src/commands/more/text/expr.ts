// expr: evaluate expressions. Its body is in expr.run.ts. It reads its own words, as GNU expr
// does, so `expr -5 + 2` is arithmetic, not an option.

import type { RawArgsSpec } from '../../../shell/flags';
import { defineCommand, type CommandSpec, type RunnerChoice } from '../../../shell/types';

const spec: CommandSpec & RawArgsSpec & RunnerChoice = {
  name: 'expr',
  category: 'text',
  summary: 'evaluate expressions',
  synopsis: ['expr EXPRESSION'],
  rawArgs: true,
  usageStatus: 2,
  args: [{ name: 'EXPRESSION', source: { kind: 'free', placeholder: 'expression' }, variadic: true }],
  examples: [
    { line: 'expr 6 \\* 7', note: '42: quote * from the shell', offline: true },
    { line: 'expr 7 / 2 + 7 % 2', note: 'whole numbers only', offline: true },
    { line: 'expr length vesen', offline: true },
    { line: 'expr substr terminal 1 4', offline: true },
    { line: 'expr hello.txt : ".*\\.\\(.*\\)"', note: 'the part a group matches', offline: true },
    { line: 'expr 3 \\< 10', note: 'numbers compare as numbers', offline: true },
  ],
  seeAlso: ['bc', 'test', 'printf'],
  load: () => import('./expr.run'),
};

export default defineCommand(spec);
