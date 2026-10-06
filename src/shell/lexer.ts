// The one shell lexer (docs/plan/02-architecture-and-contracts.md, section 3), implementing the
// contract in ./lexer-types.ts. It is total: whatever the input, it returns tokens and never
// throws. An unfinished line (an open quote, a trailing backslash, or a `$(`, `${`, `$((` or
// backtick still open) comes back with `complete: false`, which the parser turns into a `> `
// continuation prompt. Completion lexes the line up to the cursor with `lexPartial`, so the
// editor, completion and execution always agree on where words start and end.
//
// What it recognises:
// - blanks (space, tab, carriage return) separate words; an unquoted newline separates commands
//   and comes back as a `;` operator token whose source character is '\n';
// - the operators | || && ; & and the redirections < > >> 2> 2>> &> 2>&1 >&2 <<<, where the 2 of
//   2> counts only at the start of a token, as in bash (`a2>f` is the word a2 and `>`);
// - single quotes, double quotes, $'…' (ANSI-C escapes), $"…" (a plain double-quoted string),
//   backslash escapes, and backslash-newline line continuation;
// - $NAME, ${NAME}, ${NAME:-word} ${NAME-word} ${NAME:=word} ${NAME:+word}, ${#NAME}, the specials
//   $? $# $$ $! $@ $* $- and $0 to $9; any other ${…} form keeps its whole inner text as the name,
//   which expansion reports as unsupported or a bad substitution;
// - $( … ) and backticks as command substitutions (their source is kept as text; the parser parses
//   it), and $(( … )) as arithmetic;
// - a leading unquoted ~ or ~user, also right after the `=` of NAME=value and after a `:` in it;
// - a # at the start of a token begins a comment that runs to the end of the line.
//
// Parentheses and braces are ordinary word characters: vesen has no subshells or groups, so
// `echo :)` prints a smiley instead of a syntax error.

import type {
  ControlOp,
  LexResult,
  OpToken,
  ParamOp,
  Quote,
  QuoteLevel,
  RedirOp,
  RedirToken,
  Token,
  WordPart,
  WordToken,
} from './lexer-types';

/**
 * The deepest nesting of $( ), ${ }, $(( )) and backticks the lexer follows. Anything deeper
 * stays literal text, so hostile input cannot exhaust the stack.
 */
export const MAX_NESTING = 32;

/** A construct still open where the input ran out. */
type Open =
  | { readonly kind: 'quote'; readonly quote: Quote }
  | { readonly kind: 'escape' }
  /** `command` is true for $( and backticks, whose source is a nested command line. */
  | { readonly kind: 'subst'; readonly sourceStart: number; readonly command: boolean };

const BLANKS = new Set([' ', '\t', '\r']);
/** Characters that end an unquoted word: blanks, newline and the operator characters. */
const WORD_BREAKS = new Set([' ', '\t', '\r', '\n', '|', '&', ';', '<', '>']);
/** Single-character special parameters: $? $# $$ $! $@ $* $- and $0. */
const SPECIAL_PARAMS = new Set(['?', '#', '$', '!', '@', '*', '-', '0']);
/** `NAME=` at the start of a word. */
const ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)=/;
/** Characters allowed in the user of `~user`. */
const TILDE_USER = /[A-Za-z0-9_.+-]/;

const isDigit = (c: string): boolean => c >= '0' && c <= '9';
const isNameStart = (c: string): boolean => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_';
const isNameChar = (c: string): boolean => isNameStart(c) || isDigit(c);

/** Collects the parts of one word, merging adjacent literal text that shares a quote level. */
class Parts {
  readonly parts: WordPart[] = [];
  /** Quotes removed and escapes applied; expansions as typed. */
  value = '';
  quoted = false;
  /** How many parts or literal characters have been added, to spot an empty "". */
  count = 0;
  /** The last thing added, when it was one unquoted character; for `~` after `:` in PATH=… */
  lastPlain = '';
  private text = '';
  private q: QuoteLevel = 0;
  private pending = false;

