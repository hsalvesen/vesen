// The body of printf; its spec, in printf.ts, loads this the first time printf runs, so the
// kernel's chunk carries only the spec.

import { isVariableName } from '../../shell/session';
import { MAX_INPUT, type CommandContext, type CommandDoc, type ExitCode } from '../../shell/types';
import { readEscape, unescape } from '../lib/escapes';

/** What --help, help and man say about printf, besides its spec (printf.ts). */
export const doc: CommandDoc = {
  description:
    'Prints the ARGUMENTs as FORMAT says, reusing FORMAT until they run out. FORMAT is text with backslash escapes (\\n, \\t) and conversions: %s a string, %d or %i an integer, %f a decimal, %x hex, %o octal, %c a character, %b a string with escapes read, %q a string quoted for the shell, %% a percent sign. A width and precision go between: %-10s, %5.2f, %05d. Unlike echo, printf adds no newline of its own. With -v VAR, the result goes into the variable VAR instead.',
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
};

/** The widest field and the longest precision printf makes. */
export const MAX_FIELD = 65_535;

const field = (n: number): number => Math.min(MAX_FIELD, n);

type Width = number | '*' | null;

interface Conversion {
  readonly kind: 'conv';
  readonly flags: string;
  readonly width: Width;
  readonly precision: Width;
  readonly letter: string;
}

type Piece = { readonly kind: 'text'; readonly text: string } | { readonly kind: 'stop' } | Conversion;

