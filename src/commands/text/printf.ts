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
  description:
    'Prints the ARGUMENTs as FORMAT says, reusing FORMAT until they run out. FORMAT is text with backslash escapes (\\n, \\t) and conversions: %s a string, %d or %i an integer, %f a decimal, %x hex, %o octal, %c a character, %b a string with escapes read, %q a string quoted for the shell, %% a percent sign. A width and precision go between: %-10s, %5.2f, %05d. Unlike echo, printf adds no newline of its own. With -v VAR, the result goes into the variable VAR instead.',
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
  man: [
    {
      heading: 'CONVERSIONS',
      body: 'Flags: - left-justify, 0 pad with zeros, + always a sign, space a space for positive numbers, # 0x for hex. A * for the width or precision takes it from the next argument. %e and %g write decimals in exponent form; %u, %X, %E, %F and %G are there too.',
    },
    {
      heading: 'EXIT STATUS',
      body: "0, or 1 when an argument was not a number a conversion wanted, such as printf '%d' abc.",
    },
  ],
  load: () => import('./printf.run'),
});