  lit(text: string, q: QuoteLevel): void {
    if (this.pending && this.q !== q) this.flush();
    this.text += text;
    this.q = q;
    this.pending = true;
    this.value += text;
    if (q !== 0) this.quoted = true;
    if (text !== '') this.count += 1;
    this.lastPlain = q === 0 ? text : '';
  }

  push(part: WordPart, raw: string): void {
    this.flush();
    this.parts.push(part);
    this.value += raw;
    this.count += 1;
    this.lastPlain = '';
  }

  flush(): void {
    if (!this.pending) return;
    this.parts.push({ kind: 'lit', text: this.text, q: this.q });
    this.text = '';
    this.pending = false;
  }
}

function controlOp(value: ControlOp, start: number, end: number): OpToken {
  return { kind: 'op', raw: value, value, start, end };
}

function redirOp(value: RedirOp, start: number): RedirToken {
  return { kind: 'redir', raw: value, value, start, end: start + value.length };
}

/** True for redirections that take a target word; 2>&1 and >&2 do not. */
export function takesTarget(op: RedirOp): boolean {
  return op !== '2>&1' && op !== '>&2';
}

/** True for an operator token that came from a newline rather than a typed `;`. */
export function isNewlineToken(line: string, token: Token): boolean {
  return token.kind === 'op' && line.charCodeAt(token.start) === 10;
}

class Scanner {
  i: number;
  /** Constructs open at the current position, outermost first. */
  private readonly stack: Open[] = [];
  /** A copy of the stack when the input first ran out inside a construct; null if it never did. */
  eof: readonly Open[] | null = null;
  private depth = 0;

  constructor(
    private readonly src: string,
    from: number,
    readonly end: number,
  ) {
    this.i = from;
  }

  /** The character `k` places ahead, or '' past the end of the region. */
  private at(k = 0): string {
    const j = this.i + k;
    return j < this.end ? this.src.charAt(j) : '';
  }

  /** Records that the input ran out inside `open` (and everything enclosing it). */
  private ranOut(open?: Open): void {
    if (this.eof !== null) return;
    this.eof = open === undefined ? this.stack.slice() : [...this.stack, open];
  }

  // ── Tokens ───────────────────────────────────────────────────────────────────────────────

  tokens(): { tokens: Token[]; commentAt: number | null } {
    const tokens: Token[] = [];
    let commentAt: number | null = null;
    while (this.i < this.end) {
      const c = this.at();
      if (BLANKS.has(c)) {
        this.i += 1;
      } else if (c === '\\' && this.at(1) === '\n') {
        this.i += 2;
      } else if (c === '\n') {
        tokens.push(controlOp(';', this.i, this.i + 1));
        this.i += 1;
      } else if (c === '#') {
        if (commentAt === null) commentAt = this.i;
        while (this.i < this.end && this.at() !== '\n') this.i += 1;
      } else {
        tokens.push(this.operator() ?? this.word());
      }
    }
    return { tokens, commentAt };
  }

  private operator(): OpToken | RedirToken | null {
    const s = this.i;
    const c = this.at();
    const n = this.at(1);
    let token: OpToken | RedirToken | null = null;
    if (c === '2' && n === '>') {
      if (this.at(2) === '&' && this.at(3) === '1') token = redirOp('2>&1', s);
      else if (this.at(2) === '>') token = redirOp('2>>', s);
      else token = redirOp('2>', s);
    } else if (c === '<') {
      token = n === '<' && this.at(2) === '<' ? redirOp('<<<', s) : redirOp('<', s);
    } else if (c === '>') {
      if (n === '&' && this.at(2) === '2') token = redirOp('>&2', s);
      else token = n === '>' ? redirOp('>>', s) : redirOp('>', s);
    } else if (c === '&') {
      if (n === '&') token = controlOp('&&', s, s + 2);
      else if (n === '>') token = redirOp('&>', s);
      else token = controlOp('&', s, s + 1);
    } else if (c === '|') {
      token = n === '|' ? controlOp('||', s, s + 2) : controlOp('|', s, s + 1);
    } else if (c === ';') {
      token = controlOp(';', s, s + 1);
    }
    if (token !== null) this.i = token.end;
    return token;
  }

