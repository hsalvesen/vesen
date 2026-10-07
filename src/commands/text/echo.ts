// echo: write its words, joined by single spaces, and a newline. Options are only leading words
// made of n, e and E (`echo -ne`), as bash's builtin reads them; any other word, `-x` or `--`
// included, is text. Escapes are read only under -e (F040). Redirection is the shell's: `echo hi
// > f` is the executor's, so `echo "5 > 3"` prints 5 > 3.

import type { RawArgsSpec } from '../../shell/flags';
import { defineCommand, type CommandSpec, type RunnerChoice } from '../../shell/types';
import { unescape } from '../lib/escapes';

const OPTION = /^-[neE]+$/;

const spec: CommandSpec & RawArgsSpec & RunnerChoice = {
  name: 'echo',
  category: 'text',
  summary: 'display a line of text',
  helpRank: 1,
  synopsis: ['echo [-neE] [STRING]...'],
  description:
    "Writes each STRING, separated by single spaces, then a newline. Quote a STRING to keep its spaces or to print > and | as text. With -e, backslash escapes such as \\n and \\t are read; \\e[31m starts red text on the terminal.",
  rawArgs: true,
  handlesHelp: true,
  flags: [
    { short: 'n', description: 'do not print the trailing newline' },
    { short: 'e', description: 'read backslash escapes' },
    { short: 'E', description: 'print backslashes as they are (the default)' },
  ],
  args: [{ name: 'STRING', source: { kind: 'free', placeholder: 'text' }, optional: true, variadic: true }],
  examples: [
    { line: 'echo hello world', offline: true },
    { line: 'echo -n no newline', offline: true },
    { line: "echo -e 'one\\ttwo\\nthree'", note: 'a tab and a new line', offline: true },
    { line: 'echo "hi there" > note.txt', note: 'write a file', offline: true },
    { line: 'echo $HOME $?', note: 'variables and the last status', offline: true },
  ],
  seeAlso: ['printf', 'cat'],
  man: [
    {
      heading: 'ESCAPES',
      body: 'With -e: \\\\ backslash, \\a bell, \\b backspace, \\c print nothing more, \\e escape, \\f form feed, \\n new line, \\r carriage return, \\t tab, \\v vertical tab, \\0NNN the byte with octal value NNN, \\xHH the byte with hex value HH.',
    },
    {
      heading: 'NOTES',
      body: "As in bash, a word is an option only when it is -n, -e or -E, alone or together (-ne); anything else, -- included, is printed. 'echo --help' alone shows this help, as GNU echo does.",
    },
  ],
  async run(ctx) {
    const words = ctx.args;
    if (words.length === 1 && words[0] === '--help') {
      const { commandHelp } = await import('../../shell/help');
      for (const block of commandHelp(ctx.spec)) await ctx.stdout.block(block);
      return 0;
    }
    let newline = true;
    let escapes = false;
    let first = 0;
    for (; first < words.length; first += 1) {
      const word = words[first] ?? '';
      if (!OPTION.test(word)) break;
      for (const flag of word.slice(1)) {
        if (flag === 'n') newline = false;
        else escapes = flag === 'e';
      }
    }
    let text = words.slice(first).join(' ');
    if (escapes) {
      const read = unescape(text, 'echo');
      text = read.text;
      if (read.stop) newline = false;
    }
    await ctx.stdout.write(newline ? `${text}\n` : text);
    return 0;
  },
};

export default defineCommand(spec);
