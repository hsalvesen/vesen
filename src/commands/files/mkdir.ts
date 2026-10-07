// mkdir: make directories, as GNU mkdir does (F019): every operand, -p for parents (and no error
// when the folder is there), -m for the mode, silent on success unless -v.

import { defineCommand } from '../../shell/types';

export default defineCommand({
  name: 'mkdir',
  category: 'files',
  summary: 'make directories',
  synopsis: ['mkdir [OPTION]... DIRECTORY...'],
  flags: [
    {
      short: 'm',
      long: 'mode',
      description: 'set the permissions, octal or as chmod writes them (700, u=rwx,go=), instead of 755',
      value: { name: 'MODE', source: { kind: 'free', placeholder: '755' } },
    },
    { short: 'p', long: 'parents', description: 'make parent folders as needed; no error if the folder exists' },
    { short: 'v', long: 'verbose', description: 'print a message for each folder made' },
  ],
  args: [{ name: 'DIRECTORY', source: { kind: 'path', accept: 'dir', includeParent: true }, variadic: true }],
  examples: [
    { line: 'mkdir notes', offline: true },
    { line: 'mkdir -p projects/new/src', note: 'parents too', offline: true },
    { line: 'mkdir -v -m 700 private', note: 'only you may enter', offline: true },
  ],
  seeAlso: ['rmdir', 'touch', 'ls'],
  next: ({ status, argv }) => {
    const last = argv[argv.length - 1];
    return status === 0 && last !== undefined && !last.startsWith('-') && /^[\w./~-]+$/.test(last) ? [`cd ${last}`, 'ls'] : [];
  },
  load: () => import('./mkdir.run'),
});