  private word(): WordToken {
    const start = this.i;
    const buf = new Parts();
    const ranOutBefore = this.eof !== null;
    while (this.i < this.end && !WORD_BREAKS.has(this.at())) this.unquoted(buf, start);
    buf.flush();
    const open = !ranOutBefore && this.eof !== null ? this.eof : null;
    const top = open === null ? undefined : open[open.length - 1];
    const raw = this.src.slice(start, this.i);
    const assignment = ASSIGNMENT.exec(raw);
    const token: WordToken = {
      kind: 'word',
      start,
      end: this.i,
      raw,
      value: buf.value,
      parts: buf.parts,
      quoted: buf.quoted,
      openQuote: top?.kind === 'quote' ? top.quote : null,
      danglingEscape: top?.kind === 'escape',
    };
    if (assignment === null) return token;
    const name = assignment[1] ?? '';
    return { ...token, assign: { name, valueStart: start + name.length + 1 } };
  }

  // ── Word parts ───────────────────────────────────────────────────────────────────────────

  /**
   * Reads one unit of unquoted text: a character, an escape, a quoted string or an expansion.
   * `wordStart` is where the word (or ${…} argument) began, for tilde rules; null turns tilde off.
   */
  unquoted(buf: Parts, wordStart: number | null): void {
    const c = this.at();
    if (c === '\\') return this.escape(buf);
    if (c === "'") return this.single(buf);
    if (c === '"') return this.double(buf);
    if (c === '`') return this.backtick(buf, 0);
    if (c === '$' && this.dollar(buf, 0)) return;
    if (c === '~' && wordStart !== null && this.tilde(buf, wordStart)) return;
    buf.lit(c, 0);
    this.i += 1;
  }

  /** Reads one unit inside double quotes; `brace` also lets `\}` escape a brace in "${X:-…}". */
  doubleQuoted(buf: Parts, brace: boolean): void {
    const c = this.at();
    if (c === '\\') {
      const n = this.at(1);
      if (n === '\n') {
        this.i += 2;
      } else if (n === '$' || n === '`' || n === '"' || n === '\\' || (brace && n === '}')) {
        buf.lit(n, 2);
        this.i += 2;
      } else {
        buf.lit('\\', 2);
        this.i += 1;
      }
      return;
    }
    if (c === '$' && this.dollar(buf, 2)) return;
    if (c === '`') return this.backtick(buf, 2);
    buf.lit(c, 2);
    this.i += 1;
  }

  /** The whole character at `j`, keeping a surrogate pair together. */
  private codePointAt(j: number): string {
    const code = this.src.codePointAt(j);
    if (code === undefined || j >= this.end) return '';
    const text = String.fromCodePoint(code);
    return j + text.length <= this.end ? text : this.src.charAt(j);
  }

  private escape(buf: Parts): void {
    const n = this.at(1);
    if (n === '') {
      this.ranOut({ kind: 'escape' });
      this.i += 1;
      return;
    }
    if (n === '\n') {
      this.i += 2;
      return;
    }
    const text = this.codePointAt(this.i + 1);
    buf.lit(text, 1);
    this.i += 1 + text.length;
  }

  private single(buf: Parts): void {
    this.i += 1;
    buf.quoted = true;
    const close = this.src.indexOf("'", this.i);
    if (close === -1 || close >= this.end) {
      buf.lit(this.src.slice(this.i, this.end), 1);
      this.i = this.end;
      this.ranOut({ kind: 'quote', quote: "'" });
      return;
    }
    buf.lit(this.src.slice(this.i, close), 1);
    this.i = close + 1;
  }

  private double(buf: Parts): void {
    this.i += 1;
    buf.quoted = true;
    const before = buf.count;
    const open: Open = { kind: 'quote', quote: '"' };
    this.stack.push(open);
    let closed = false;
    while (this.i < this.end) {
      if (this.at() === '"') {
        this.i += 1;
        closed = true;
        break;
      }
      this.doubleQuoted(buf, false);
    }
    if (!closed) this.ranOut();
    this.stack.pop();
    if (buf.count === before) buf.lit('', 2);
  }

