// bc: an arbitrary precision calculator language, in a small form. Its body is in bc.run.ts.

import { defineCommand } from '../../../shell/types';

export default defineCommand({
  name: 'bc',
  category: 'text',
  summary: 'an arbitrary precision calculator language',
  synopsis: ['bc [OPTION]... [FILE]...'],
  flags: [
    { short: 'l', long: 'mathlib', description: 'set scale to 20 and load the math library: s c a l e' },
    { short: 'e', long: 'expression', description: 'run EXPR before any FILE', value: { name: 'EXPR', source: { kind: 'free', placeholder: 'expression' } }, repeatable: true },
    { short: 'q', long: 'quiet', description: 'do not print a welcome (there is none)' },
    { short: 's', long: 'standard', description: 'accepted for compatibility' },
    { short: 'w', long: 'warn', description: 'accepted for compatibility' },
  ],
  args: [{ name: 'FILE', source: { kind: 'path', accept: 'file' }, optional: true, variadic: true }],
  examples: [
    { line: "echo '2^64' | bc", note: 'whole numbers of any size', offline: true },
    { line: "echo 'scale=5; 22/7' | bc", note: 'five decimal places', offline: true },
    { line: "echo 'sqrt(2)' | bc -l", offline: true },
    { line: "echo 'x=7; y=6; x*y' | bc", note: 'variables', offline: true },
    { line: "echo 'obase=2; 10' | bc", note: 'in binary', offline: true },
    { line: "echo '4*a(1)' | bc -l", note: 'pi, from the arctangent', offline: true },
  ],
  seeAlso: ['expr', 'printf'],
  load: () => import('./bc.run'),
});
