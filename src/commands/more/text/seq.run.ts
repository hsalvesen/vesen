// The body of seq; its spec, in seq.ts, loads this the first time seq runs.

import type { CommandContext, CommandDoc, ExitCode } from '../../../shell/types';
import { format, parseFormat } from '../../text/printf.run';
import { pacer, quoted } from '../../lib/text-input';

export const doc: CommandDoc = {
  description:
    'Prints numbers from FIRST to LAST, in steps of INCREMENT. FIRST and INCREMENT default to 1; a negative INCREMENT counts down. Whole numbers are exact however large; with a fraction, each number is printed with as many decimal places as FIRST or INCREMENT has, as in `seq 1 0.5 3`. FORMAT is a printf format with one floating-point conversion: %e, %f or %g, with any flags, width and precision.',
  man: [
    {
      heading: 'NOTES',
      body: 'Fractions are ordinary floating-point numbers, so each is FIRST plus a whole number of steps and small errors do not add up, but a step such as 0.1 is never exact.',
    },
    { heading: 'EXIT STATUS', body: '0 on success, 1 for a bad operand or format.' },
  ],
};

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

interface Operand {
  readonly text: string;
  readonly value: number;
  /** Digits after the point, or null with an exponent (which makes the default format %g). */
  readonly precision: number | null;
  /** A whole number, written without a point or exponent. */
  readonly whole: boolean;
}

function readOperand(text: string): Operand | null {
  const trimmed = text.trim();
  const match = NUMBER.exec(trimmed);
  if (match === null) return null;
  const point = trimmed.indexOf('.');
  const exponent = match[2] !== undefined;
  return {
    text: trimmed,
    value: Number(trimmed),
    precision: exponent ? null : point === -1 ? 0 : trimmed.length - point - 1,
    whole: !exponent && point === -1,
  };
}

/** One number with leading zeros to `width`, after its sign. */
function zeroPad(text: string, width: number): string {
  const negative = text.startsWith('-');
  const digits = negative ? text.slice(1) : text;
  const pad = Math.max(0, width - text.length);
  return `${negative ? '-' : ''}${'0'.repeat(pad)}${digits}`;
}

