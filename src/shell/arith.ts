// Shell arithmetic for $(( … )): a small in-house parser and evaluator, never eval.
//
// It follows bash: signed 64-bit integers that wrap on overflow (BigInt underneath), C operator
// precedence, short-circuit && || and ?:, and variables that hold either numbers or further
// expressions (`x=1+2; echo $((x*2))` prints 6). Unset or empty variables are 0.
//
// Operators, loosest first:
//   ,   = *= /= %= += -= <<= >>= &= ^= |=   ?:   ||   &&   |   ^   &   == !=   < <= > >=
//   << >>   + -   * / %   **   unary + - ! ~ and prefix ++ --   postfix ++ --
// Numbers: decimal, 0x hex, leading-zero octal, and BASE#DIGITS for bases 2 to 64.
//
// Errors use bash's wording: `1/0: division by 0 (error token is "0")`.

export interface ArithVars {
  get(name: string): string | undefined;
  set(name: string, value: string): void;
}

export class ArithError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArithError';
  }
}

/** How deeply a variable's value may refer to further expressions. */
const MAX_RECURSION = 64;

/**
 * How many variable reads one evaluation may make. Values like `a='b+b' b='c+c' …` double the
 * work at each level; bash would grind on, but a browser tab must not freeze.
 */
export const MAX_ARITH_READS = 10_000;

type Tok =
  | { readonly t: 'num'; readonly text: string; readonly at: number }
  | { readonly t: 'id'; readonly name: string; readonly at: number }
  | { readonly t: 'op'; readonly op: string; readonly at: number }
  | { readonly t: 'end'; readonly at: number };

type Node =
  | { readonly t: 'num'; readonly v: bigint }
  | { readonly t: 'var'; readonly name: string }
  | { readonly t: 'unary'; readonly op: string; readonly e: Node }
  | { readonly t: 'binary'; readonly op: string; readonly l: Node; readonly r: Node; readonly at: number }
  | { readonly t: 'logic'; readonly op: '&&' | '||'; readonly l: Node; readonly r: Node }
  | { readonly t: 'cond'; readonly c: Node; readonly a: Node; readonly b: Node }
  | { readonly t: 'assign'; readonly op: string; readonly name: string; readonly e: Node; readonly at: number }
  | { readonly t: 'step'; readonly name: string; readonly delta: bigint; readonly prefix: boolean }
  | { readonly t: 'comma'; readonly l: Node; readonly r: Node };

const OPERATORS = [
  '<<=', '>>=',
  '**', '<<', '>>', '<=', '>=', '==', '!=', '&&', '||', '++', '--',
  '+=', '-=', '*=', '/=', '%=', '&=', '^=', '|=',
  '+', '-', '*', '/', '%', '<', '>', '=', '!', '~', '&', '^', '|', '?', ':', '(', ')', ',',
];
const ASSIGN_OPS = new Set(['=', '*=', '/=', '%=', '+=', '-=', '<<=', '>>=', '&=', '^=', '|=']);

/** Binary operators by precedence level, loosest first; ** is right-associative. */
const LEVELS: readonly (readonly string[])[] = [
  ['|'],
  ['^'],
  ['&'],
  ['==', '!='],
  ['<', '<=', '>', '>='],
  ['<<', '>>'],
  ['+', '-'],
  ['*', '/', '%'],
  ['**'],
];

const wrap = (v: bigint): bigint => BigInt.asIntN(64, v);
const isSpace = (c: string): boolean => c === ' ' || c === '\t' || c === '\n' || c === '\r';
const isNameStart = (c: string): boolean => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_';
const isNameChar = (c: string): boolean => isNameStart(c) || (c >= '0' && c <= '9');

class Evaluator {
  private toks: Tok[] = [];
  private p = 0;

  constructor(
    private readonly src: string,
    private readonly vars: ArithVars,
    private readonly depth: number,
    private readonly budget: { reads: number },
  ) {}

  private fail(reason: string, at: number): never {
    const token = this.src.slice(Math.min(at, this.src.length)).trim();
    throw new ArithError(`${this.src.trim()}: ${reason} (error token is "${token}")`);
  }