  /** $'…': ANSI-C quoting, as in bash. */
  private ansiC(buf: Parts): void {
    this.i += 2;
    buf.quoted = true;
    let text = '';
    while (this.i < this.end) {
      const c = this.at();
      if (c === "'") {
        this.i += 1;
        buf.lit(text, 1);
        return;
      }
      if (c === '\\' && this.i + 1 < this.end) {
        text += this.ansiEscape();
      } else {
        text += c;
        this.i += 1;
      }
    }
    buf.lit(text, 1);
    this.ranOut({ kind: 'quote', quote: "'" });
  }

  /** Reads one backslash escape inside $'…', starting at the backslash. */
  private ansiEscape(): string {
    const n = this.at(1);
    const simple: Record<string, string> = {
      a: '\x07', b: '\b', e: '\x1b', E: '\x1b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v',
      '\\': '\\', "'": "'", '"': '"', '?': '?',
    };
    const mapped = simple[n];
    if (mapped !== undefined) {
      this.i += 2;
      return mapped;
    }
    const digits = (from: number, max: number, test: (c: string) => boolean): string => {
      let k = 0;
      while (k < max && test(this.at(from + k))) k += 1;
      return this.src.slice(this.i + from, this.i + from + k);
    };
    const isHex = (c: string): boolean => /^[0-9A-Fa-f]$/.test(c);
    if (n >= '0' && n <= '7') {
      const oct = digits(1, 3, (c) => c >= '0' && c <= '7');
      this.i += 1 + oct.length;
      return String.fromCharCode(parseInt(oct, 8) & 0xff);
    }
    if (n === 'x' || n === 'u' || n === 'U') {
      const hex = digits(2, n === 'x' ? 2 : n === 'u' ? 4 : 8, isHex);
      const code = hex === '' ? NaN : parseInt(hex, 16);
      if (Number.isNaN(code) || code > 0x10ffff) {
        this.i += 1;
        return '\\';
      }
      this.i += 2 + hex.length;
      return String.fromCodePoint(code);
    }
    if (n === 'c' && this.at(2) !== '') {
      const ch = this.at(2);
      this.i += 3;
      return String.fromCharCode(ch.toUpperCase().charCodeAt(0) & 0x1f);
    }
    this.i += 1;
    return '\\';
  }

  /** Reads a `$` expansion at the cursor; false when the `$` is just a dollar sign. */
  private dollar(buf: Parts, q: 0 | 2): boolean {
    const n = this.at(1);
    if (n === '(') return this.at(2) === '(' ? this.arith(buf, q) : this.cmdsub(buf, q);
    if (n === '{') return this.braced(buf, q);
    if (q === 0 && n === "'") {
      this.ansiC(buf);
      return true;
    }
    if (q === 0 && n === '"') {
      this.i += 1;
      return true;
    }
    let name = '';
    if (SPECIAL_PARAMS.has(n) || isDigit(n)) {
      name = n;
    } else if (isNameStart(n)) {
      let j = this.i + 1;
      while (j < this.end && isNameChar(this.src.charAt(j))) j += 1;
      name = this.src.slice(this.i + 1, j);
    } else {
      return false;
    }
    const start = this.i;
    this.i += 1 + name.length;
    buf.push({ kind: 'param', name, braced: false, q }, this.src.slice(start, this.i));
    return true;
  }

  private cmdsub(buf: Parts, q: 0 | 2): boolean {
    if (this.depth >= MAX_NESTING) return false;
    const start = this.i;
    this.i += 2;
    const sourceStart = this.i;
    this.stack.push({ kind: 'subst', sourceStart, command: true });
    this.depth += 1;
    const closed = this.skipCommand();
    if (!closed) this.ranOut();
    this.depth -= 1;
    this.stack.pop();
    const source = this.src.slice(sourceStart, closed ? this.i - 1 : this.i);
    buf.push({ kind: 'cmdsub', source, q }, this.src.slice(start, this.i));
    return true;
  }

