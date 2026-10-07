// The body of expr; its spec, in expr.ts, loads this the first time expr runs.

import { compareNames } from '../../../shell/glob';
import type { CommandContext, CommandDoc, ExitCode } from '../../../shell/types';
import { compilePatterns, patternMessage } from '../../lib/regex';
import { quoted } from '../../lib/text-input';

export const doc: CommandDoc = {
  description:
    "Prints the value of EXPRESSION, whose words are separate arguments, so operators must be separated by spaces and quoted from the shell where they mean something to it (* < > ( ) | &). From the loosest: ARG1 | ARG2 (ARG1 unless it is null or 0, else ARG2), ARG1 & ARG2, the comparisons < <= = == != >= >, + and -, * / and %, and STRING : REGEXP. Whole numbers may be as large as you like. Comparisons are numeric when both sides are whole numbers, and otherwise by text. STRING : REGEXP matches the basic regular expression at the start of STRING and gives what \\( \\) matched, or else how many characters matched. match STRING REGEXP, substr STRING POS LENGTH, index STRING CHARS and length STRING are also known, and + TOKEN takes TOKEN as a string even when it is a keyword.",
  man: [
    {
      heading: 'EXIT STATUS',
      body: '0 when EXPRESSION is neither null nor 0, 1 when it is null or 0, 2 when it is not valid, and 3 when an error occurred.',
    },
  ],
};

type Value = bigint | string;

class ExprError extends Error {
  constructor(
    message: string,
    readonly status: ExitCode = 2,
  ) {
    super(message);
  }
}

const INTEGER = /^-?\d+$/;

function toInt(v: Value): bigint {
  if (typeof v === 'bigint') return v;
  if (INTEGER.test(v)) return BigInt(v);
  throw new ExprError('non-integer argument');
}

function text(v: Value): string {
  return typeof v === 'bigint' ? v.toString() : v;
}

/** Null or zero: the empty string, or a number that is 0 (`0`, `00`, `-0`). */
export function isNull(v: Value): boolean {
  if (typeof v === 'bigint') return v === 0n;
  return v === '' || /^-?0+$/.test(v);
}

class Parser {
  private i = 0;

  constructor(
    private readonly words: readonly string[],
    private readonly collate: (a: string, b: string) => number,
  ) {}

  private peek(): string | undefined {
    return this.words[this.i];
  }

  private take(): string {
    const word = this.words[this.i];
    if (word === undefined) throw new ExprError(`syntax error: missing argument after ${quoted(this.words[this.i - 1] ?? '')}`);
    this.i += 1;
    return word;
  }

  run(): Value {
    const value = this.or();
    if (this.i < this.words.length) throw new ExprError(`syntax error: unexpected argument ${quoted(this.words[this.i] ?? '')}`);
    return value;
  }

  private or(): Value {
    let left = this.and();
    while (this.peek() === '|') {
      this.i += 1;
      const right = this.and();
      left = !isNull(left) ? left : !isNull(right) ? right : 0n;
    }
    return left;
  }

  private and(): Value {
    let left = this.compare();
    while (this.peek() === '&') {
      this.i += 1;
      const right = this.compare();
      left = isNull(left) || isNull(right) ? 0n : left;
    }
    return left;
  }

  private compare(): Value {
    let left = this.sum();
    for (;;) {
      const op = this.peek();
      if (op !== '<' && op !== '<=' && op !== '=' && op !== '==' && op !== '!=' && op !== '>=' && op !== '>') return left;
      this.i += 1;
      const right = this.sum();
      const a = text(left);
      const b = text(right);
      const diff = INTEGER.test(a) && INTEGER.test(b) ? (BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0) : a === b ? 0 : this.collate(a, b);
      const holds = op === '<' ? diff < 0 : op === '<=' ? diff <= 0 : op === '=' || op === '==' ? diff === 0 : op === '!=' ? diff !== 0 : op === '>=' ? diff >= 0 : diff > 0;
      left = holds ? 1n : 0n;
    }
  }