  // ── Tokens ───────────────────────────────────────────────────────────────────────────────

  private tokenize(): void {
    const s = this.src;
    let i = 0;
    while (i < s.length) {
      const c = s.charAt(i);
      if (isSpace(c)) {
        i += 1;
      } else if (c >= '0' && c <= '9') {
        let j = i + 1;
        while (j < s.length && (isNameChar(s.charAt(j)) || s.charAt(j) === '#' || s.charAt(j) === '@')) j += 1;
        this.toks.push({ t: 'num', text: s.slice(i, j), at: i });
        i = j;
      } else if (isNameStart(c)) {
        let j = i + 1;
        while (j < s.length && isNameChar(s.charAt(j))) j += 1;
        this.toks.push({ t: 'id', name: s.slice(i, j), at: i });
        i = j;
      } else {
        const op = OPERATORS.find((o) => s.startsWith(o, i));
        if (op === undefined) this.fail('syntax error: invalid arithmetic operator', i);
        if (op === '++' || op === '--') {
          // ++ and -- step a variable; elsewhere they are two signs, so 1--1 is 2.
          const prev = this.toks[this.toks.length - 1];
          let j = i + 2;
          while (j < s.length && isSpace(s.charAt(j))) j += 1;
          if (prev?.t !== 'id' && !isNameStart(s.charAt(j))) {
            this.toks.push({ t: 'op', op: op.charAt(0), at: i }, { t: 'op', op: op.charAt(0), at: i + 1 });
            i += 2;
            continue;
          }
        }
        this.toks.push({ t: 'op', op, at: i });
        i += op.length;
      }
    }
    this.toks.push({ t: 'end', at: s.length });
  }

  private peek(): Tok {
    return this.toks[this.p] ?? { t: 'end', at: this.src.length };
  }

  private isOp(...ops: string[]): boolean {
    const t = this.peek();
    return t.t === 'op' && ops.includes(t.op);
  }

  private expectOperand(): never {
    const t = this.peek();
    const at = t.t === 'end' ? Math.max(0, (this.toks[this.p - 1]?.at ?? 0)) : t.at;
    this.fail('syntax error: operand expected', at);
  }

  // ── Grammar ──────────────────────────────────────────────────────────────────────────────

  parse(): Node | null {
    this.tokenize();
    if (this.peek().t === 'end') return null;
    const node = this.comma();
    const t = this.peek();
    if (t.t !== 'end') this.fail('syntax error in expression', t.at);
    return node;
  }

  private comma(): Node {
    let node = this.assign();
    while (this.isOp(',')) {
      this.p += 1;
      node = { t: 'comma', l: node, r: this.assign() };
    }
    return node;
  }

  private assign(): Node {
    const t = this.peek();
    const next = this.toks[this.p + 1];
    if (t.t === 'id' && next?.t === 'op' && ASSIGN_OPS.has(next.op)) {
      this.p += 2;
      return { t: 'assign', op: next.op, name: t.name, e: this.assign(), at: next.at };
    }
    const node = this.cond();
    const after = this.peek();
    if (after.t === 'op' && ASSIGN_OPS.has(after.op)) this.fail('attempted assignment to non-variable', after.at);
    return node;
  }

  private cond(): Node {
    const c = this.logic('||');
    if (!this.isOp('?')) return c;
    this.p += 1;
    const a = this.assign();
    if (!this.isOp(':')) this.fail("syntax error: ':' expected for conditional expression", this.peek().at);
    this.p += 1;
    const b = this.assign();
    return { t: 'cond', c, a, b };
  }

  private logic(op: '&&' | '||'): Node {
    const tighter = (): Node => (op === '||' ? this.logic('&&') : this.binary(0));
    let node = tighter();
    while (this.isOp(op)) {
      this.p += 1;
      node = { t: 'logic', op, l: node, r: tighter() };
    }
    return node;
  }

