// factor: the prime factors of each number. The arithmetic is in commands/lib/primes.ts, which
// loads with the body (factor.run.ts).

import { defineCommand } from '../../../shell/types';

export default defineCommand({
  name: 'factor',
  category: 'fun',
  summary: 'print the prime factors of numbers',
  synopsis: ['factor [NUMBER]...'],
  featured: false,
  args: [{ name: 'NUMBER', source: { kind: 'free', placeholder: 'NUMBER' }, optional: true, variadic: true }],
  examples: [
    { line: 'factor 2026', note: '2026: 2 1013', offline: true },
    { line: 'factor 360 1001 65537', note: 'several at once', offline: true },
    { line: 'factor 18446744073709551615', note: 'the largest it takes, 2^64 - 1', offline: true },
    { line: 'echo 10 11 12 | factor', note: 'numbers piped in', offline: true },
  ],
  seeAlso: ['echo'],
  load: () => import('./factor.run'),
});
