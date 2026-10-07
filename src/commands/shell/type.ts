// type: say what a name would run, as bash's builtin does: an alias, a keyword, a builtin or a
// file on $PATH. The body is in type.run.ts.

import { defineCommand } from '../../shell/types';

export default defineCommand({
  name: 'type',
  category: 'shell',
  summary: 'describe what a command name runs',
  synopsis: ['type [-afptP] NAME...'],
  builtin: true,
  flags: [
    { short: 'a', description: 'list every place NAME is found, not just the first' },
    { short: 't', description: "print only one word: alias, keyword, builtin or file" },
    { short: 'p', description: 'print the file NAME would run, if it is a file' },
    { short: 'P', description: 'search $PATH for NAME, even if it is an alias or builtin' },
    { short: 'f', description: 'do not look up shell functions (vesen has none)' },
  ],
  args: [{ name: 'NAME', source: { kind: 'command' }, variadic: true }],
  examples: [
    { line: 'type ls', offline: true },
    { line: 'type ll cd if', note: 'an alias, a builtin and a keyword', offline: true },
    { line: 'type -a ls', note: 'every match on $PATH', offline: true },
  ],
  seeAlso: ['which', 'command', 'alias'],
  load: () => import('./type.run'),
});
