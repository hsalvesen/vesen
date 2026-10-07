// The body of wc; its spec, in wc.ts, loads this the first time wc runs.

import type { CommandContext, CommandDoc, ExitCode } from '../../../shell/types';
import { errorCode, reason, tryStat } from '../../lib/files';
import { optOn, optString, utf8Length } from '../../lib/text-input';

export const doc: CommandDoc = {
  description:
    'Prints newline, word and byte counts for each FILE, and a total line when there is more than one. A word is a run of characters between white space. With no FILE, or when FILE is -, it reads standard input. The options choose which counts to print, always in the order lines, words, characters, bytes, maximum line length. Bytes are counted in UTF-8, so an accented letter is two bytes and one character.',
  man: [
    {
      heading: 'LAYOUT',
      body: 'The counts are right-aligned to a common width, as on Linux: one count of one input is printed bare, and standard input or a folder makes the width at least 7.',
    },
    { heading: 'EXIT STATUS', body: '0 when every FILE was read, 1 when any could not be.' },
  ],
};

export interface Counts {
  lines: number;
  words: number;
  chars: number;
  bytes: number;
  maxLine: number;
}

const zero = (): Counts => ({ lines: 0, words: 0, chars: 0, bytes: 0, maxLine: 0 });

const SPACE = /\s/u;

/** A counter fed text piece by piece, so standard input is counted as it arrives. */
export class Counter {
  readonly counts: Counts = zero();
  private inWord = false;
  private column = 0;

  add(text: string): void {
    const c = this.counts;
    c.bytes += utf8Length(text);
    for (const ch of text) {
      c.chars += 1;
      if (ch === '\n') {
        c.lines += 1;
        c.maxLine = Math.max(c.maxLine, this.column);
        this.column = 0;
      } else if (ch === '\t') {
        this.column += 8 - (this.column % 8);
      } else if (ch === '\r' || ch === '\f') {
        this.column = 0;
      } else if (ch >= ' ') {
        this.column += 1;
      }
      if (SPACE.test(ch)) {
        this.inWord = false;
      } else if (!this.inWord) {
        this.inWord = true;
        c.words += 1;
      }
    }
  }

  done(): Counts {
    this.counts.maxLine = Math.max(this.counts.maxLine, this.column);
    return this.counts;
  }
}

export function countText(text: string): Counts {
  const counter = new Counter();
  counter.add(text);
  return counter.done();
}

type Field = keyof Counts;

export async function run(ctx: CommandContext): Promise<ExitCode> {
  const picked: Field[] = [];
  if (optOn(ctx, 'lines')) picked.push('lines');
  if (optOn(ctx, 'words')) picked.push('words');
  if (optOn(ctx, 'chars')) picked.push('chars');
  if (optOn(ctx, 'bytes')) picked.push('bytes');
  if (optOn(ctx, 'max-line-length')) picked.push('maxLine');
  const fields: Field[] = picked.length > 0 ? picked : ['lines', 'words', 'bytes'];
  const total = optString(ctx, 'total') ?? 'auto';
  if (!['auto', 'always', 'only', 'never'].includes(total)) {
    return ctx.usage(`invalid argument '${total}' for '--total'\nValid arguments are:\n  - 'auto'\n  - 'always'\n  - 'only'\n  - 'never'`);
  }

  const named = ctx.args.length > 0;
  const files = named ? ctx.args : ['-'];

  // The width is worked out first, as GNU wc does, from what each FILE is: regular files' sizes
  // set it, and standard input or a folder makes it at least 7. One count of one input is bare.
  let width = 1;
  if (!(files.length === 1 && fields.length === 1)) {
    let regularBytes = 0;
    let irregular = false;
    let firstFailed = false;
    files.forEach((file, index) => {
      if (file === '-') {
        irregular = true;
        return;
      }
      const stat = tryStat(ctx, ctx.resolve(file));
      if (stat === null) firstFailed ||= index === 0;
      else if (stat.type === 'file') regularBytes += stat.size;
      else irregular = true;
    });
    if (!firstFailed) width = Math.max(String(regularBytes).length, irregular ? 7 : 1);
  }
  const format = (counts: Counts, name: string | null): string => {
    const cells = fields.map((field) => String(counts[field]).padStart(width));
    return `${cells.join(' ')}${name === null ? '' : ` ${name}`}\n`;
  };

  // Each FILE's line is written as it is counted, so the errors fall in among them.
  const sum = zero();
  const show = async (counts: Counts, name: string | null): Promise<void> => {
    sum.lines += counts.lines;
    sum.words += counts.words;
    sum.chars += counts.chars;
    sum.bytes += counts.bytes;
    sum.maxLine = Math.max(sum.maxLine, counts.maxLine);
    if (total !== 'only') await ctx.stdout.write(format(counts, name));
  };
  let status = 0;
  for (const file of files) {
    if (file === '-') {
      const counter = new Counter();
      for await (const chunk of ctx.stdin.chunks()) counter.add(chunk);
      await show(counter.done(), named ? '-' : null);
      continue;
    }
    let text: string;
    try {
      text = ctx.fs.readFile(ctx.resolve(file));
    } catch (error) {
      const code = errorCode(error);
      status = await ctx.fail(`${file}: ${reason(error)}`);
      // A folder opens and then cannot be read: it still has its line of zeros.
      if (code === 'EISDIR') await show(zero(), file);
      continue;
    }
    await show(countText(text), file);
  }

  const showTotal = total === 'always' || total === 'only' || (total === 'auto' && files.length > 1);
  if (showTotal) await ctx.stdout.write(total === 'only' ? `${fields.map((field) => String(sum[field])).join(' ')}\n` : format(sum, 'total'));
  return status;
}
