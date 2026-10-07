// chmod: change file mode bits, as GNU chmod does: octal and symbolic modes, -R, -v, -c and -f,
// and modes such as -w that look like options. The visitor may change only their own files.

import type { RawArgsSpec } from '../../../shell/flags';
import { defineCommand, type CommandSpec, type RunnerChoice } from '../../../shell/types';

const MODES = [
  { value: '755', summary: 'rwxr-xr-x: a program or a folder' },
  { value: '644', summary: 'rw-r--r--: an ordinary file' },
  { value: '600', summary: 'rw-------: private' },
  { value: '700', summary: 'rwx------: a private folder' },
  { value: '+x', summary: 'let everyone run it' },
  { value: 'u+x', summary: 'let the owner run it' },
  { value: 'go-w', summary: 'only the owner may write' },
  { value: 'a+r', summary: 'everyone may read' },
];

// The words are read by the body, so `chmod -w file` is a mode, not an unknown option.
const spec: CommandSpec & RawArgsSpec & RunnerChoice = {
  name: 'chmod',
  category: 'files',
  summary: 'change file mode bits',
  synopsis: ['chmod [OPTION]... MODE[,MODE]... FILE...', 'chmod [OPTION]... OCTAL-MODE FILE...', 'chmod [OPTION]... --reference=RFILE FILE...'],
  rawArgs: true,
  flags: [
    { short: 'c', long: 'changes', description: 'like verbose, but say only when a change is made' },
    { short: 'f', long: 'silent', description: 'suppress most error messages' },
    { short: 'v', long: 'verbose', description: 'say what is done to every file' },
    { short: 'R', long: 'recursive', description: 'change folders and their contents' },
    { long: 'reference', description: "use RFILE's mode instead of a MODE", value: { name: 'RFILE', source: { kind: 'path', accept: 'any' } } },
  ],
  args: [
    { name: 'MODE', source: { kind: 'enum', values: () => MODES } },
    { name: 'FILE', source: { kind: 'path', accept: 'any' }, variadic: true },
  ],
  examples: [
    { line: 'chmod 755 bin/deploy', note: 'rwxr-xr-x', offline: true },
    { line: 'chmod -v u+x,go-w scripts/backup.sh', note: 'say what changed', offline: true },
    { line: 'chmod -w README.md', note: 'nobody may write it', offline: true },
    { line: 'chmod -R go-rwx documents', note: 'a folder and all in it', offline: true },
  ],
  seeAlso: ['chown', 'chgrp', 'ls', 'stat'],
  load: () => import('./chmod.run'),
};

export default defineCommand(spec);
