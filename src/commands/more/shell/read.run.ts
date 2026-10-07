// The body of read; its spec, in read.ts, loads this the first time read runs.

import { isVariableName } from '../../../shell/session';
import type { CommandContext, CommandDoc, ExitCode } from '../../../shell/types';

/** What --help, help and man say about read, besides its spec (read.ts). */
export const doc: CommandDoc = {
  description:
    "Reads one line and splits it into words on $IFS (spaces, tabs and newlines unless set): the first word goes into the first NAME, the second into the second, and the last NAME gets the rest of the line. With no NAME, the whole line goes into $REPLY. It reads standard input: a pipe, a file with <, or a here-string with <<<; at the prompt, it asks for the line, after PROMPT with -p, and hides what you type with -s. A backslash keeps the next character from splitting and joins a line to the next, unless -r is given. In a pipeline read runs in a subshell, as in bash, so `echo hi | read X` leaves X as it was: use `read X <<< hi`.",
  man: [
    {
      heading: 'EXIT STATUS',
      body: '0 when a line was read; 1 at the end of the input, when the variables still get what was read, or for a NAME that is not one; 142 when -t ran out; 130 on ^C.',
    },
  ],
};

/** What read's status is when -t runs out: 128 and SIGALRM. */
const TIMED_OUT = 142;

/** One character of the input, and whether a backslash kept it from splitting. */
interface Char {
  readonly c: string;
  readonly quoted: boolean;
}

/** The input's characters with backslashes applied: `\x` is a quoted x; without -r. */
export function unescape(text: string, raw: boolean): Char[] {
  const chars: Char[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charAt(i);
    if (!raw && c === '\\' && i + 1 < text.length) {
      i += 1;
      chars.push({ c: text.charAt(i), quoted: true });
    } else if (!raw && c === '\\') {
      // A backslash at the very end has nothing to keep.
    } else {
      chars.push({ c, quoted: false });
    }
  }
  return chars;
}

/**
 * Splits `chars` into `count` fields on IFS, as read does: leading and trailing IFS whitespace
 * dropped, whitespace around a delimiter part of it, and the last field the rest of the line.
 */
export function splitFields(chars: readonly Char[], count: number, ifs: string): string[] {
  const white = (x: Char | undefined): boolean => x !== undefined && !x.quoted && ifs.includes(x.c) && ' \t\n'.includes(x.c);
  const delimiter = (x: Char | undefined): boolean => x !== undefined && !x.quoted && ifs.includes(x.c);
  const text = (from: number, to: number): string => chars.slice(from, to).map((x) => x.c).join('');
  let i = 0;
  const skipWhite = (): void => {
    while (white(chars[i])) i += 1;
  };
  skipWhite();
  const fields: string[] = [];
  for (let n = 0; n < count - 1; n += 1) {
    const start = i;
    while (i < chars.length && !delimiter(chars[i])) i += 1;
    fields.push(text(start, i));
    skipWhite();
    if (delimiter(chars[i]) && !white(chars[i])) {
      i += 1;
      skipWhite();
    }
  }
  let end = chars.length;
  while (end > i && white(chars[end - 1])) end -= 1;
  fields.push(text(i, end));
  return fields;
}

interface Input {
  readonly text: string;
  /** The input ended before the delimiter, or the prompt was answered with ^D. */
  readonly ended: boolean;
}

/** Reads standard input up to `delim` (or `limit` characters), joining lines a backslash continues. */
async function readStream(ctx: CommandContext, delim: string, limit: number | null, raw: boolean): Promise<Input> {
  let text = '';
  let count = 0;
  let pendingBackslash = false;
  for await (const chunk of ctx.stdin.chunks()) {
    for (const c of chunk) {
      if (pendingBackslash) {
        pendingBackslash = false;
        // A backslash and a newline join this line to the next.
        if (c === '\n') {
          text = text.slice(0, -1);
          continue;
        }
      } else if (c === delim) {
        return { text, ended: false };
      } else if (!raw && c === '\\') {
        pendingBackslash = true;
      }
      text += c;
      count += 1;
      if (limit !== null && count >= limit && !pendingBackslash) return { text, ended: false };
    }
  }
  return { text, ended: true };
}

/** Asks for the line at the prompt; ^D or ^C is the end of the input. */
async function readTerminal(ctx: CommandContext, prompt: string, secret: boolean, delim: string, limit: number | null, signal?: AbortSignal): Promise<Input> {
  const answer = await ctx.tty.readLine({ prompt, ...(secret ? { secret: true } : {}), ...(signal === undefined ? {} : { signal }) });
  if (answer === null) return { text: '', ended: true };
  let text = delim === '\n' || !answer.includes(delim) ? answer : answer.slice(0, answer.indexOf(delim));
  if (limit !== null) text = Array.from(text).slice(0, limit).join('');
  return { text, ended: false };
}

export async function run(ctx: CommandContext): Promise<ExitCode> {
  const names = ctx.args;
  for (const name of names) if (!isVariableName(name)) return ctx.fail(`\`${name}': not a valid identifier`);
  const raw = ctx.opts.r === true;
  const delimOpt = ctx.opts.d;
  const delim = typeof delimOpt === 'string' ? (delimOpt === '' ? '\0' : delimOpt.charAt(0)) : '\n';
  const nOpt = ctx.opts.n;
  if (typeof nOpt === 'number' && nOpt < 0) return ctx.fail(`${nOpt}: invalid number`);
  const limit = typeof nOpt === 'number' && nOpt > 0 ? nOpt : null;
  const tOpt = ctx.opts.t;
  let timeoutMs: number | null = null;
  if (typeof tOpt === 'string') {
    if (!/^(\d+(\.\d*)?|\.\d+)$/.test(tOpt)) return ctx.fail(`${tOpt}: invalid timeout specification`);
    timeoutMs = Number(tOpt) * 1000;
    // -t 0 only asks whether there is input to read, and reads none.
    if (timeoutMs === 0) return ctx.stdin.isTTY ? 1 : 0;
  }

  const timer = new AbortController();
  let timedOut = false;
  const reading = ctx.stdin.isTTY
    ? readTerminal(ctx, typeof ctx.opts.p === 'string' ? ctx.opts.p : '', ctx.opts.s === true, delim, limit, timeoutMs === null ? undefined : timer.signal)
    : readStream(ctx, delim, limit, raw);
  let input: Input;
  if (timeoutMs === null) {
    input = await reading;
  } else {
    const expired = ctx.clock.sleep(timeoutMs, timer.signal).then(
      (): Input => {
        timedOut = true;
        timer.abort();
        return { text: '', ended: true };
      },
      (): Input => ({ text: '', ended: true }),
    );
    input = await Promise.race([reading, expired]);
    if (!timedOut) timer.abort();
  }
  if (ctx.signal.aborted) return 130;

  const chars = unescape(input.text, raw);
  if (names.length === 0) {
    ctx.env.set('REPLY', chars.map((x) => x.c).join(''));
  } else {
    const ifs = ctx.env.get('IFS') ?? ' \t\n';
    const fields = splitFields(chars, names.length, ifs);
    names.forEach((name, i) => ctx.env.set(name, fields[i] ?? ''));
  }
  if (timedOut) return TIMED_OUT;
  return input.ended ? 1 : 0;
}
