// printf: format and print its arguments, as bash's builtin and GNU printf(1) do. The format is
// reused until the arguments run out; a missing argument is an empty string or zero. A number
// that does not read is reported in GNU's words, printed as far as it read, and makes the status
// 1. `-v NAME` puts the result in a variable instead, and %q quotes for the shell, as bash's
// builtin does. Widths and precisions stop at MAX_FIELD, so one line cannot fill the memory.

import { defineCommand } from '../../shell/types';

export default defineCommand({
  name: 'printf',
  category: 'text',
  summary: 'format and print data',
  synopsis: ['printf [-v VAR] FORMAT [ARGUMENT]...'],
  // A shell builtin, as in bash: -v sets a variable in the shell.
  builtin: true,
  posixArgs: true,
  flags: [{ short: 'v', key: 'var', description: 'assign the output to the shell variable VAR', value: { name: 'VAR', source: { kind: 'var' } } }],
  args: [
    { name: 'FORMAT', source: { kind: 'free', placeholder: 'format' } },
    { name: 'ARGUMENT', source: { kind: 'free', placeholder: 'argument' }, optional: true, variadic: true },
  ],
  examples: [
    { line: "printf '%s\\n' one two three", note: 'the format is reused', offline: true },
    { line: "printf '%-8s|%6.2f|\\n' pi 3.14159", note: 'widths and precision', offline: true },
    { line: "printf '%d in hex is %x, in octal %o\\n' 255 255 255", offline: true },
    { line: "printf '%05d %c%c\\n' 42 vesen shell", offline: true },
    { line: "printf '%q\\n' 'a b' \"it's\"", note: 'quoted for the shell', offline: true },
    { line: "printf -v when '%s' today; echo $when", note: 'into a variable', offline: true },
  ],
  seeAlso: ['echo'],
  load: () => import('./printf.run'),
});
