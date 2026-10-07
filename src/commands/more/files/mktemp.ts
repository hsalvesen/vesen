// mktemp: create a file or folder with a new random name, in /tmp by default, as GNU mktemp does;
// the body is in mktemp.run.ts.

import { defineCommand } from '../../../shell/types';

export default defineCommand({
  name: 'mktemp',
  category: 'files',
  summary: 'create a file or folder with a random name',
  synopsis: ['mktemp [OPTION]... [TEMPLATE]'],
  flags: [
    { short: 'd', long: 'directory', description: 'create a folder, not a file' },
    { short: 'u', long: 'dry-run', description: 'print a name, but create nothing' },
    { short: 'q', long: 'quiet', description: 'say nothing when it fails' },
    { short: 'p', description: 'make TEMPLATE relative to DIR (default $TMPDIR, else /tmp)', value: { name: 'DIR', source: { kind: 'path', accept: 'dir' } } },
    {
      long: 'tmpdir',
      description: 'the same as -p; DIR may be left out',
      value: { name: 'DIR', source: { kind: 'path', accept: 'dir' }, optional: true },
    },
    { short: 't', description: 'make TEMPLATE a name in $TMPDIR or /tmp (old style)' },
    { long: 'suffix', description: 'add SUFF after the X\'s', value: { name: 'SUFF', source: { kind: 'free', placeholder: '.txt' } } },
  ],
  args: [{ name: 'TEMPLATE', source: { kind: 'free', placeholder: 'tmp.XXXXXXXXXX' }, optional: true }],
  examples: [
    { line: 'mktemp', note: 'a new empty file in /tmp', offline: true },
    { line: 'mktemp -d', note: 'a new folder', offline: true },
    { line: 'mktemp notes.XXXXXX', note: 'here, with a name of your own', offline: true },
    { line: 'mktemp --suffix=.txt -p ~', offline: true },
  ],
  seeAlso: ['touch', 'mkdir'],
  load: () => import('./mktemp.run'),
});