  private sum(): Value {
    let left = this.product();
    for (;;) {
      const op = this.peek();
      if (op !== '+' && op !== '-') return left;
      this.i += 1;
      const right = this.product();
      left = op === '+' ? toInt(left) + toInt(right) : toInt(left) - toInt(right);
    }
  }

  private product(): Value {
    let left = this.match();
    for (;;) {
      const op = this.peek();
      if (op !== '*' && op !== '/' && op !== '%') return left;
      this.i += 1;
      const right = this.match();
      const a = toInt(left);
      const b = toInt(right);
      if (op !== '*' && b === 0n) throw new ExprError('division by zero');
      left = op === '*' ? a * b : op === '/' ? a / b : a % b;
    }
  }

  private match(): Value {
    let left = this.unary();
    while (this.peek() === ':') {
      this.i += 1;
      left = this.regexMatch(left, this.unary());
    }
    return left;
  }

  private regexMatch(subject: Value, pattern: Value): Value {
    const s = text(subject);
    let safe;
    try {
      // Anchored at the start, as POSIX expr is.
      safe = compilePatterns([text(pattern)], { syntax: 'basic', start: true });
      safe.check(s);
    } catch (error) {
      const message = patternMessage(error);
      if (message === null) throw error;
      throw new ExprError(message);
    }
    const m = safe.regex.exec(s);
    if (safe.groups > 0) return m?.[1] ?? '';
    return BigInt(m === null ? 0 : Array.from(m[0]).length);
  }

  private unary(): Value {
    const word = this.peek();
    if (word === undefined) throw new ExprError(`syntax error: missing argument after ${quoted(this.words[this.i - 1] ?? '')}`);
    if (word === '(') {
      this.i += 1;
      const value = this.or();
      const close = this.peek();
      if (close !== ')') {
        throw new ExprError(close === undefined ? `syntax error: expecting ')' after ${quoted(this.words[this.i - 1] ?? '')}` : `syntax error: expecting ')' instead of ${quoted(close)}`);
      }
      this.i += 1;
      return value;
    }
    if (word === '+') {
      this.i += 1;
      return this.take();
    }
    if (word === 'length') {
      this.i += 1;
      return BigInt(Array.from(text(this.unary())).length);
    }
    if (word === 'match') {
      this.i += 1;
      const subject = this.unary();
      return this.regexMatch(subject, this.unary());
    }
    if (word === 'index') {
      this.i += 1;
      const s = Array.from(text(this.unary()));
      const chars = new Set(Array.from(text(this.unary())));
      return BigInt(s.findIndex((c) => chars.has(c)) + 1);
    }
    if (word === 'substr') {
      this.i += 1;
      const s = Array.from(text(this.unary()));
      const pos = text(this.unary());
      const len = text(this.unary());
      if (!/^\d+$/.test(pos) || !/^\d+$/.test(len)) return '';
      const from = Number(pos);
      const count = Number(len);
      if (from < 1 || count < 1 || from > s.length) return '';
      return s.slice(from - 1, from - 1 + count).join('');
    }
    this.i += 1;
    return word;
  }
}

export async function run(ctx: CommandContext): Promise<ExitCode> {
  const words = ctx.args[0] === '--' ? ctx.args.slice(1) : ctx.args;
  if (words.length === 0) return ctx.usage('missing operand');
  const locale = ctx.env.get('LC_ALL') || ctx.env.get('LC_COLLATE') || ctx.env.get('LANG') || 'C';
  const collate = locale === 'C' || locale === 'POSIX' ? (a: string, b: string) => (a < b ? -1 : 1) : compareNames;
  let value: Value;
  try {
    value = new Parser(words, collate).run();
  } catch (error) {
    if (error instanceof ExprError) return ctx.fail(error.message, error.status);
    throw error;
  }
  await ctx.stdout.write(`${text(value)}\n`);
  return isNull(value) ? 1 : 0;
}
