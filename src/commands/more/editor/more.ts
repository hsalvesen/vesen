// more: page through files or standard input, a screen at a time; it leaves at the end, and text
// that fits on the screen is printed with no pager at all. The body is less's (less.run.ts).

import { defineCommand } from '../../../shell/types';

export default defineCommand({
  name: 'more',
  category: 'editor',
  summary: 'page through text, leaving at the end',
  synopsis: ['more [FILE]...'],
  args: [{ name: 'FILE', source: { kind: 'path', accept: 'file' }, optional: true, variadic: true }],
  examples: [
    { line: 'more history.txt', note: 'space for the next screen, q to leave', offline: true },
    { line: 'help --all | more', offline: true },
  ],
  seeAlso: ['less', 'cat'],
  load: () => import('./more.run'),
});
