// read: read a line into variables, as bash's builtin does: from standard input, or at a prompt
// when that is the terminal. It sets variables in the shell, so it is a builtin. The body is in
// read.run.ts.

import { defineCommand } from '../../../shell/types';

export default defineCommand({
  name: 'read',
  category: 'shell',
  summary: 'read a line into shell variables',
  synopsis: ['read [-rs] [-p PROMPT] [-n NCHARS] [-t TIMEOUT] [-d DELIM] [NAME]...'],
  builtin: true,
  flags: [
    { short: 'p', description: 'show PROMPT first, when reading at the terminal', value: { name: 'PROMPT', source: { kind: 'free', placeholder: 'prompt' } } },
    { short: 's', description: 'do not show what is typed: a secret' },
    { short: 'r', description: 'keep backslashes as they are' },
    { short: 'n', description: 'stop after NCHARS characters', value: { name: 'NCHARS', source: { kind: 'int' } } },
    { short: 't', description: 'give up after TIMEOUT seconds, with status 142', value: { name: 'TIMEOUT', source: { kind: 'free', placeholder: 'seconds' } } },
    { short: 'd', description: 'stop at the first character of DELIM, not at a newline', value: { name: 'DELIM', source: { kind: 'free', placeholder: 'delimiter' } } },
  ],
  args: [{ name: 'NAME', source: { kind: 'var' }, optional: true, variadic: true }],
  examples: [
    { line: "read -r NAME <<< 'Ada Lovelace'; echo \"hello, $NAME\"", offline: true },
    { line: "read FIRST REST <<< 'one two three'; echo \"$REST\"", note: 'the last NAME takes the rest', offline: true },
    { line: "read -p 'Your name? ' NAME", note: 'asks at the prompt' },
  ],
  seeAlso: ['echo', 'set', 'export'],
  load: () => import('./read.run'),
});