  /** Skips a nested command line up to its unmatched `)`, which it consumes; false at the end. */
  private skipCommand(): boolean {
    const scratch = new Parts();
    let parens = 0;
    let tokenStart = true;
    while (this.i < this.end) {
      const c = this.at();
      if (c === ')') {
        this.i += 1;
        if (parens === 0) return true;
        parens -= 1;
        tokenStart = true;
      } else if (c === '(') {
        this.i += 1;
        parens += 1;
        tokenStart = true;
      } else if (c === '#' && tokenStart) {
        while (this.i < this.end && this.at() !== '\n') this.i += 1;
      } else if (WORD_BREAKS.has(c)) {
        this.i += 1;
        tokenStart = true;
      } else {
        this.unquoted(scratch, null);
        tokenStart = false;
      }
    }
    return false;
  }

  private arith(buf: Parts, q: 0 | 2): boolean {
    if (this.depth >= MAX_NESTING) return false;
    const start = this.i;
    this.i += 3;
    const sourceStart = this.i;
    this.stack.push({ kind: 'subst', sourceStart, command: false });
    this.depth += 1;
    const scratch = new Parts();
    let parens = 0;
    let closed = false;
    let subshell = false;
    while (this.i < this.end) {
      const c = this.at();
      if (c === '(') {
        parens += 1;
        this.i += 1;
      } else if (c === ')') {
        if (parens > 0) {
          parens -= 1;
          this.i += 1;
        } else {
          closed = this.at(1) === ')';
          subshell = !closed;
          break;
        }
      } else if (c === '\\' || c === "'" || c === '"' || c === '`' || c === '$') {
        this.unquoted(scratch, null);
      } else {
        this.i += 1;
      }
    }
    this.stack.pop();
    if (subshell) {
      // `$((cd x); ls)` is a command substitution that starts with a subshell, as in bash. The
      // `)` here closes that subshell; the rest is scanned as a command, never rescanned, so
      // nested cases stay linear.
      this.stack.push({ kind: 'subst', sourceStart: start + 2, command: true });
      this.i += 1;
      const done = this.skipCommand();
      if (!done) this.ranOut();
      this.stack.pop();
      this.depth -= 1;
      buf.push({ kind: 'cmdsub', source: this.src.slice(start + 2, done ? this.i - 1 : this.i), q }, this.src.slice(start, this.i));
      return true;
    }
    if (!closed) this.ranOut({ kind: 'subst', sourceStart, command: false });
    this.depth -= 1;
    const expr = this.src.slice(sourceStart, this.i);
    if (closed) this.i += 2;
    buf.push({ kind: 'arith', expr, q }, this.src.slice(start, this.i));
    return true;
  }

  private braced(buf: Parts, q: 0 | 2): boolean {
    if (this.depth >= MAX_NESTING) return false;
    const start = this.i;
    this.i += 2;
    const nameStart = this.i;
    this.stack.push({ kind: 'subst', sourceStart: nameStart, command: false });
    this.depth += 1;
    let name = this.paramName();
    let op: ParamOp | undefined;
    let supported = name !== '';
    const c = this.at();
    const n = this.at(1);
    if (supported && c !== '}') {
      const lengthForm = name.length > 1 && name.charAt(0) === '#';
      if (!lengthForm && c === ':' && (n === '-' || n === '=' || n === '+')) {
        op = c === ':' && n === '-' ? ':-' : n === '=' ? ':=' : ':+';
        this.i += 2;
      } else if (!lengthForm && c === '-') {
        op = '-';
        this.i += 1;
      } else {
        supported = false;
      }
    }
    const argStart = this.i;
    const arg = new Parts();
    let closed = false;
    while (this.i < this.end) {
      const ch = this.at();
      if (ch === '}') {
        this.i += 1;
        closed = true;
        break;
      }
      if (q === 2) {
        if (ch === '"') this.double(arg);
        else this.doubleQuoted(arg, true);
      } else {
        this.unquoted(arg, argStart);
      }
    }
    arg.flush();
    if (!closed) this.ranOut();
    this.depth -= 1;
    this.stack.pop();
    if (!supported) name = this.src.slice(nameStart, closed ? this.i - 1 : this.i);
    const raw = this.src.slice(start, this.i);
    if (supported && op !== undefined) {
      buf.push({ kind: 'param', name, braced: true, op, arg: arg.parts, q }, raw);
    } else {
      buf.push({ kind: 'param', name, braced: true, q }, raw);
    }
    return true;
  }

