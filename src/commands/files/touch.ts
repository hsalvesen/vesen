// touch: change file timestamps, creating files that are not there, as GNU touch does (F019):
// every operand, folders too, -c to create nothing, a time from -d, -t or -r, and silent on
// success. The body is in touch.run.ts.

import { defineCommand } from '../../shell/types';

export default defineCommand({
  name: 'touch',
  category: 'files',
  summary: 'change file timestamps, or create files',
  synopsis: ['touch [OPTION]... FILE...'],
  flags: [
    { short: 'a', description: 'change only the access time' },
    { short: 'c', long: 'no-create', description: 'do not create any files' },
    { short: 'd', long: 'date', description: "use DATE, such as '2026-10-01 09:30' or '2 days ago', instead of now", value: { name: 'DATE', source: { kind: 'free', placeholder: "'yesterday'" } } },
    { short: 'm', description: 'change only the modification time' },
    { short: 'r', long: 'reference', description: "use RFILE's time instead of now", value: { name: 'RFILE', source: { kind: 'path', accept: 'any' } } },
    { short: 't', description: 'use STAMP, [[CC]YY]MMDDhhmm[.ss], instead of now', value: { name: 'STAMP', source: { kind: 'free', placeholder: '202610010930' } } },
  ],
  args: [{ name: 'FILE', source: { kind: 'path', accept: 'any' }, variadic: true }],
  examples: [
    { line: 'touch notes.txt', note: 'a new empty file', offline: true },
    { line: 'touch a.txt b.txt c.txt', offline: true },
    { line: 'touch -c missing.txt', note: 'nothing is created', offline: true },
    { line: "touch -d '2 days ago' README.md", note: 'back in time', offline: true },
    { line: 'touch -r README.md history.txt', note: 'the same time as another file', offline: true },
  ],
  seeAlso: ['ls', 'mkdir', 'stat'],
  load: () => import('./touch.run'),
});
