// The body of bc; its spec, in bc.ts, loads this the first time bc runs. Numbers are exact
// decimals on BigInt (a value and a scale, the digits after the point), so + - * / % ^ and
// sqrt follow bc's scale rules digit for digit; the -l functions are computed with ten guard
// digits by series and cut to the scale.

import type { CommandContext, CommandDoc, ExitCode } from '../../../shell/types';
import { reason } from '../../lib/files';
import { optList, optOn, pacer } from '../../lib/text-input';

/** The most digits s, c, a, l and e work to: scale=5000; a(1)*4 takes about a third of a second. */
const MATH_DIGITS = 5000;

export const doc: CommandDoc = {
  description:
    "Reads a program from each FILE and then from standard input (or the -e expressions first), runs each statement as it comes, and prints the value of every expression that is not an assignment. On the terminal with nothing to read it asks for lines until Ctrl+D or quit. Statements are separated by ; or new lines; braces group them, and if/else, while, for, break, continue, print and quit work as in bc. Numbers have as many digits as they need; `scale` sets the digits kept after the point by / and sqrt (0 by default, 20 with -l), and ibase and obase (2 to 16) set the bases numbers are read and printed in.",
  man: [
    {
      heading: 'OPERATORS',
      body: "From the tightest: ++ -- (prefix and postfix), unary -, ^ (a whole power, right to left), * / %, + -, the assignments = += -= *= /= %= ^=, the comparisons < <= > >= == !=, then ! && ||. sqrt(x), length(x) (significant digits) and scale(x) (digits after the point) are built in; `last` is the last value printed.",
    },
    {
      heading: 'MATH LIBRARY',
      body: `-l sets scale to 20 and adds s(x) sine, c(x) cosine, a(x) arctangent (in radians), l(x) natural logarithm and e(x) exponential. Each is computed to ten more digits than the scale and then cut, so the last digit can differ from other implementations now and then. They work to a scale of at most ${MATH_DIGITS}, and to at most ${MATH_DIGITS + 1000} digits in all, counting those before the point: more would hold the page still for minutes, so either is an error.`,
    },
    {
      heading: 'LIMITS',
      body: 'A number may have up to 100000 digits. Function definitions (define), arrays and read() are not supported in vesen.',
    },
    { heading: 'EXIT STATUS', body: '0 when everything ran, 1 when a FILE could not be read or a statement failed.' },
  ],
};

// ── Numbers ────────────────────────────────────────────────────────────────────────────────

/** v / 10^s. */
export interface Num {
  readonly v: bigint;
  readonly s: number;
}

const MAX_DIGITS = 100_000;

class BcError extends Error {}

const powers: bigint[] = [1n];
function p10(n: number): bigint {
  if (n < 0) throw new BcError('negative power of ten');
  while (powers.length <= Math.min(n, 4096)) powers.push((powers[powers.length - 1] ?? 1n) * 10n);
  return n < powers.length ? (powers[n] as bigint) : 10n ** BigInt(n);
}

const ZERO: Num = { v: 0n, s: 0 };
const num = (v: bigint, s = 0): Num => ({ v, s });

function digits(v: bigint): number {
  return (v < 0n ? -v : v).toString().length;
}

function guard(n: Num): Num {
  if (digits(n.v) > MAX_DIGITS) throw new BcError(`number too long (over ${MAX_DIGITS} digits)`);
  return n;
}

/** n with `s` digits after the point: padded, or cut toward zero. */
export function rescale(n: Num, s: number): Num {
  if (s === n.s) return n;
  if (s > n.s) return { v: n.v * p10(s - n.s), s };
  return { v: n.v / p10(n.s - s), s };
}

export function add(a: Num, b: Num): Num {
  const s = Math.max(a.s, b.s);
  return { v: rescale(a, s).v + rescale(b, s).v, s };
}

export function neg(a: Num): Num {
  return { v: -a.v, s: a.s };
}

export function mul(a: Num, b: Num, scale: number): Num {
  const full = { v: a.v * b.v, s: a.s + b.s };
  return guard(rescale(full, Math.min(full.s, Math.max(scale, a.s, b.s))));
}

export function div(a: Num, b: Num, scale: number): Num {
  if (b.v === 0n) throw new BcError('Divide by zero');
  return guard({ v: (a.v * p10(b.s + scale)) / (b.v * p10(a.s)), s: scale });
}

