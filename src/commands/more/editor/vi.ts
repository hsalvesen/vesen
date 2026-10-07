// vi and vim: vesen has no vi, so they say so in one line and open nano (nano.run.ts) on the same
// file. Hidden from help and Tab; they run when typed.

import { defineCommand } from '../../../shell/types';

export default defineCommand({
  name: 'vi',
  aliases: ['vim'],
  category: 'editor',
  summary: 'open nano, since vesen has no vi',
  synopsis: ['vi [+LINE] [FILE]'],
  args: [{ name: 'FILE', source: { kind: 'path', accept: 'file' }, optional: true, variadic: true }],
  hidden: true,
  interactiveOnly: true,
  examples: [
    { line: 'vim notes.txt', note: 'nano, after a note' },
    { line: 'vi --help', offline: true },
  ],
  seeAlso: ['nano'],
  load: () => import('./vi.run'),
});
