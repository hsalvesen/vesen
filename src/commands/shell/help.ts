// help: eight commands of each category, every command of one category, or one command's options
// and examples, or the keys. The index, the panels and the key list are all generated from the
// specs (src/shell/help.ts), so help never disagrees with the commands (F042, F043). Its body is
// in help.run.ts.

import { categoryNamed } from '../../shell/registry';
import { defineCommand, PLAIN_ARG } from '../../shell/types';

export default defineCommand({
  name: 'help',
  category: 'shell',
  // A usage error exits 2, as bash builtins do.
  usageStatus: 2,
  summary: 'list the commands, or explain one',
  synopsis: ['help [-v]', 'help [-v] CATEGORY', 'help COMMAND...', 'help keys'],
  featured: true,
  flags: [
    { short: 'v', long: 'verbose', description: 'say what each command does' },
    { short: 'a', long: 'all', description: 'list every command of every category, each with what it does' },
  ],
  args: [{ name: 'COMMAND', source: { kind: 'command' }, optional: true, variadic: true }],
  examples: [
    { line: 'help', note: 'eight commands of each category', offline: true, starter: 1 },
    { line: 'help files', note: 'every command in a category', offline: true },
    { line: 'help -v files', note: 'the same, with what each does', offline: true },
    { line: 'help ls', note: "one command's options and examples", offline: true },
    { line: 'help keys', note: 'the keys', offline: true },
  ],
  seeAlso: ['man', 'whatis', 'apropos'],
  // A few places to start after the index; a command's manual after its help.
  next: ({ status, argv }) => {
    if (status !== 0) return [];
    const topics = argv.slice(1).filter((word) => !word.startsWith('-'));
    if (topics.length === 0) return ['cat ~/README.md', 'ls', 'fastfetch', 'theme ls', 'man ls'];
    const [topic] = topics;
    // A category's listing ends with how to see more; a command's help is followed by its manual.
    if (topics.length !== 1 || topic === undefined || topic === 'keys' || categoryNamed(topic) !== undefined) return [];
    return PLAIN_ARG.test(topic) ? [`man ${topic}`] : [];
  },
  load: () => import('./help.run'),
});
