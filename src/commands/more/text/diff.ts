// diff: compare files line by line. Its body is in diff.run.ts.

import { defineCommand } from '../../../shell/types';

export default defineCommand({
  name: 'diff',
  category: 'text',
  summary: 'compare files line by line',
  synopsis: ['diff [OPTION]... FILE1 FILE2'],
  usageStatus: 2,
  flags: [
    { short: 'u', key: 'u', description: 'output 3 lines of unified context' },
    { short: 'U', long: 'unified', description: 'output NUM lines of unified context', value: { name: 'NUM', source: { kind: 'int' } } },
    { short: 'q', long: 'brief', description: 'report only when files differ' },
    { short: 's', long: 'report-identical-files', description: 'report when two files are the same' },
    { short: 'i', long: 'ignore-case', description: 'ignore case differences in file contents' },
    { short: 'b', long: 'ignore-space-change', description: 'ignore changes in the amount of white space' },
    { short: 'w', long: 'ignore-all-space', description: 'ignore all white space' },
    { long: 'label', description: 'use LABEL instead of file name and timestamp (twice for both files)', value: { name: 'LABEL', source: { kind: 'free', placeholder: 'LABEL' } }, repeatable: true },
  ],
  args: [
    { name: 'FILE1', source: { kind: 'path', accept: 'file' } },
    { name: 'FILE2', source: { kind: 'path', accept: 'file' } },
  ],
  examples: [
    { line: 'diff .bashrc .bashrc', note: 'the same: nothing, and status 0', offline: true },
    { line: "printf 'a\\nb\\nc\\n' > old; printf 'a\\nB\\nc\\nd\\n' > new; diff old new || true", note: 'what changed, line by line', offline: true },
    { line: "printf 'a\\nb\\nc\\n' > old; printf 'a\\nB\\nc\\n' > new; diff -u old new || true", note: 'the unified form, as patches use', offline: true },
    { line: 'diff -q .bashrc .profile || echo differ', offline: true },
  ],
  seeAlso: ['sort', 'uniq', 'sed'],
  load: () => import('./diff.run'),
});