export function mod(a: Num, b: Num, scale: number): Num {
  const q = div(a, b, scale);
  const r = add(a, neg({ v: q.v * b.v, s: q.s + b.s }));
  return rescale(r, Math.max(scale + b.s, a.s));
}

export function power(a: Num, b: Num, scale: number): Num {
  const n = rescale(b, 0).v;
  if (n === 0n) return num(1n);
  const magnitude = n < 0n ? -n : n;
  if (Number(magnitude) * Math.max(1, digits(a.v)) > MAX_DIGITS * 2) throw new BcError(`number too long (over ${MAX_DIGITS} digits)`);
  const exact = guard({ v: a.v ** magnitude, s: a.s * Number(magnitude) });
  if (n < 0n) return div(num(1n), exact, scale);
  return rescale(exact, Math.min(exact.s, Math.max(scale, a.s)));
}

/** The floor of the square root: Newton's method from a power of two above the root. */
export function isqrt(n: bigint): bigint {
  if (n < 2n) return n;
  let x = 1n << BigInt(Math.ceil((n.toString(16).length * 4) / 2));
  for (;;) {
    const y = (x + n / x) >> 1n;
    if (y >= x) return x;
    x = y;
  }
}

export function sqrt(a: Num, scale: number): Num {
  if (a.v < 0n) throw new BcError('Square root of a negative number');
  const s = Math.max(scale, a.s);
  return { v: isqrt(a.v * p10(2 * s - a.s)), s };
}