  /** Reads the name in ${…}: an identifier, digits or a special, optionally after # (length). */
  private paramName(): string {
    const s = this.i;
    const after = this.at(1);
    if (this.at() === '#' && after !== '}' && (isNameStart(after) || isDigit(after) || SPECIAL_PARAMS.has(after))) {
      this.i += 1;
    }
    const c = this.at();
    if (isNameStart(c)) {
      while (this.i < this.end && isNameChar(this.at())) this.i += 1;
    } else if (isDigit(c)) {
      while (this.i < this.end && isDigit(this.at())) this.i += 1;
    } else if (SPECIAL_PARAMS.has(c)) {
      this.i += 1;
    } else {
      this.i = s;
      return '';
    }
    return this.src.slice(s, this.i);
  }

  private backtick(buf: Parts, q: 0 | 2): void {
    if (this.depth >= MAX_NESTING) {
      buf.lit('`', q);
      this.i += 1;
      return;
    }
    const start = this.i;
    this.i += 1;
    this.stack.push({ kind: 'subst', sourceStart: this.i, command: true });
    this.depth += 1;
    let source = '';
    let closed = false;
    while (this.i < this.end) {
      const c = this.at();
      if (c === '`') {
        this.i += 1;
        closed = true;
        break;
      }
      const n = this.at(1);
      if (c === '\\' && (n === '$' || n === '`' || n === '\\' || (q === 2 && n === '"'))) {
        source += n;
        this.i += 2;
      } else if (c === '\\' && n === '') {
        this.ranOut({ kind: 'escape' });
        this.i += 1;
      } else {
        source += c;
        this.i += 1;
      }
    }
    if (!closed) this.ranOut();
    this.depth -= 1;
    this.stack.pop();
    buf.push({ kind: 'cmdsub', source, q }, this.src.slice(start, this.i));
  }

  /**
   * Reads `~` or `~user` when a tilde prefix may start here: at the start of a word (or of a
   * ${X:-…} argument), or after the `=` of NAME=value or a `:` in its value. False when it may not,
   * or when the prefix holds characters a user name cannot.
   */
  private tilde(buf: Parts, wordStart: number): boolean {
    let assignment = false;
    if (this.i !== wordStart) {
      const match = ASSIGNMENT.exec(this.src.slice(wordStart, this.i));
      if (match === null) return false;
      if (this.i !== wordStart + match[0].length && buf.lastPlain !== ':') return false;
      assignment = true;
    }
    const top = this.stack[this.stack.length - 1];
    const inBrace = top?.kind === 'subst' && !top.command;
    let j = this.i + 1;
    while (j < this.end && TILDE_USER.test(this.src.charAt(j))) j += 1;
    const next = j < this.end ? this.src.charAt(j) : '';
    const ends = next === '' || next === '/' || WORD_BREAKS.has(next) || (assignment && next === ':') || (inBrace && next === '}');
    if (!ends) return false;
    const user = this.src.slice(this.i + 1, j);
    const raw = this.src.slice(this.i, j);
    this.i = j;
    buf.push(user === '' ? { kind: 'tilde' } : { kind: 'tilde', user }, raw);
    return true;
  }
}

interface Scanned {
  readonly result: LexResult;
  /** The constructs open at the end of the region, outermost first. */
  readonly open: readonly Open[];
}

function scan(line: string, from: number, to: number): Scanned {
  const scanner = new Scanner(line, from, to);
  const { tokens, commentAt } = scanner.tokens();
  const open = scanner.eof ?? [];
  const top = open[open.length - 1];
  return {
    open,
    result: {
      tokens,
      complete: open.length === 0,
      openQuote: top?.kind === 'quote' ? top.quote : null,
      danglingEscape: top?.kind === 'escape',
      commentAt,
    },
  };
}