  private binary(level: number): Node {
    const ops = LEVELS[level];
    if (ops === undefined) return this.unary();
    const left = this.binary(level + 1);
    if (ops[0] === '**') {
      const t = this.peek();
      if (t.t !== 'op' || t.op !== '**') return left;
      this.p += 1;
      return { t: 'binary', op: '**', l: left, r: this.binary(level), at: t.at };
    }
    let node = left;
    for (let t = this.peek(); t.t === 'op' && ops.includes(t.op); t = this.peek()) {
      this.p += 1;
      node = { t: 'binary', op: t.op, l: node, r: this.binary(level + 1), at: t.at };
    }
    return node;
  }

  private unary(): Node {
    const t = this.peek();
    if (t.t === 'op' && (t.op === '++' || t.op === '--')) {
      this.p += 1;
      const target = this.peek();
      if (target.t !== 'id') this.expectOperand();
      this.p += 1;
      return { t: 'step', name: target.name, delta: t.op === '++' ? 1n : -1n, prefix: true };
    }
    if (t.t === 'op' && (t.op === '+' || t.op === '-' || t.op === '!' || t.op === '~')) {
      this.p += 1;
      return { t: 'unary', op: t.op, e: this.unary() };
    }
    return this.postfix();
  }

  private postfix(): Node {
    const t = this.peek();
    if (t.t === 'num') {
      this.p += 1;
      return { t: 'num', v: this.number(t.text, t.at) };
    }
    if (t.t === 'id') {
      this.p += 1;
      const after = this.peek();
      if (after.t === 'op' && (after.op === '++' || after.op === '--')) {
        this.p += 1;
        return { t: 'step', name: t.name, delta: after.op === '++' ? 1n : -1n, prefix: false };
      }
      return { t: 'var', name: t.name };
    }
    if (t.t === 'op' && t.op === '(') {
      this.p += 1;
      const inner = this.comma();
      if (!this.isOp(')')) this.fail("missing ')'", this.peek().at);
      this.p += 1;
      return inner;
    }
    return this.expectOperand();
  }

  private number(text: string, at: number): bigint {
    let base = 10;
    let digits = text;
    const hash = text.indexOf('#');
    if (hash !== -1) {
      base = Number(text.slice(0, hash));
      digits = text.slice(hash + 1);
      if (!/^[0-9]+$/.test(text.slice(0, hash)) || base < 2 || base > 64) this.fail('invalid arithmetic base', at);
    } else if (/^0[xX]/.test(text)) {
      base = 16;
      digits = text.slice(2);
    } else if (text.length > 1 && text.charAt(0) === '0') {
      base = 8;
      digits = text.slice(1);
    }
    if (digits === '') this.fail('invalid number', at);
    let v = 0n;
    for (const c of digits) {
      const d = digitValue(c, base);
      if (d === null || d >= base) this.fail('value too great for base', at);
      v = wrap(v * BigInt(base) + BigInt(d));
    }
    return v;
  }

  // ── Evaluation ───────────────────────────────────────────────────────────────────────────

  private read(name: string): bigint {
    this.budget.reads += 1;
    if (this.budget.reads > MAX_ARITH_READS) throw new ArithError(`${this.src.trim()}: expression too complex (error token is "${name}")`);
    const value = this.vars.get(name);
    if (value === undefined || value.trim() === '') return 0n;
    const trimmed = value.trim();
    if (/^-?[0-9]+$/.test(trimmed) && !/^-?0[0-9]/.test(trimmed)) return wrap(BigInt(trimmed));
    if (this.depth >= MAX_RECURSION) throw new ArithError(`${name}: expression recursion level exceeded (error token is "${name}")`);
    return evaluate(trimmed, this.vars, this.depth + 1, this.budget);
  }

  private write(name: string, v: bigint): bigint {
    this.vars.set(name, v.toString());
    return v;
  }

