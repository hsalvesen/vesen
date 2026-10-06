// cat: concatenate files to standard output, as GNU cat does: any number of FILEs, `-` or none
// for standard input, line numbering and the visible-character options, an error for each file it
// cannot read (it carries on, and exits 1). On a terminal, the owner's styled documents keep their
// colours (F093); anywhere else, and with any option, they are the plain text they hold.

import { defineCommand, type CommandContext } from '../../shell/types';
import { errorCode, reason, suggestNearMiss } from '../lib/files';

interface Shown {
  readonly numberAll: boolean;
  readonly numberNonBlank: boolean;
  readonly squeeze: boolean;
  readonly ends: boolean;
  readonly tabs: boolean;
  readonly nonPrinting: boolean;
}

/** Where numbering and squeezing are, across all the files: GNU numbers them as one stream. */
interface State {
  line: number;
  /** The previous line was empty. */
  blank: boolean;
  /** The next character starts a line. */
  atStart: boolean;
}

/** ^X for control characters and ^? for DEL, as cat -v shows them; tab and newline stay. */
function visible(text: string, tabs: boolean): string {
  let result = '';
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (ch === '\t') result += tabs ? '^I' : '\t';
    else if (code < 0x20) result += `^${String.fromCharCode(code + 64)}`;
    else if (code === 0x7f) result += '^?';
    else result += ch;
  }
  return result;
}

/** Applies the options to one piece of text, which ends a line when `newline` is set. */
function shape(content: string, newline: boolean, shown: Shown, state: State): string | null {
  const empty = content === '' && state.atStart;
  if (shown.squeeze && empty && newline && state.blank) return null;
  let prefix = '';
  if (state.atStart && (shown.numberNonBlank ? !empty : shown.numberAll)) {
    state.line += 1;
    prefix = `${String(state.line).padStart(6)}\t`;
  }
  let body = content;
  if (shown.nonPrinting) body = visible(body, shown.tabs);
  else if (shown.tabs) body = body.replace(/\t/g, '^I');
  if (newline) {
    state.blank = empty;
    state.atStart = true;
  } else if (content !== '') {
    state.atStart = false;
  }
  return `${prefix}${body}${newline && shown.ends ? '$' : ''}${newline ? '\n' : ''}`;
}

/** The text of one file, shaped line by line. */
function shapeText(text: string, shown: Shown, state: State): string {
  const pieces = text.split('\n');
  const last = pieces.pop() ?? '';
  let result = '';
  for (const piece of pieces) result += shape(piece, true, shown, state) ?? '';
  if (last !== '') result += shape(last, false, shown, state) ?? '';
  return result;
}

async function copyInput(ctx: CommandContext, shown: Shown | null, state: State): Promise<void> {
  // As it arrives, so `yes | cat | head` ends as soon as head has enough, and byte for byte, so
  // `printf x | cat` adds no newline.
  for await (const chunk of ctx.stdin.chunks()) {
    const text = shown === null ? chunk : shapeText(chunk, shown, state);
    if (text !== '') await ctx.stdout.write(text);
  }
}

export default defineCommand({
  name: 'cat',
  category: 'files',
  summary: 'concatenate files and print them',
  synopsis: ['cat [OPTION]... [FILE]...'],
  description:
    'Prints each FILE in turn. With no FILE, or when FILE is -, it reads standard input, so it can end a pipe. The options number lines and make tabs, line ends and control characters visible.',
  flags: [
    { short: 'A', long: 'show-all', description: 'equivalent to -vET' },
    { short: 'b', long: 'number-nonblank', description: 'number the lines that are not empty; overrides -n' },
    { short: 'e', description: 'equivalent to -vE' },
    { short: 'E', long: 'show-ends', description: 'show $ at the end of each line' },
    { short: 'n', long: 'number', description: 'number all output lines' },
    { short: 's', long: 'squeeze-blank', description: 'suppress repeated empty output lines' },
    { short: 't', description: 'equivalent to -vT' },
    { short: 'T', long: 'show-tabs', description: 'show tabs as ^I' },
    { short: 'v', long: 'show-nonprinting', description: 'show control characters as ^X, except tab and newline' },
  ],
  args: [{ name: 'FILE', source: { kind: 'path', accept: 'file' }, optional: true, variadic: true }],
  examples: [
    { line: 'cat README.md', note: 'the guide to this terminal', offline: true, starter: 2 },
    { line: 'cat -n documents/linux.txt', note: 'with line numbers', offline: true },
    { line: 'cat .bashrc .profile', note: 'one after the other', offline: true },
    { line: "echo piped | cat -A -", note: 'standard input, with line ends shown', offline: true },
  ],
  seeAlso: ['ls', 'echo', 'printf'],
  man: [
    {
      heading: 'EXIT STATUS',
      body: '0 when every FILE was read, 1 when any could not be: it is missing, a folder, or not yours to read. cat carries on with the rest.',
    },
  ],
  async run(ctx) {
    const o = ctx.opts;
    const all = o['show-all'] === true;
    const shown: Shown = {
      numberAll: o.number === true,
      numberNonBlank: o['number-nonblank'] === true,
      squeeze: o['squeeze-blank'] === true,
      ends: all || o.e === true || o['show-ends'] === true,
      tabs: all || o.t === true || o['show-tabs'] === true,
      nonPrinting: all || o.e === true || o.t === true || o['show-nonprinting'] === true,
    };
    const plain = !Object.values(shown).some(Boolean);
    const state: State = { line: 0, blank: false, atStart: true };
    const files = ctx.args.length === 0 ? ['-'] : ctx.args;
    let status = 0;
    for (const file of files) {
      if (file === '-') {
        await copyInput(ctx, plain ? null : shown, state);
        continue;
      }
      const path = ctx.resolve(file);
      let text: string;
      try {
        text = ctx.fs.readFile(path);
      } catch (error) {
        const code = errorCode(error);
        status = await ctx.fail(`${file}: ${reason(error)}`);
        if (code === 'ENOENT') await suggestNearMiss(ctx, file, 'cat');
        continue;
      }
      const styled = plain && ctx.stdout.isTTY ? ctx.fs.readStyled(path) : null;
      if (styled !== null) {
        for (const line of styled) await ctx.stdout.line(...line);
        continue;
      }
      await ctx.stdout.write(plain ? text : shapeText(text, shown, state));
    }
    return status;
  },
});