/** Lexes a whole line. Never throws. */
export function lex(line: string): LexResult {
  return scan(line, 0, line.length).result;
}

/**
 * Lexes text as if it were inside double quotes with no closing quote: what `$(( … ))` holds
 * before it is evaluated. Expansions become parts; everything else is quote level 2 text.
 */
export function lexText(text: string): WordPart[] {
  const scanner = new Scanner(text, 0, text.length);
  const buf = new Parts();
  while (scanner.i < scanner.end) scanner.doubleQuoted(buf, false);
  buf.flush();
  return buf.parts;
}

/** Why a lexed line is unfinished, in the parser's terms; null when it is complete. */
export function incompleteReason(result: LexResult): 'quote' | 'backslash' | 'subst' | null {
  if (result.complete) return null;
  if (result.danglingEscape) return 'backslash';
  return result.openQuote === null ? 'subst' : 'quote';
}

// ── Partial mode, for completion ─────────────────────────────────────────────────────────────

/** The word the cursor is in, or an empty word at the cursor. */
export interface CursorWord {
  readonly start: number;
  /** Always the cursor: text after the cursor is not part of the word being completed. */
  readonly end: number;
  /** Unquoted text up to the cursor. */
  readonly value: string;
  readonly openQuote: Quote | null;
  /** The token for the word, or null for an empty word at the cursor. */
  readonly token: WordToken | null;
}

export interface PartialLex extends LexResult {
  /**
   * Where the lexed text starts: 0, or just inside the innermost `$(` or backtick still open at
   * the cursor, so `echo $(ca` completes `ca` as a command. Offsets stay relative to the line.
   */
  readonly regionStart: number;
  readonly cursor: number;
  readonly word: CursorWord;
  /** Index in `tokens` of the first token of the simple command the cursor is in. */
  readonly commandStart: number;
  /** That command's words before the cursor word, without redirection targets. */
  readonly words: readonly WordToken[];
  /** True when the cursor word is the target of a redirection, such as `cat < fi`. */
  readonly redirectTarget: boolean;
  /** True when the cursor is inside a comment. */
  readonly inComment: boolean;
}

/**
 * Partial mode: lexes `line` up to `cursor` and describes where the cursor is, for completion.
 * Never throws; a cursor outside the line is clamped.
 */
export function lexPartial(line: string, cursor: number): PartialLex {
  const end = Math.max(0, Math.min(Number.isFinite(cursor) ? Math.floor(cursor) : line.length, line.length));
  let regionStart = 0;
  let scanned = scan(line, 0, end);
  for (let k = scanned.open.length - 1; k >= 0; k -= 1) {
    const open = scanned.open[k];
    if (open?.kind === 'subst' && open.command) {
      regionStart = open.sourceStart;
      scanned = scan(line, regionStart, end);
      break;
    }
  }
  const { result } = scanned;
  const tokens = result.tokens;
  const inComment = result.commentAt !== null && line.lastIndexOf('\n', end - 1) < result.commentAt;
  const last = tokens[tokens.length - 1];
  const current = !inComment && last !== undefined && last.kind === 'word' && last.end === end ? last : null;
  const word: CursorWord =
    current === null
      ? { start: end, end, value: '', openQuote: null, token: null }
      : { start: current.start, end, value: current.value, openQuote: current.openQuote, token: current };
  const before = current === null ? tokens : tokens.slice(0, -1);
  let commandStart = 0;
  before.forEach((t, k) => {
    if (t.kind === 'op') commandStart = k + 1;
  });
  const words: WordToken[] = [];
  let pendingTarget = false;
  for (const t of before.slice(commandStart)) {
    if (t.kind === 'redir') {
      pendingTarget = takesTarget(t.value);
    } else if (t.kind === 'word') {
      if (pendingTarget) pendingTarget = false;
      else words.push(t);
    }
  }
  return { ...result, regionStart, cursor: end, word, commandStart, words, redirectTarget: pendingTarget, inComment };
}