  eval(node: Node): bigint {
    switch (node.t) {
      case 'num':
        return node.v;
      case 'var':
        return this.read(node.name);
      case 'unary': {
        const v = this.eval(node.e);
        if (node.op === '-') return wrap(-v);
        if (node.op === '!') return v === 0n ? 1n : 0n;
        if (node.op === '~') return wrap(~v);
        return v;
      }
      case 'logic': {
        const l = this.eval(node.l) !== 0n;
        if (node.op === '&&') return l && this.eval(node.r) !== 0n ? 1n : 0n;
        return l || this.eval(node.r) !== 0n ? 1n : 0n;
      }
      case 'cond':
        return this.eval(node.c) !== 0n ? this.eval(node.a) : this.eval(node.b);
      case 'comma':
        this.eval(node.l);
        return this.eval(node.r);
      case 'step': {
        const old = this.read(node.name);
        const next = this.write(node.name, wrap(old + node.delta));
        return node.prefix ? next : old;
      }
      case 'assign': {
        const value = this.eval(node.e);
        if (node.op === '=') return this.write(node.name, value);
        const op = node.op.slice(0, -1);
        return this.write(node.name, this.apply(op, this.read(node.name), value, node.at));
      }
      case 'binary':
        return this.apply(node.op, this.eval(node.l), this.eval(node.r), node.at);
    }
  }

  private apply(op: string, l: bigint, r: bigint, at: number): bigint {
    switch (op) {
      case '+':
        return wrap(l + r);
      case '-':
        return wrap(l - r);
      case '*':
        return wrap(l * r);
      case '/':
      case '%':
        if (r === 0n) this.fail('division by 0', this.operandAfter(at));
        return wrap(op === '/' ? l / r : l % r);
      case '**':
        if (r < 0n) this.fail('exponent less than 0', this.operandAfter(at));
        return power(l, r);
      case '<<':
        return wrap(l << BigInt.asUintN(6, r));
      case '>>':
        return wrap(l >> BigInt.asUintN(6, r));
      case '<':
        return l < r ? 1n : 0n;
      case '<=':
        return l <= r ? 1n : 0n;
      case '>':
        return l > r ? 1n : 0n;
      case '>=':
        return l >= r ? 1n : 0n;
      case '==':
        return l === r ? 1n : 0n;
      case '!=':
        return l !== r ? 1n : 0n;
      case '&':
        return wrap(l & r);
      case '^':
        return wrap(l ^ r);
      case '|':
        return wrap(l | r);
      default:
        return this.fail('syntax error: invalid arithmetic operator', at);
    }
  }

  /** Where the right operand of the operator at `at` starts, for bash's error token. */
  private operandAfter(at: number): number {
    let i = at;
    while (i < this.src.length && !isSpace(this.src.charAt(i)) && !isNameChar(this.src.charAt(i)) && this.src.charAt(i) !== '(') i += 1;
    return i;
  }
}

/** The value of a digit in BASE#DIGITS, following bash: above base 36, a-z then A-Z, @ and _. */
function digitValue(c: string, base: number): number | null {
  if (c >= '0' && c <= '9') return c.charCodeAt(0) - 48;
  const lower = c >= 'a' && c <= 'z';
  const upper = c >= 'A' && c <= 'Z';
  if (base <= 36) {
    if (lower) return c.charCodeAt(0) - 97 + 10;
    if (upper) return c.charCodeAt(0) - 65 + 10;
    return null;
  }
  if (lower) return c.charCodeAt(0) - 97 + 10;
  if (upper) return c.charCodeAt(0) - 65 + 36;
  if (c === '@') return 62;
  if (c === '_') return 63;
  return null;
}

/** base ** exponent in 64-bit wrapping arithmetic, by repeated squaring. */
function power(base: bigint, exponent: bigint): bigint {
  let result = 1n;
  let b = wrap(base);
  let e = exponent;
  while (e > 0n) {
    if ((e & 1n) === 1n) result = wrap(result * b);
    b = wrap(b * b);
    e >>= 1n;
  }
  return result;
}

function evaluate(expr: string, vars: ArithVars, depth: number, budget: { reads: number }): bigint {
  const evaluator = new Evaluator(expr, vars, depth, budget);
  const node = evaluator.parse();
  return node === null ? 0n : evaluator.eval(node);
}

/**
 * Evaluates an arithmetic expression whose $ expansions have already been done. An empty
 * expression is 0. Throws ArithError, worded as bash words it, for anything it cannot evaluate.
 */
export function evaluateArith(expr: string, vars: ArithVars): bigint {
  return evaluate(expr, vars, 0, { reads: 0 });
}
