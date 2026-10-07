// The body of nl; its spec, in nl.ts, loads this the first time nl runs.

import type { CommandContext, CommandDoc, ExitCode } from '../../../shell/types';
import { compilePatterns, patternMessage, type SafeRegex } from '../../lib/regex';
import { openRecords, operands, optOn, optString, pacer, quoted } from '../../lib/text-input';

export const doc: CommandDoc = {
  description:
    'Writes each FILE to standard output with line numbers added. With no FILE, or when FILE is -, it reads standard input. Lines are numbered as one stream across the FILEs. A STYLE is a (all lines), t (non-empty lines, the default for the body), n (none, the default for headers and footers) or pBRE (lines that match the basic regular expression BRE). A line holding only \\:\\:\\: starts a header, \\:\\: a body and \\: a footer, and a new header starts the numbers again.',
  man: [
    {
      heading: 'FORMAT',
      body: 'The number is right-justified in NUMBER (6) columns, then STRING (a tab) follows. ln justifies it to the left; rz pads it with zeros. A line that is not numbered is indented by the same width.',
    },
    { heading: 'EXIT STATUS', body: '0 when every FILE was read, 1 otherwise.' },
  ],
};

type Style = { readonly kind: 'a' | 't' | 'n' } | { readonly kind: 'p'; readonly re: SafeRegex };

function readStyle(text: string, which: string): Style | string {
  if (text === 'a' || text === 't' || text === 'n') return { kind: text };
  if (text.startsWith('p')) {
    try {
      return { kind: 'p', re: compilePatterns([text.slice(1)], { syntax: 'basic' }) };
    } catch (error) {
      const message = patternMessage(error);
      if (message === null) throw error;
      return message;
    }
  }
  return `invalid ${which} numbering style: ${quoted(text)}`;
}

export async function run(ctx: CommandContext): Promise<ExitCode> {
  const styles: Style[] = [];
  for (const [key, which, fallback] of [
    ['header-numbering', 'header', 'n'],
    ['body-numbering', 'body', 't'],
    ['footer-numbering', 'footer', 'n'],
  ] as const) {
    const style = readStyle(optString(ctx, key) ?? fallback, which);
    if (typeof style === 'string') return ctx.usage(style);
    styles.push(style);
  }
  const format = optString(ctx, 'number-format') ?? 'rn';
  if (format !== 'ln' && format !== 'rn' && format !== 'rz') return ctx.usage(`invalid line numbering format: ${quoted(format)}`);
  const width = Number(ctx.opts['number-width'] ?? 6);
  if (width <= 0) return ctx.usage(`invalid line number field width: ${quoted(String(width))}: Numerical result out of range`);
  const separator = optString(ctx, 'number-separator') ?? '\t';
  const start = Number(ctx.opts['starting-line-number'] ?? 1);
  const increment = Number(ctx.opts['line-increment'] ?? 1);
  const renumber = !optOn(ctx, 'no-renumber');
  const blank = ' '.repeat(width + separator.length);

  const number = (n: number): string => {
    const digits = String(Math.abs(n));
    const sign = n < 0 ? '-' : '';
    if (format === 'ln') return (sign + digits).padEnd(width);
    if (format === 'rz') return sign + digits.padStart(width - sign.length, '0');
    return (sign + digits).padStart(width);
  };

  const breathe = pacer(ctx);
  let line = start;
  let section = 1;
  let status = 0;
  for (const file of operands(ctx)) {
    const records = await openRecords(ctx, file);
    if (records === null) {
      status = 1;
      continue;
    }
    let buffer = '';
    for await (const record of records) {
      const text = record.text;
      const delimiter = text === '\\:\\:\\:' ? 0 : text === '\\:\\:' ? 1 : text === '\\:' ? 2 : -1;
      if (delimiter !== -1) {
        section = delimiter;
        if (delimiter === 0 && renumber) line = start;
        buffer += '\n';
        continue;
      }
      const style = styles[section] as Style;
      let numbered: boolean;
      if (style.kind === 'p') {
        try {
          style.re.check(text);
        } catch (error) {
          await ctx.stdout.write(buffer);
          return ctx.fail(patternMessage(error) ?? String(error));
        }
        style.re.regex.lastIndex = 0;
        numbered = style.re.regex.test(text);
      } else {
        numbered = style.kind === 'a' || (style.kind === 't' && text !== '');
      }
      if (numbered) {
        buffer += `${number(line)}${separator}${text}\n`;
        line += increment;
      } else {
        buffer += `${blank}${text}\n`;
      }
      if (buffer.length > 4096) {
        await ctx.stdout.write(buffer);
        buffer = '';
      }
      await breathe();
    }
    if (buffer !== '') await ctx.stdout.write(buffer);
  }
  return status;
}
