// The body of rev; its spec, in rev.ts, loads this the first time rev runs.

import type { CommandContext, CommandDoc, ExitCode } from '../../../shell/types';
import { errorCode, reason } from '../../lib/files';
import { inputRecords } from '../../lib/text-input';

/** What --help, help and man say about rev, besides its spec (rev.ts). */
export const doc: CommandDoc = {
  description:
    'Copies each FILE to standard output with the characters of every line in reverse order. With no FILE, or when FILE is -, it reads standard input, so it can sit in a pipe. Line breaks stay where they are, and a last line with no newline gets none.',
  man: [{ heading: 'EXIT STATUS', body: '0 when every FILE was read, 1 when any could not be: rev carries on with the rest.' }],
};

/** One line backwards, by whole characters, so an emoji or an accented letter stays whole. */
export function reverseLine(line: string): string {
  return Array.from(line).reverse().join('');
}

/** Text with each line reversed; the line breaks stay where they are. */
export function reverseText(text: string): string {
  return text.split('\n').map(reverseLine).join('\n');
}

/**
 * Standard input, a line at a time as it arrives, so `yes | rev | head -n 3` ends at once; a
 * line longer than MAX_INPUT (16 MB) ends it with InputTooLarge.
 */
async function reverseInput(ctx: CommandContext): Promise<void> {
  let out = '';
  for await (const record of inputRecords(ctx)) {
    out += record.nl ? `${reverseLine(record.text)}\n` : reverseLine(record.text);
    if (out.length >= 4096) {
      await ctx.stdout.write(out);
      out = '';
    }
  }
  if (out !== '') await ctx.stdout.write(out);
}

export async function run(ctx: CommandContext): Promise<ExitCode> {
  const files = ctx.args.length === 0 ? ['-'] : ctx.args;
  let status = 0;
  for (const file of files) {
    if (file === '-') {
      await reverseInput(ctx);
      continue;
    }
    let text: string;
    try {
      text = ctx.fs.readFile(ctx.resolve(file));
    } catch (error) {
      status = await ctx.fail(errorCode(error) === 'EISDIR' ? `${file}: ${reason(error)}` : `cannot open ${file}: ${reason(error)}`);
      continue;
    }
    await ctx.stdout.write(reverseText(text));
  }
  return status;
}
