// The body of less, and of more, which loads it too. On the terminal the text goes to the pager
// (src/ui/apps/Pager.svelte), opening where less's leading +CMD words say; into a pipe, or where
// the pager cannot open, it is copied or printed, as less does when its output is not a terminal
// (with more's rule of colons between files only for more).

import { pagerStart, type PagerStart } from '../../../lib/pager';
import { out, type Line } from '../../../output/model';
import type { CommandContext, CommandDoc, ExitCode } from '../../../shell/types';
import { errorCode, reason } from '../../lib/files';
import { capLines, printLines, readCapped, showPager, textLines } from '../../lib/pager';

/** What --help, help and man say about less, besides its spec (less.ts). */
export const doc: CommandDoc = {
  description:
    'Shows each FILE, or standard input, a screen at a time on the terminal, so text longer than the screen can be read from the top. q leaves; space, f or Page Down goes on a screen and b goes back; j and k, or the arrows, move a line; d and u half a screen; g and G go to the start and the end. /text searches forward and ?text back, highlighting every match, and n and N go to the next one. h shows all the keys. On a touch screen, swipe to scroll or use the buttons along the bottom. Into a pipe, less copies its input as cat would, every FILE one after another.',
  man: [
    {
      heading: 'COMMANDS AT THE START',
      body: 'A word starting with + before the files is a command to run as the pager opens: +G (or +F) opens at the end, +NUMBER at that line, and +/text at the first line holding the text. Other commands are ignored. Into a pipe these words are dropped.',
    },
    {
      heading: 'SEARCHING',
      body: 'A search looks for the text exactly as typed, not a regular expression. It ignores case unless the text has a capital in it, or with -i always. A search starts at the top line on the screen and does not go round past the end: Pattern not found says so.',
    },
    {
      heading: 'LIMITS',
      body: 'The pager holds the first 5,000 lines, and at most half a megabyte, of what it is given; the status line says when the rest was left out. Long lines wrap at the edge of the screen.',
    },
    { heading: 'EXIT STATUS', body: '0, or 1 when a FILE could not be read: less shows the others.' },
  ],
};

export type Pager = 'less' | 'more';

/** The line more prints above each file when there are several; less never does. */
const RULE = '::::::::::::::';

interface Source {
  readonly name: string;
  readonly lines: readonly Line[];
  readonly cut: boolean;
}

/** One FILE's lines, or why it cannot be read, in the words each pager uses. */
function readFile(ctx: CommandContext, pager: Pager, file: string, onTerminal: boolean): { lines: readonly Line[]; text: string } | { error: string } {
  const path = ctx.resolve(file);
  try {
    if (ctx.fs.stat(path).type === 'directory') return { error: pager === 'more' ? `*** ${file}: directory ***` : `${file} is a directory` };
    const text = ctx.fs.readFile(path);
    const styled = onTerminal ? ctx.fs.readStyled(path) : null;
    return { lines: styled ?? (onTerminal ? textLines(text) : []), text };
  } catch (error) {
    const why = errorCode(error) === 'EISDIR' ? 'Is a directory' : reason(error);
    return { error: pager === 'more' ? `more: cannot open ${file}: ${why}` : `${file}: ${why}` };
  }
}

async function complain(ctx: CommandContext, message: string): Promise<void> {
  await ctx.stderr.line(out.span(message, { fg: 'error' }));
}

/**
 * less's leading +CMD words, before the files (`less +G notes.txt`), as where the pager opens: the
 * last one it knows, or null. ++CMD, which less runs for every file, counts the same. A word after
 * the first file is a file, as it is to less.
 */
function plusCommands(args: readonly string[]): { start: PagerStart | null; files: readonly string[] } {
  let start: PagerStart | null = null;
  let at = 0;
  for (; at < args.length && /^\+./.test(args[at] ?? ''); at += 1) {
    const word = args[at] ?? '';
    start = pagerStart(word.startsWith('++') ? word.slice(1) : word) ?? start;
  }
  return { start, files: args.slice(at) };
}

/** Into a pipe: each file, or standard input, copied as it is; more puts its rule between files. */
async function copy(ctx: CommandContext, pager: Pager, files: readonly string[]): Promise<ExitCode> {
  let status = 0;
  const banners = pager === 'more' && files.length > 1;
  for (const file of files.length === 0 ? ['-'] : files) {
    if (file === '-') {
      if (banners) await ctx.stdout.write(`${RULE}\n(standard input)\n${RULE}\n`);
      for await (const chunk of ctx.stdin.chunks()) await ctx.stdout.write(chunk);
      continue;
    }
    const read = readFile(ctx, pager, file, false);
    if ('error' in read) {
      await complain(ctx, read.error);
      status = 1;
      continue;
    }
    if (banners) await ctx.stdout.write(`${RULE}\n${file}\n${RULE}\n`);
    await ctx.stdout.write(read.text);
  }
  return status;
}

/** less and more: the pager on the terminal, a copy into a pipe. */
export async function page(ctx: CommandContext, pager: Pager): Promise<ExitCode> {
  const { start, files } = pager === 'less' ? plusCommands(ctx.args) : { start: null, files: ctx.args };
  // Into a pipe, less's +CMD words have nothing to move, and are dropped.
  if (!ctx.stdout.isTTY) return copy(ctx, pager, files);
  if (files.length === 0 && ctx.stdin.isTTY) {
    if (pager === 'more') return ctx.usage('bad usage');
    await ctx.stderr.line(out.span('Missing filename ("less --help" for help)', { fg: 'error' }));
    return 1;
  }

  let status = 0;
  const sources: Source[] = [];
  for (const file of files.length === 0 ? ['-'] : files) {
    if (file === '-') {
      const { text, cut } = await readCapped(ctx);
      sources.push({ name: '(standard input)', lines: textLines(text), cut });
      continue;
    }
    const read = readFile(ctx, pager, file, true);
    if ('error' in read) {
      await complain(ctx, read.error);
      status = 1;
    } else sources.push({ name: file, lines: read.lines, cut: false });
  }
  if (sources.length === 0) return status;

  const lines: Line[] = [];
  for (const source of sources) {
    if (sources.length > 1) lines.push([out.span(RULE)], [out.span(source.name, { bold: true })], [out.span(RULE)]);
    lines.push(...source.lines);
  }
  const text = capLines(lines, sources.some((source) => source.cut));
  const title = sources.length === 1 ? (sources[0]?.name ?? '') : `${sources.length} files`;

  // more prints what fits on one screen; so does less -F.
  const fits = text.lines.length < ctx.tty.rows;
  if ((pager === 'more' || ctx.opts.quitIfOneScreen === true) && fits) {
    await printLines(ctx, text);
    return status;
  }
  const shown = await showPager(ctx, {
    title,
    ...text,
    mode: pager,
    numbers: ctx.opts.numbers === true,
    ignoreCase: ctx.opts.ignoreCase === true,
    ...(start === null ? {} : { start }),
  });
  if (!shown) await printLines(ctx, text);
  return status;
}

export function run(ctx: CommandContext): Promise<ExitCode> {
  return page(ctx, 'less');
}
