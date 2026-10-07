// nano: edit a text file full screen (src/ui/apps/Editor.svelte through ctx.tty.fullscreen), with
// nano's keys on a keyboard and a toolbar on a phone. Writes go through the file system as the
// visitor, so permissions and persistence apply. The body is in nano.run.ts.

import { defineCommand } from '../../../shell/types';

export default defineCommand({
  name: 'nano',
  aliases: ['editor', 'edit'],
  category: 'editor',
  summary: 'edit a text file',
  synopsis: ['nano [+LINE[,COLUMN]] [FILE]'],
  args: [{ name: 'FILE', source: { kind: 'path', accept: 'file' }, optional: true, variadic: true }],
  interactiveOnly: true,
  examples: [
    { line: 'nano notes.txt', note: 'type, then ^O and Enter to save, ^X to leave' },
    { line: 'nano +3 .bashrc', note: 'with the caret on line 3' },
    { line: 'nano --help', offline: true },
  ],
  seeAlso: ['less', 'cat', 'vi'],
  load: () => import('./nano.run'),
});