export function compare(a: Num, b: Num): number {
  const s = Math.max(a.s, b.s);
  const x = rescale(a, s).v;
  const y = rescale(b, s).v;
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Significant digits, as bc's length() counts them. */
function length(a: Num): number {
  if (a.v === 0n) return a.s === 0 ? 1 : a.s;
  const d = digits(a.v);
  return Math.max(d, a.s);
}

const DIGITS = '0123456789ABCDEF';

/** A number as bc prints it in `base`: no leading 0 before the point, every digit of the scale. */
export function format(a: Num, base = 10): string {
  if (a.v === 0n) return '0';
  const sign = a.v < 0n ? '-' : '';
  const abs = a.v < 0n ? -a.v : a.v;
  const unit = p10(a.s);
  const whole = abs / unit;
  let frac = abs % unit;
  let int: string;
  let fraction = '';
  if (base === 10) {
    const text = abs.toString().padStart(a.s + 1, '0');
    int = text.slice(0, text.length - a.s);
    fraction = text.slice(text.length - a.s);
  } else {
    int = whole.toString(base).toUpperCase();
    if (a.s > 0) {
      // As many digits in the base as it takes to show the scale's.
      let need = 0;
      for (let reach = 1n; reach < unit; reach *= BigInt(base)) need += 1;
      for (let k = 0; k < need; k += 1) {
        frac *= BigInt(base);
        fraction += DIGITS.charAt(Number(frac / unit));
        frac %= unit;
      }
    }
  }
  if (int === '0') int = '';
  return `${sign}${int}${a.s > 0 ? `.${fraction}` : ''}`;
}

/** bc breaks lines longer than 70 characters with a backslash. */
function wrap(text: string): string {
  let out = '';
  let rest = text;
  while (rest.length > 69) {
    out += `${rest.slice(0, 69)}\\\n`;
    rest = rest.slice(69);
  }
  return out + rest;
}

/** A number written in `ibase`: digits 0-9 and A-F, with an optional fraction. */
export function readNumber(text: string, base: number): Num {
  const [intPart = '', fracPart = ''] = text.split('.');
  // A lone digit letter is its own value whatever the base, as in bc.
  if (base === 10 && /^[0-9]*$/.test(intPart) && /^[0-9]*$/.test(fracPart)) return { v: BigInt(`${intPart || '0'}${fracPart}`), s: fracPart.length };
  const value = (ch: string): bigint => BigInt(Math.min(DIGITS.indexOf(ch), text.length === 1 ? 15 : base - 1));
  let v = 0n;
  for (const ch of intPart) v = v * BigInt(base) + value(ch);
  if (fracPart === '') return num(v);
  let numerator = 0n;
  let denominator = 1n;
  for (const ch of fracPart) {
    numerator = numerator * BigInt(base) + value(ch);
    denominator *= BigInt(base);
  }
  const s = fracPart.length;
  return { v: v * p10(s) + (numerator * p10(s)) / denominator, s };
}

// ── The math library ───────────────────────────────────────────────────────────────────────

/** Fixed point at `w` digits: a value times 10^w. */
const fx = {
  mul: (a: bigint, b: bigint, one: bigint): bigint => (a * b) / one,
  div: (a: bigint, b: bigint, one: bigint): bigint => (a * one) / b,
};

function expFixed(x: bigint, w: number): bigint {
  const one = p10(w);
  let k = 0;
  let y = x;
  while ((y < 0n ? -y : y) > one / 2n) {
    y /= 2n;
    k += 1;
  }
  let sum = one;
  let term = one;
  for (let n = 1n; ; n += 1n) {
    term = fx.mul(term, y, one) / n;
    if (term === 0n) break;
    sum += term;
  }
  for (let i = 0; i < k; i += 1) sum = fx.mul(sum, sum, one);
  return sum;
}

function atanFixed(x: bigint, w: number): bigint {
  const one = p10(w);
  let y = x;
  let k = 0;
  // atan(x) = 2 atan(x / (1 + sqrt(1 + x^2))) until x is small.
  while ((y < 0n ? -y : y) > one / 5n) {
    y = fx.div(y, one + isqrt(one * one + y * y), one);
    k += 1;
  }
  const y2 = fx.mul(y, y, one);
  let sum = y;
  let power = y;
  for (let n = 3n; ; n += 2n) {
    power = -fx.mul(power, y2, one);
    const term = power / n;
    if (term === 0n) break;
    sum += term;
  }
  return sum * 2n ** BigInt(k);
}

function lnFixed(x: bigint, w: number): bigint {
  const one = p10(w);
  if (x <= 0n) throw new BcError('logarithm of a number that is not positive');
  let y = x;
  let k = 0;
  while (y >= 2n * one || y * 2n <= one) {
    y = isqrt(y * one);
    k += 1;
  }
  const u = fx.div(y - one, y + one, one);
  const u2 = fx.mul(u, u, one);
  let sum = u;
  let power = u;
  for (let n = 3n; ; n += 2n) {
    power = fx.mul(power, u2, one);
    const term = power / n;
    if (term === 0n) break;
    sum += term;
  }
  return 2n * sum * 2n ** BigInt(k);
}

function sinCosFixed(x: bigint, w: number, cosine: boolean): bigint {
  const one = p10(w);
  const twoPi = 8n * atanFixed(one, w);
  let y = x % twoPi;
  if (y > twoPi / 2n) y -= twoPi;
  if (y < -twoPi / 2n) y += twoPi;
  const y2 = fx.mul(y, y, one);
  let term = cosine ? one : y;
  let sum = term;
  for (let n = cosine ? 1n : 2n; ; n += 2n) {
    term = -fx.mul(term, y2, one) / (cosine ? n * (n + 1n) : n * (n + 1n));
    if (term === 0n) break;
    sum += term;
  }
  return sum;
}

/** A library function at the current scale, with ten guard digits. */
function library(name: string, x: Num, scale: number): Num {
  const magnitude = Math.max(0, digits(rescale(x, 0).v));
  // The series run without a pause, so their precision is held where they finish in a moment.
  if (scale > MATH_DIGITS) throw new BcError(`scale too large for the math library (at most ${MATH_DIGITS})`);
  if (scale + magnitude > MATH_DIGITS + 1000) throw new BcError(`number too large for the math library at this scale (${magnitude} digits before the point)`);
  const w = scale + 10 + magnitude;
  const fixed = rescale(x, w).v;
  let result: bigint;
  if (name === 'e') {
    if (compare(x, num(230000n)) > 0) throw new BcError(`number too long (over ${MAX_DIGITS} digits)`);
    // Squaring k times multiplies the error by 2^k: keep that many more digits.
    const extra = Math.ceil(Math.log2(Math.max(1, Math.abs(Number(rescale(x, 0).v)) * 2)) * 0.31) + 2;
    result = rescale({ v: expFixed(rescale(x, w + extra).v, w + extra), s: w + extra }, w).v;
  } else if (name === 'l') {
    result = lnFixed(fixed, w);
  } else if (name === 'a') {
    result = atanFixed(fixed, w);
  } else {
    result = sinCosFixed(fixed, w, name === 'c');
  }
  return guard(rescale({ v: result, s: w }, scale));
}

// ── The language ───────────────────────────────────────────────────────────────────────────

type Tok = { t: 'num'; v: string } | { t: 'name'; v: string } | { t: 'str'; v: string } | { t: 'op'; v: string } | { t: 'nl'; line: number } | { t: 'end' };

const KEYWORDS = new Set(['if', 'else', 'while', 'for', 'break', 'continue', 'print', 'quit', 'halt', 'define', 'auto', 'return', 'length', 'sqrt', 'scale', 'ibase', 'obase', 'last', 'read', 'limits']);

const OPS = ['++', '--', '+=', '-=', '*=', '/=', '%=', '^=', '==', '!=', '<=', '>=', '&&', '||', '+', '-', '*', '/', '%', '^', '=', '<', '>', '!', '(', ')', '{', '}', '[', ']', ',', ';'];

class SyntaxError_ extends Error {
  constructor(readonly line: number) {
    super('syntax error');
  }
}

function lex(text: string, firstLine: number): Tok[] {
  const toks: Tok[] = [];
  let line = firstLine;
  let i = 0;
  while (i < text.length) {
    const c = text.charAt(i);
    if (c === '\n') {
      toks.push({ t: 'nl', line });
      line += 1;
      i += 1;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r') {
      i += 1;
      continue;
    }
    if (c === '\\' && text.charAt(i + 1) === '\n') {
      line += 1;
      i += 2;
      continue;
    }
    if (c === '#') {
      while (i < text.length && text.charAt(i) !== '\n') i += 1;
      continue;
    }
    if (text.startsWith('/*', i)) {
      const end = text.indexOf('*/', i + 2);
      const stop = end === -1 ? text.length : end + 2;
      line += (text.slice(i, stop).match(/\n/g) ?? []).length;
      i = stop;
      continue;
    }
    if (c === '"') {
      const end = text.indexOf('"', i + 1);
      const stop = end === -1 ? text.length : end;
      const value = text.slice(i + 1, stop);
      line += (value.match(/\n/g) ?? []).length;
      toks.push({ t: 'str', v: value });
      i = stop + 1;
      continue;
    }
    const number = /^(?:[0-9A-F]+(?:\.[0-9A-F]*)?|\.[0-9A-F]+)/.exec(text.slice(i));
    if (number !== null) {
      toks.push({ t: 'num', v: number[0] });
      i += number[0].length;
      continue;
    }
    const name = /^[a-z][a-z0-9_]*/.exec(text.slice(i));
    if (name !== null) {
      toks.push({ t: 'name', v: name[0] });
      i += name[0].length;
      continue;
    }
    const op = OPS.find((candidate) => text.startsWith(candidate, i));
    if (op === undefined) throw new SyntaxError_(line);
    toks.push({ t: 'op', v: op });
    i += op.length;
  }
  toks.push({ t: 'nl', line });
  toks.push({ t: 'end' });
  return toks;
}

type Expr =
  | { k: 'num'; text: string }
  | { k: 'var'; name: string }
  | { k: 'neg'; e: Expr }
  | { k: 'not'; e: Expr }
  | { k: 'bin'; op: string; a: Expr; b: Expr }
  | { k: 'assign'; op: string; name: string; e: Expr }
  | { k: 'inc'; name: string; delta: 1 | -1; prefix: boolean }
  | { k: 'call'; name: string; args: Expr[] };

type Stmt =
  | { k: 'expr'; e: Expr }
  | { k: 'str'; text: string }
  | { k: 'print'; items: (Expr | string)[] }
  | { k: 'block'; body: Stmt[] }
  | { k: 'if'; cond: Expr; then: Stmt; else: Stmt | null }
  | { k: 'while'; cond: Expr; body: Stmt }
  | { k: 'for'; init: Expr | null; cond: Expr | null; step: Expr | null; body: Stmt }
  | { k: 'break' }
  | { k: 'continue' }
  | { k: 'quit' }
  | { k: 'empty' };

const ESCAPES: Readonly<Record<string, string>> = { n: '\n', t: '\t', a: '\x07', b: '\b', f: '\f', r: '\r', q: '"', '\\': '\\', e: '\\' };

class Parser {
  i = 0;
  constructor(private readonly toks: Tok[]) {}

  private peek(): Tok {
    return this.toks[this.i] ?? { t: 'end' };
  }

  private isOp(v: string): boolean {
    const tok = this.peek();
    return tok.t === 'op' && tok.v === v;
  }

  private isName(v: string): boolean {
    const tok = this.peek();
    return tok.t === 'name' && tok.v === v;
  }

  line(): number {
    for (let k = this.i; k < this.toks.length; k += 1) {
      const tok = this.toks[k];
      if (tok?.t === 'nl') return tok.line;
    }
    return 1;
  }

  private fail(): never {
    throw new SyntaxError_(this.line());
  }

  private expect(v: string): void {
    if (!this.isOp(v)) this.fail();
    this.i += 1;
  }

  private skipNewlines(): void {
    while (this.peek().t === 'nl') this.i += 1;
  }

  atEnd(): boolean {
    return this.peek().t === 'end';
  }

  /** One statement, and the separator after it. */
  statement(): Stmt {
    const stmt = this.bare();
    const tok = this.peek();
    if (tok.t === 'op' && tok.v === ';') this.i += 1;
    else if (tok.t === 'nl') this.i += 1;
    else if (!(tok.t === 'op' && tok.v === '}') && tok.t !== 'end') this.fail();
    return stmt;
  }

  /** Skips to the next new line, after a syntax error. */
  recover(): void {
    while (!this.atEnd() && this.peek().t !== 'nl') this.i += 1;
    if (this.peek().t === 'nl') this.i += 1;
  }

  private bare(): Stmt {
    const tok = this.peek();
    if (tok.t === 'nl' || (tok.t === 'op' && tok.v === ';')) return { k: 'empty' };
    if (tok.t === 'str') {
      this.i += 1;
      return { k: 'str', text: tok.v };
    }
    if (tok.t === 'op' && tok.v === '{') {
      this.i += 1;
      const body: Stmt[] = [];
      for (;;) {
        this.skipNewlines();
        if (this.isOp('}')) break;
        if (this.atEnd()) this.fail();
        body.push(this.statement());
      }
      this.i += 1;
      return { k: 'block', body };
    }
    if (tok.t === 'name') {
      switch (tok.v) {
        case 'quit':
        case 'halt':
          this.i += 1;
          return { k: 'quit' };
        case 'break':
        case 'continue':
          this.i += 1;
          return { k: tok.v };
        case 'print': {
          this.i += 1;
          const items: (Expr | string)[] = [];
          do {
            const item = this.peek();
            if (item.t === 'str') {
              this.i += 1;
              items.push(item.v.replace(/\\(.)/g, (_, ch: string) => ESCAPES[ch] ?? ch));
            } else items.push(this.expr());
          } while (this.isOp(',') && ++this.i);
          return { k: 'print', items };
        }
        case 'if': {
          this.i += 1;
          this.expect('(');
          const cond = this.expr();
          this.expect(')');
          this.skipNewlines();
          const then = this.bare();
          let otherwise: Stmt | null = null;
          const save = this.i;
          if (this.isOp(';')) this.i += 1;
          this.skipNewlines();
          if (this.isName('else')) {
            this.i += 1;
            this.skipNewlines();
            otherwise = this.bare();
          } else {
            this.i = save;
          }
          return { k: 'if', cond, then, else: otherwise };
        }
        case 'while': {
          this.i += 1;
          this.expect('(');
          const cond = this.expr();
          this.expect(')');
          this.skipNewlines();
          return { k: 'while', cond, body: this.bare() };
        }
        case 'for': {
          this.i += 1;
          this.expect('(');
          const init = this.isOp(';') ? null : this.expr();
          this.expect(';');
          const cond = this.isOp(';') ? null : this.expr();
          this.expect(';');
          const step = this.isOp(')') ? null : this.expr();
          this.expect(')');
          this.skipNewlines();
          return { k: 'for', init, cond, step, body: this.bare() };
        }
        case 'define':
        case 'auto':
        case 'return':
        case 'read':
        case 'limits':
          throw new BcError(`${tok.v} is not supported in vesen's bc`);
        default:
          break;
      }
    }
    return { k: 'expr', e: this.expr() };
  }

  expr(): Expr {
    return this.or();
  }

  private or(): Expr {
    let a = this.and();
    while (this.isOp('||')) {
      this.i += 1;
      a = { k: 'bin', op: '||', a, b: this.and() };
    }
    return a;
  }

  private and(): Expr {
    let a = this.not();
    while (this.isOp('&&')) {
      this.i += 1;
      a = { k: 'bin', op: '&&', a, b: this.not() };
    }
    return a;
  }

  private not(): Expr {
    if (this.isOp('!')) {
      this.i += 1;
      return { k: 'not', e: this.not() };
    }
    return this.relation();
  }

  private relation(): Expr {
    const a = this.assignment();
    const tok = this.peek();
    if (tok.t === 'op' && ['<', '<=', '>', '>=', '==', '!='].includes(tok.v)) {
      this.i += 1;
      return { k: 'bin', op: tok.v, a, b: this.assignment() };
    }
    return a;
  }

  private assignment(): Expr {
    const tok = this.peek();
    const next = this.toks[this.i + 1];
    if (tok.t === 'name' && next?.t === 'op' && ['=', '+=', '-=', '*=', '/=', '%=', '^='].includes(next.v)) {
      this.i += 2;
      return { k: 'assign', op: next.v, name: tok.v, e: this.assignment() };
    }
    return this.sum();
  }

  private sum(): Expr {
    let a = this.product();
    for (;;) {
      const tok = this.peek();
      if (tok.t !== 'op' || (tok.v !== '+' && tok.v !== '-')) return a;
      this.i += 1;
      a = { k: 'bin', op: tok.v, a, b: this.product() };
    }
  }

  private product(): Expr {
    let a = this.power();
    for (;;) {
      const tok = this.peek();
      if (tok.t !== 'op' || (tok.v !== '*' && tok.v !== '/' && tok.v !== '%')) return a;
      this.i += 1;
      a = { k: 'bin', op: tok.v, a, b: this.power() };
    }
  }

  private power(): Expr {
    const a = this.unary();
    if (this.isOp('^')) {
      this.i += 1;
      return { k: 'bin', op: '^', a, b: this.power() };
    }
    return a;
  }

  private unary(): Expr {
    if (this.isOp('-')) {
      this.i += 1;
      return { k: 'neg', e: this.unary() };
    }
    if (this.isOp('++') || this.isOp('--')) {
      const delta = this.isOp('++') ? 1 : -1;
      this.i += 1;
      const tok = this.peek();
      if (tok.t !== 'name') this.fail();
      this.i += 1;
      return { k: 'inc', name: tok.v, delta, prefix: true };
    }
    return this.postfix();
  }

  private postfix(): Expr {
    const tok = this.peek();
    if (tok.t === 'num') {
      this.i += 1;
      return { k: 'num', text: tok.v };
    }
    if (tok.t === 'op' && tok.v === '(') {
      this.i += 1;
      const e = this.expr();
      this.expect(')');
      return e;
    }
    if (tok.t === 'name') {
      if (['if', 'else', 'while', 'for', 'break', 'continue', 'print', 'quit', 'halt'].includes(tok.v)) this.fail();
      this.i += 1;
      if (this.isOp('(')) {
        this.i += 1;
        const args: Expr[] = [];
        if (!this.isOp(')')) {
          args.push(this.expr());
          while (this.isOp(',')) {
            this.i += 1;
            args.push(this.expr());
          }
        }
        this.expect(')');
        return { k: 'call', name: tok.v, args };
      }
      if (this.isOp('[')) throw new BcError("arrays are not supported in vesen's bc");
      if (this.isOp('++') || this.isOp('--')) {
        const delta = this.isOp('++') ? 1 : -1;
        this.i += 1;
        return { k: 'inc', name: tok.v, delta, prefix: false };
      }
      return { k: 'var', name: tok.v };
    }
    if (tok.t === 'op' && tok.v === '.') this.fail();
    return this.fail();
  }
}

class Flow extends Error {
  constructor(readonly kind: 'break' | 'continue' | 'quit') {
    super(kind);
  }
}

class Machine {
  readonly vars = new Map<string, Num>();
  scale: number;
  ibase = 10;
  obase = 10;
  last: Num = ZERO;
  out = '';
  /** What is waiting to be written, in order: stdout's text and stderr's warnings. */
  readonly pending: { text: string; err: boolean }[] = [];

  constructor(
    private readonly mathlib: boolean,
    private readonly breathe: () => Promise<void>,
  ) {
    this.scale = mathlib ? 20 : 0;
  }

  /** A warning, on standard error, after what was printed before it. */
  warn(message: string): void {
    if (this.out !== '') this.pending.push({ text: this.out, err: false });
    this.out = '';
    this.pending.push({ text: `${message}\n`, err: true });
  }

  get(name: string): Num {
    if (name === 'scale') return num(BigInt(this.scale));
    if (name === 'ibase') return num(BigInt(this.ibase));
    if (name === 'obase') return num(BigInt(this.obase));
    if (name === 'last') return this.last;
    return this.vars.get(name) ?? ZERO;
  }

  set(name: string, value: Num): void {
    const whole = Number(rescale(value, 0).v);
    if (name === 'scale') {
      if (whole < 0) throw new BcError('negative scale');
      this.scale = Math.min(whole, MAX_DIGITS);
    } else if (name === 'ibase' || name === 'obase') {
      if (whole < 2 || whole > 16) throw new BcError(`${name} must be from 2 to 16 in vesen's bc`);
      if (name === 'ibase') this.ibase = whole;
      else this.obase = whole;
    } else if (name === 'last') {
      this.last = value;
    } else if (KEYWORDS.has(name)) {
      throw new BcError(`cannot assign to ${name}`);
    } else {
      this.vars.set(name, value);
    }
  }

  eval(e: Expr): Num {
    switch (e.k) {
      case 'num':
        return readNumber(e.text, this.ibase);
      case 'var':
        return this.get(e.name);
      case 'neg':
        return neg(this.eval(e.e));
      case 'not':
        return num(this.eval(e.e).v === 0n ? 1n : 0n);
      case 'inc': {
        const before = this.get(e.name);
        const after = add(before, num(BigInt(e.delta)));
        this.set(e.name, after);
        return e.prefix ? after : before;
      }
      case 'assign': {
        const value = this.eval(e.e);
        const result = e.op === '=' ? value : this.binary(e.op.slice(0, -1), this.get(e.name), value);
        this.set(e.name, result);
        return result;
      }
      case 'bin': {
        if (e.op === '&&') return num(this.eval(e.a).v !== 0n && this.eval(e.b).v !== 0n ? 1n : 0n);
        if (e.op === '||') return num(this.eval(e.a).v !== 0n || this.eval(e.b).v !== 0n ? 1n : 0n);
        return this.binary(e.op, this.eval(e.a), this.eval(e.b));
      }
      case 'call':
        return this.call(e.name, e.args.map((arg) => this.eval(arg)));
      default:
        return ZERO;
    }
  }

  binary(op: string, a: Num, b: Num): Num {
    switch (op) {
      case '+':
        return guard(add(a, b));
      case '-':
        return guard(add(a, neg(b)));
      case '*':
        return mul(a, b, this.scale);
      case '/':
        return div(a, b, this.scale);
      case '%':
        return mod(a, b, this.scale);
      case '^':
        if (b.s > 0 && rescale(b, 0).v * p10(b.s) !== b.v) this.warn('Runtime warning: non-zero scale in exponent');
        return power(a, b, this.scale);
      default: {
        const c = compare(a, b);
        const holds = op === '<' ? c < 0 : op === '<=' ? c <= 0 : op === '>' ? c > 0 : op === '>=' ? c >= 0 : op === '==' ? c === 0 : c !== 0;
        return num(holds ? 1n : 0n);
      }
    }
  }

  call(name: string, args: Num[]): Num {
    const one = (): Num => {
      if (args.length !== 1) throw new BcError(`${name} takes one argument`);
      return args[0] as Num;
    };
    switch (name) {
      case 'sqrt':
        return sqrt(one(), this.scale);
      case 'length':
        return num(BigInt(length(one())));
      case 'scale':
        return num(BigInt(one().s));
      default:
        if (this.mathlib && ['s', 'c', 'a', 'l', 'e'].includes(name)) return library(name, one(), this.scale);
        throw new BcError(`Function ${name} not defined.`);
    }
  }

  async exec(s: Stmt): Promise<void> {
    switch (s.k) {
      case 'expr': {
        const value = this.eval(s.e);
        // Every expression but an assignment prints its value.
        if (s.e.k !== 'assign') {
          this.last = value;
          this.out += `${wrap(format(value, this.obase))}\n`;
        }
        break;
      }
      case 'str':
        this.out += s.text.replace(/\\(.)/g, (_, ch: string) => ESCAPES[ch] ?? ch);
        break;
      case 'print':
        for (const item of s.items) this.out += typeof item === 'string' ? item : wrap(format(this.eval(item), this.obase));
        break;
      case 'block':
        for (const inner of s.body) await this.exec(inner);
        break;
      case 'if':
        if (this.eval(s.cond).v !== 0n) await this.exec(s.then);
        else if (s.else !== null) await this.exec(s.else);
        break;
      case 'while':
        while (this.eval(s.cond).v !== 0n) {
          await this.breathe();
          try {
            await this.exec(s.body);
          } catch (error) {
            if (error instanceof Flow && error.kind === 'break') break;
            if (error instanceof Flow && error.kind === 'continue') continue;
            throw error;
          }
        }
        break;
      case 'for':
        if (s.init !== null) this.eval(s.init);
        for (; s.cond === null || this.eval(s.cond).v !== 0n; ) {
          await this.breathe();
          try {
            await this.exec(s.body);
          } catch (error) {
            if (error instanceof Flow && error.kind === 'break') break;
            if (!(error instanceof Flow && error.kind === 'continue')) throw error;
          }
          if (s.step !== null) this.eval(s.step);
        }
        break;
      case 'break':
      case 'continue':
      case 'quit':
        throw new Flow(s.k);
      default:
        break;
    }
  }
}

/** Runs a program's text; false once quit was reached. */
async function runText(ctx: CommandContext, machine: Machine, text: string, source: string, failed: { value: boolean }): Promise<boolean> {
  let toks: Tok[];
  try {
    toks = lex(text, 1);
  } catch (error) {
    if (!(error instanceof SyntaxError_)) throw error;
    failed.value = true;
    await ctx.stderr.write(`${source} ${error.line}: syntax error\n`);
    return true;
  }
  const parser = new Parser(toks);
  while (!parser.atEnd()) {
    let stmt: Stmt;
    try {
      stmt = parser.statement();
    } catch (error) {
      if (error instanceof SyntaxError_) {
        failed.value = true;
        await ctx.stderr.write(`${source} ${error.line}: syntax error\n`);
        parser.recover();
        continue;
      }
      if (error instanceof BcError) {
        failed.value = true;
        await ctx.stderr.write(`${source} ${parser.line()}: ${error.message}\n`);
        parser.recover();
        continue;
      }
      throw error;
    }
    try {
      await machine.exec(stmt);
    } catch (error) {
      if (error instanceof Flow) {
        if (error.kind === 'quit') {
          await flush(ctx, machine);
          return false;
        }
      } else if (error instanceof BcError) {
        failed.value = true;
        await flush(ctx, machine);
        await ctx.stderr.write(`Runtime error: ${error.message}\n`);
      } else {
        throw error;
      }
    }
    await flush(ctx, machine);
  }
  return true;
}

async function flush(ctx: CommandContext, machine: Machine): Promise<void> {
  if (machine.out !== '') machine.pending.push({ text: machine.out, err: false });
  machine.out = '';
  for (const { text, err } of machine.pending.splice(0)) await (err ? ctx.stderr : ctx.stdout).write(text);
}

export async function run(ctx: CommandContext): Promise<ExitCode> {
  const machine = new Machine(optOn(ctx, 'mathlib'), pacer(ctx));
  const failed = { value: false };
  for (const expression of optList(ctx, 'expression')) {
    if (!(await runText(ctx, machine, expression, '(standard_in)', failed))) return failed.value ? 1 : 0;
  }
  for (const file of ctx.args) {
    let text: string;
    try {
      text = ctx.fs.readFile(ctx.resolve(file));
    } catch (error) {
      await ctx.fail(`File ${file} is unavailable: ${reason(error)}`);
      return 1;
    }
    if (!(await runText(ctx, machine, text, file, failed))) return failed.value ? 1 : 0;
  }
  if (optList(ctx, 'expression').length > 0 && ctx.args.length === 0 && ctx.stdin.isTTY) return failed.value ? 1 : 0;
  if (ctx.stdin.isTTY && ctx.tty.interactive) {
    // At the prompt: a line at a time until Ctrl+D or quit.
    for (;;) {
      const line = await ctx.tty.readLine({ prompt: '' });
      if (line === null) break;
      if (!(await runText(ctx, machine, line, '(standard_in)', failed))) break;
    }
    return failed.value ? 1 : 0;
  }
  const text = await ctx.stdin.text();
  await runText(ctx, machine, text, '(standard_in)', failed);
  return failed.value ? 1 : 0;
}