const SPEC = /^%([-+ #0']*)(\*|\d+)?(?:\.(\*|\d*))?(?:hh|h|ll|l|L|q|j|z|t)?([a-zA-Z])/;
const CONVERSIONS = 'diouxXfFeEgGcsbq';

/** Characters bash's %q puts a backslash before. */
const SHELL_SPECIAL = new Set(Array.from(' \t\'"\\|&;()<>!{}*[?]^$`,'));

/** A word quoted so the shell reads it back as it is, as bash's %q does. */
export function shellQuoteQ(text: string): string {
  if (text === '') return "''";
  if (/[\x00-\x1f\x7f]/.test(text)) {
    const named: Record<string, string> = { '\x07': '\\a', '\b': '\\b', '\t': '\\t', '\n': '\\n', '\v': '\\v', '\f': '\\f', '\r': '\\r', '\x1b': '\\E', "'": "\\'", '\\': '\\\\' };
    let body = '';
    for (const c of text) {
      const code = c.charCodeAt(0);
      body += named[c] ?? (code < 0x20 || code === 0x7f ? `\\${code.toString(8).padStart(3, '0')}` : c);
    }
    return `$'${body}'`;
  }
  let out = '';
  Array.from(text).forEach((c, i) => {
    if (SHELL_SPECIAL.has(c) || (i === 0 && (c === '~' || c === '#'))) out += `\\${c}`;
    else out += c;
  });
  return out;
}

/** Splits a format into text, \c and conversions; a bad conversion is an error in GNU's words. */
export function parseFormat(format: string): Piece[] | { error: string } {
  const pieces: Piece[] = [];
  let text = '';
  const flush = (): void => {
    if (text !== '') pieces.push({ kind: 'text', text });
    text = '';
  };
  let i = 0;
  while (i < format.length) {
    const c = format.charAt(i);
    if (c === '\\') {
      const read = readEscape(format, i, 'format');
      if (read === null) {
        flush();
        pieces.push({ kind: 'stop' });
        return pieces;
      }
      text += read.value;
      i = read.next;
      continue;
    }
    if (c !== '%') {
      text += c;
      i += 1;
      continue;
    }
    if (format.charAt(i + 1) === '%') {
      text += '%';
      i += 2;
      continue;
    }
    const match = SPEC.exec(format.slice(i));
    const letter = match?.[4];
    if (match === null || letter === undefined || !CONVERSIONS.includes(letter)) {
      const shown = match?.[0] ?? format.slice(i, i + 2);
      return { error: `${shown}: invalid conversion specification` };
    }
    flush();
    const width = match[2] === undefined ? null : match[2] === '*' ? '*' : field(Number(match[2]));
    const precision = match[3] === undefined ? null : match[3] === '*' ? '*' : field(Number(match[3] || '0'));
    pieces.push({ kind: 'conv', flags: match[1] ?? '', width, precision, letter });
    i += match[0].length;
  }
  flush();
  return pieces;
}

// ── Numbers ────────────────────────────────────────────────────────────────────────────────

interface Read<T> {
  readonly value: T;
  readonly error?: string;
}

const INTEGER = /^\s*([+-]?)(0[xX][0-9a-fA-F]+|0[0-7]*|[1-9][0-9]*)/;

/** An integer argument: decimal, 0x hex, 0 octal, or 'c for the character's code. */
export function readInteger(text: string | undefined): Read<bigint> {
  if (text === undefined || text === '') return { value: 0n };
  if (/^['"]./u.test(text)) return { value: BigInt(text.codePointAt(1) ?? 0) };
  const match = INTEGER.exec(text);
  if (match === null) return { value: 0n, error: `'${text}': expected a numeric value` };
  const digits = match[2] ?? '0';
  let magnitude: bigint;
  if (/^0[xX]/.test(digits)) magnitude = BigInt(digits);
  else if (digits.length > 1 && digits.startsWith('0')) magnitude = BigInt(`0o${digits.slice(1)}`);
  else magnitude = BigInt(digits);
  const value = match[1] === '-' ? -magnitude : magnitude;
  if (match[0].length !== text.length) return { value, error: `'${text}': value not completely converted` };
  return { value };
}

const FLOAT = /^\s*[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;

/** A floating-point argument, inf and nan included. */
export function readFloat(text: string | undefined): Read<number> {
  if (text === undefined || text === '') return { value: 0 };
  if (/^['"]./u.test(text)) return { value: text.codePointAt(1) ?? 0 };
  const special = /^\s*([+-]?)(inf(?:inity)?|nan)$/i.exec(text);
  if (special !== null) {
    const value = /^n/i.test(special[2] ?? '') ? Number.NaN : Number.POSITIVE_INFINITY;
    return { value: special[1] === '-' ? -value : value };
  }
  const match = FLOAT.exec(text);
  if (match === null) {
    const integer = readInteger(text);
    return integer.error === undefined ? { value: Number(integer.value) } : { value: 0, error: integer.error };
  }
  const value = Number(match[0].trim());
  if (match[0].length !== text.length) {
    // Hex and octal integers read as integers do.
    const integer = readInteger(text);
    if (integer.error === undefined) return { value: Number(integer.value) };
    return { value, error: `'${text}': value not completely converted` };
  }
  return { value };
}

// ── Formatting ─────────────────────────────────────────────────────────────────────────────

function pad(sign: string, prefix: string, body: string, width: number, flags: string, zeros: boolean): string {
  const core = sign + prefix + body;
  if (core.length >= width) return core;
  if (flags.includes('-')) return core + ' '.repeat(width - core.length);
  if (zeros && flags.includes('0')) return sign + prefix + '0'.repeat(width - core.length) + body;
  return ' '.repeat(width - core.length) + core;
}

function signOf(negative: boolean, flags: string): string {
  if (negative) return '-';
  if (flags.includes('+')) return '+';
  if (flags.includes(' ')) return ' ';
  return '';
}

/** x.toExponential(digits) in C's form: two exponent digits at least, as 1.500000e+00. */
function exponential(x: number, digits: number): string {
  const [mantissa = '0', exponent = '+0'] = x.toExponential(Math.min(100, digits)).split('e');
  const sign = exponent.startsWith('-') ? '-' : '+';
  return `${mantissa}e${sign}${exponent.replace(/^[+-]/, '').padStart(2, '0')}`;
}

function stripZeros(text: string): string {
  const [number = '', exponent] = text.split('e');
  const trimmed = number.includes('.') ? number.replace(/0+$/, '').replace(/\.$/, '') : number;
  return exponent === undefined ? trimmed : `${trimmed}e${exponent}`;
}

function formatFloat(value: number, letter: string, precision: number | null, flags: string, width: number): string {
  const negative = value < 0 || Object.is(value, -0);
  const sign = signOf(negative, flags);
  const upper = letter === 'F' || letter === 'E' || letter === 'G';
  const x = Math.abs(value);
  if (!Number.isFinite(x)) {
    const body = Number.isNaN(x) ? 'nan' : 'inf';
    return pad(sign, '', upper ? body.toUpperCase() : body, width, flags, false);
  }
  const p = Math.min(100, precision ?? 6);
  let body: string;
  switch (letter.toLowerCase()) {
    case 'f':
      body = x.toFixed(p);
      break;
    case 'e':
      body = exponential(x, p);
      break;
    default: {
      const significant = p === 0 ? 1 : p;
      const exponent = x === 0 ? 0 : Number(exponential(x, significant - 1).split('e')[1]);
      body = significant > exponent && exponent >= -4 ? x.toFixed(Math.min(100, significant - 1 - exponent)) : exponential(x, significant - 1);
      if (!flags.includes('#')) body = stripZeros(body);
    }
  }
  return pad(sign, '', upper ? body.toUpperCase() : body, width, flags, true);
}

function formatInteger(value: bigint, letter: string, precision: number | null, flags: string, width: number): string {
  const signed = letter === 'd' || letter === 'i';
  const unsigned = signed ? value : BigInt.asUintN(64, value);
  const negative = signed && unsigned < 0n;
  const magnitude = negative ? -unsigned : unsigned;
  const base = letter === 'o' ? 8 : letter === 'x' || letter === 'X' ? 16 : 10;
  let digits = magnitude.toString(base);
  if (letter === 'X') digits = digits.toUpperCase();
  if (precision !== null) digits = precision === 0 && magnitude === 0n ? '' : digits.padStart(precision, '0');
  let prefix = '';
  if (flags.includes('#') && magnitude !== 0n) {
    if (letter === 'x') prefix = '0x';
    else if (letter === 'X') prefix = '0X';
    else if (letter === 'o' && !digits.startsWith('0')) prefix = '0';
  }
  return pad(signed ? signOf(negative, flags) : '', prefix, digits, width, flags, precision === null);
}

export interface Formatted {
  readonly text: string;
  readonly errors: readonly string[];
}

/** Applies the format to the arguments, reusing it while arguments are left. */
export function format(pieces: readonly Piece[], args: readonly string[]): Formatted {
  const errors: string[] = [];
  let text = '';
  for (const part of formatParts(pieces, args, errors)) text += part;
  return { text, errors };
}

/**
 * The formatted text a conversion at a time, so a long result can be written as it is made
 * rather than held whole; the errors are added to `errors` as they come.
 */
export function* formatParts(pieces: readonly Piece[], args: readonly string[], errors: string[]): Generator<string, void, undefined> {
  let next = 0;
  const take = (): string | undefined => (next < args.length ? args[next++] : undefined);
  const takeInt = (): number => {
    const read = readInteger(take());
    if (read.error !== undefined) errors.push(read.error);
    const n = Number(read.value);
    return n < 0 ? -field(-n) : field(n);
  };
  const consumes = pieces.some((piece) => piece.kind === 'conv');
  do {
    for (const piece of pieces) {
      if (piece.kind === 'text') {
        yield piece.text;
        continue;
      }
      if (piece.kind === 'stop') return;
      let flags = piece.flags;
      let width = piece.width === '*' ? takeInt() : (piece.width ?? 0);
      if (width < 0) {
        flags += '-';
        width = -width;
      }
      let precision = piece.precision === '*' ? takeInt() : piece.precision;
      if (precision !== null && precision < 0) precision = null;
      const arg = take();
      switch (piece.letter) {
        case 's': {
          const value = arg ?? '';
          yield pad('', '', precision === null ? value : Array.from(value).slice(0, precision).join(''), width, flags, false);
          break;
        }
        case 'b': {
          const read = unescape(arg ?? '', 'echo');
          const value = precision === null ? read.text : read.text.slice(0, precision);
          yield pad('', '', value, width, flags, false);
          if (read.stop) return;
          break;
        }
        case 'c':
          yield pad('', '', Array.from(arg ?? '')[0] ?? '', width, flags, false);
          break;
        case 'q': {
          const value = shellQuoteQ(arg ?? '');
          yield pad('', '', precision === null ? value : value.slice(0, precision), width, flags, false);
          break;
        }
        case 'd':
        case 'i':
        case 'o':
        case 'u':
        case 'x':
        case 'X': {
          const read = readInteger(arg);
          if (read.error !== undefined) errors.push(read.error);
          yield formatInteger(read.value, piece.letter, precision, flags, width);
          break;
        }
        default: {
          const read = readFloat(arg);
          if (read.error !== undefined) errors.push(read.error);
          yield formatFloat(read.value, piece.letter, precision, flags, width);
        }
      }
    }
  } while (consumes && next < args.length);
}

/** Runs printf. */
export async function run(ctx: CommandContext): Promise<ExitCode | void> {
  const [fmt, ...rest] = ctx.args;
  const variable = typeof ctx.opts.var === 'string' ? ctx.opts.var : undefined;
  if (variable !== undefined && !isVariableName(variable)) return ctx.fail(`\`${variable}': not a valid identifier`, 2);
  if (fmt === undefined) return ctx.usage('missing operand');
  const pieces = parseFormat(fmt);
  if (!Array.isArray(pieces)) return ctx.fail(pieces.error);
  const errors: string[] = [];
  let text = '';
  for (const part of formatParts(pieces, rest, errors)) {
    text += part;
    if (variable !== undefined) {
      // A variable holds the whole result, so it is held to what standard input may be.
      if (text.length > MAX_INPUT) return ctx.fail(`${variable}: value too large (over 16 MB)`);
    } else if (text.length >= 65_536) {
      // Written as it is made, so a pipe's reader paces it and ^C is heard.
      await ctx.stdout.write(text);
      text = '';
      if (ctx.signal.aborted) throw ctx.signal.reason;
    }
  }
  if (variable !== undefined) ctx.env.set(variable, text);
  else await ctx.stdout.write(text);
  for (const error of errors) await ctx.fail(error);
  return errors.length > 0 ? 1 : 0;
}
