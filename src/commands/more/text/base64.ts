// base64: encode or decode base64. Its body is in base64.run.ts.

import { defineCommand } from '../../../shell/types';

export default defineCommand({
  name: 'base64',
  category: 'text',
  summary: 'base64 encode or decode data',
  synopsis: ['base64 [OPTION]... [FILE]'],
  flags: [
    { short: 'd', long: 'decode', description: 'decode data' },
    { short: 'i', long: 'ignore-garbage', description: 'when decoding, ignore non-alphabet characters' },
    { short: 'w', long: 'wrap', description: 'wrap encoded lines after COLS characters (default 76); 0 disables', value: { name: 'COLS', source: { kind: 'free', placeholder: '76' } } },
  ],
  args: [{ name: 'FILE', source: { kind: 'path', accept: 'file' }, optional: true }],
  examples: [
    { line: 'echo hello | base64', note: 'aGVsbG8K', offline: true },
    { line: 'echo aGVsbG8K | base64 -d', note: 'hello', offline: true },
    { line: 'base64 -w 0 .profile', note: 'on one line', offline: true },
  ],
  seeAlso: ['md5sum', 'sha256sum'],
  load: () => import('./base64.run'),
});
