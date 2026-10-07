// less: page through files or standard input on the terminal, a screen at a time, with search
// (src/ui/apps/Pager.svelte through ctx.tty.fullscreen). Into a pipe it copies, as less does when
// its output is not a terminal. The body, shared with more, is in less.run.ts.

import { defineCommand } from '../../../shell/types';

export default defineCommand({
  name: 'less',
  category: 'editor',
  summary: 'page through text a screen at a time',
  synopsis: ['less [OPTION]... [FILE]...'],
  flags: [
    { short: 'N', long: 'LINE-NUMBERS', key: 'numbers', description: 'show a line number before each line' },
    { short: 'i', long: 'ignore-case', key: 'ignoreCase', description: 'searches ignore case, even with capitals in them' },
    { short: 'F', long: 'quit-if-one-screen', key: 'quitIfOneScreen', description: 'print the text instead when it fits on one screen' },
    { short: 'R', long: 'RAW-CONTROL-CHARS', key: 'raw', description: 'show colours; less always does here' },
  ],
  args: [{ name: 'FILE', source: { kind: 'path', accept: 'file' }, optional: true, variadic: true }],
  examples: [
    { line: 'less README.md', note: 'q leaves, space goes on, /text searches', offline: true },
    { line: 'less -N documents/linux.txt', note: 'with line numbers', offline: true },
    { line: 'man ls | less', note: 'whatever a pipe brings', offline: true },
  ],
  seeAlso: ['more', 'cat', 'man'],
  load: () => import('./less.run'),
});