/** Checks a -f FORMAT: exactly one floating-point directive. Returns GNU's complaint, or null. */
export function checkFormat(fmt: string): string | null {
  let directives = 0;
  for (let i = 0; i < fmt.length; i += 1) {
    if (fmt.charAt(i) !== '%') continue;
    if (fmt.charAt(i + 1) === '%') {
      i += 1;
      continue;
    }
    const match = /^%[-+ #0']*\d*(\.\d*)?([a-zA-Z]?)/.exec(fmt.slice(i));
    const letter = match?.[2] ?? '';
    if (!/^[aAeEfFgG]$/.test(letter)) return `format ${quoted(fmt)} has unknown %${letter} directive`;
    directives += 1;
    i += (match?.[0].length ?? 1) - 1;
  }
  if (directives === 0) return `format ${quoted(fmt)} has no % directive`;
  if (directives > 1) return `format ${quoted(fmt)} has too many % directives`;
  return null;
}

interface Parsed {
  readonly format?: string;
  readonly separator: string;
  readonly equalWidth: boolean;
  readonly operands: readonly string[];
}

/** GNU seq's options: they end at the first operand, and a word like -5 or -.5 is an operand. */
function parseArgs(words: readonly string[]): Parsed | { error: string } {
  let fmt: string | undefined;
  let separator = '\n';
  let equalWidth = false;
  let i = 0;
  const value = (name: string, attached: string): string | { error: string } => {
    if (attached !== '') return attached;
    const next = words[i + 1];
    if (next === undefined) return { error: name.startsWith('--') ? `option '${name}' requires an argument` : `option requires an argument -- '${name.slice(1)}'` };
    i += 1;
    return next;
  };
  for (; i < words.length; i += 1) {
    const word = words[i] ?? '';
    if (word === '--') {
      i += 1;
      break;
    }
    if (!word.startsWith('-') || word === '-' || /^-[\d.]/.test(word)) break;
    if (word.startsWith('--')) {
      const eq = word.indexOf('=');
      const name = eq === -1 ? word : word.slice(0, eq);
      const attached = eq === -1 ? '' : word.slice(eq + 1);
      const matches = ['--format', '--separator', '--equal-width'].filter((long) => long.startsWith(name));
      if (matches.length !== 1) return { error: matches.length === 0 ? `unrecognized option '${word}'` : `option '${word}' is ambiguous` };
      const long = matches[0];
      if (long === '--equal-width') {
        equalWidth = true;
        continue;
      }
      const got = eq === -1 ? value(long ?? '', '') : attached;
      if (typeof got !== 'string') return got;
      if (long === '--format') fmt = got;
      else separator = got;
      continue;
    }
    for (let k = 1; k < word.length; k += 1) {
      const c = word.charAt(k);
      if (c === 'w') {
        equalWidth = true;
        continue;
      }
      if (c === 'f' || c === 's') {
        const got = value(`-${c}`, word.slice(k + 1));
        if (typeof got !== 'string') return got;
        if (c === 'f') fmt = got;
        else separator = got;
        break;
      }
      return { error: `invalid option -- '${c}'` };
    }
  }
  return { ...(fmt === undefined ? {} : { format: fmt }), separator, equalWidth, operands: words.slice(i) };
}

export async function run(ctx: CommandContext): Promise<ExitCode> {
  const parsed = parseArgs(ctx.args);
  if ('error' in parsed) return ctx.usage(parsed.error);
  const { operands, separator, equalWidth } = parsed;
  if (operands.length === 0) return ctx.usage('missing operand');
  if (operands.length > 3) return ctx.usage(`extra operand ${quoted(operands[3] ?? '')}`);
  const read: Operand[] = [];
  for (const text of operands) {
    const operand = readOperand(text);
    if (operand === null) return ctx.usage(`invalid floating point argument: ${quoted(text)}`);
    read.push(operand);
  }
  const one: Operand = { text: '1', value: 1, precision: 0, whole: true };
  const [first, step, last] = read.length === 1 ? [one, one, read[0] as Operand] : read.length === 2 ? [read[0] as Operand, one, read[1] as Operand] : (read as [Operand, Operand, Operand]);
  if (step.value === 0) return ctx.usage(`invalid Zero increment value: ${quoted(step.text)}`);
  if (parsed.format !== undefined && equalWidth) return ctx.usage('format string may not be specified when printing equal width strings');
  if (parsed.format !== undefined) {
    const problem = checkFormat(parsed.format);
    if (problem !== null) return ctx.fail(problem);
  }

  const breathe = pacer(ctx);
  let buffer = '';
  let count = 0;
  const emit = async (text: string): Promise<void> => {
    buffer += count === 0 ? text : separator + text;
    count += 1;
    if (buffer.length >= 4096) {
      await ctx.stdout.write(buffer);
      buffer = '';
      await breathe();
    }
  };

  if (parsed.format === undefined && first.whole && step.whole && last.whole) {
    // Whole numbers: exact, however large.
    const a = BigInt(first.text.replace(/^\+/, ''));
    const s = BigInt(step.text.replace(/^\+/, ''));
    const z = BigInt(last.text.replace(/^\+/, ''));
    const width = equalWidth ? Math.max(String(a).length, String(z).length) : 0;
    for (let x = a; s > 0n ? x <= z : x >= z; x += s) await emit(equalWidth ? zeroPad(String(x), width) : String(x));
  } else {
    const precision = first.precision === null || step.precision === null || last.precision === null ? null : Math.max(first.precision, step.precision);
    // A -f FORMAT, or %g when an operand has an exponent.
    const formatText = parsed.format ?? (precision === null ? '%g' : null);
    const pieces = formatText === null ? null : parseFormat(formatText);
    if (pieces !== null && 'error' in pieces) return ctx.fail(pieces.error);
    let width = 0;
    if (equalWidth && precision !== null) {
      const widthOf = (o: Operand): number => o.text.length + (precision - (o.precision ?? 0)) + ((o.precision ?? 0) === 0 && precision > 0 ? 1 : 0) - ((o.precision ?? 0) > 0 && precision === 0 ? 1 : 0);
      width = Math.max(widthOf(first), widthOf(last));
    }
    const show = (x: number): string => {
      if (pieces !== null) return format(pieces, [String(x)]).text;
      const text = x.toFixed(precision ?? 0);
      return equalWidth ? zeroPad(text, width) : text;
    };
    const lastShown = show(last.value);
    for (let i = 0; ; i += 1) {
      const x = first.value + i * step.value;
      const past = step.value > 0 ? x > last.value : x < last.value;
      // A value a rounding error past LAST, which prints as LAST, still counts.
      if (past && show(x) !== lastShown) break;
      await emit(show(x));
      if (past) break;
    }
  }
  if (count > 0) buffer += '\n';
  if (buffer !== '') await ctx.stdout.write(buffer);
  return 0;
}
