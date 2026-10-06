// The shell parser: recursive descent over the lexer's tokens.
//
//   list     := NL* [ andor ( (';' | '&' | NL) NL* [ andor ] )* ]
//   andor    := pipeline ( ('&&' | '||') NL* pipeline )*
//   pipeline := '!'* command ( ('|' | '|&') NL* command )*
//   command  := ( assignment | redirection )* ( word | redirection )*
//
// parse() never throws. It returns the tree, or `incomplete` with a reason when more input
// could finish the line (the editor then shows `> `), or an error in bash's wording. Compound
// commands, subshells `( … )` and process substitution `<( … )` are reported plainly as
// `<word>: not supported in vesen`, and so is a file descriptor other than 0, 1 and 2. `a |& b`
// is `a 2>&1 | b`. Command substitutions are parsed too, so `echo $(|)` is a syntax error
// before anything runs.

import type {
  AndOr,
  Assign,
  IncompleteReason,
  List,
  ListItem,
  ParseFailure,
  ParseResult,
  Pipeline,
  Pos,
  Redirect,
  SimpleCommand,
  Word,
} from './ast';
import type { LexResult, Token, WordPart, WordToken } from './lexer-types';
import { MAX_NESTING, incompleteReason, isNewlineToken, lex, takesTarget } from './lexer';

/** Compound-command words vesen does not run; each fails as `<word>: not supported in vesen`. */
const UNSUPPORTED = new Set(['if', 'for', 'while', 'until', 'case', 'select', 'function', 'coproc', '{', '[[']);
/** Words that only make sense inside a compound command; bash calls them unexpected tokens. */
const UNEXPECTED = new Set(['then', 'else', 'elif', 'fi', 'do', 'done', 'esac', '}', ']]']);
/** `name()` in command position: a function definition. */
const FUNCTION_DEFINITION = /^[A-Za-z_][A-Za-z0-9_.:-]*\(\)$/;

/** Thrown inside the parser to stop at the first problem; parse() turns it into a result. */
class Stop {
  constructor(
    readonly failure:
      | { readonly ok: false; readonly incomplete: true; readonly reason: IncompleteReason }
      | { readonly ok: false; readonly incomplete: false; readonly message: string; readonly at: Pos },
  ) {}
}

function syntaxError(src: string, token: Token | undefined, next?: Token, previous?: Token): Stop {
  let name = 'newline';
  if (token !== undefined && !isNewlineToken(src, token)) name = token.raw;
  let at: Pos = token === undefined ? { start: src.length, end: src.length } : { start: token.start, end: token.end };
  // `;;` is two tokens to the lexer but one to bash's error message.
  if (token?.raw === ';' && next?.raw === ';' && next.start === token.end) {
    name = ';;';
    at = { start: token.start, end: next.end };
  } else if (token?.raw === ';' && previous?.raw === ';' && previous.end === token.start) {
    name = ';;';
    at = { start: previous.start, end: token.end };
  }
  return new Stop({ ok: false, incomplete: false, message: `syntax error near unexpected token '${name}'`, at });
}

function notSupported(what: string, at: Pos): Stop {
  return new Stop({ ok: false, incomplete: false, message: `${what}: not supported in vesen`, at: { start: at.start, end: at.end } });
}

function incomplete(reason: IncompleteReason): Stop {
  return new Stop({ ok: false, incomplete: true, reason });
}

function toWord(token: WordToken): Word {
  return { start: token.start, end: token.end, raw: token.raw, parts: token.parts, quoted: token.quoted };
}

/** The value of `NAME=value`: the word's parts with the `NAME=` prefix removed. */
function assignment(src: string, token: WordToken): Assign {
  const name = token.assign?.name ?? '';
  const valueStart = token.assign?.valueStart ?? token.end;
  const prefix = `${name}=`;
  const parts: WordPart[] = [];
  token.parts.forEach((part, k) => {
    if (k === 0 && part.kind === 'lit' && part.q === 0 && part.text.startsWith(prefix)) {
      const rest = part.text.slice(prefix.length);
      if (rest !== '') parts.push({ ...part, text: rest });
    } else {
      parts.push(part);
    }
  });
  const value: Word = {
    start: valueStart,
    end: token.end,
    raw: src.slice(valueStart, token.end),
    parts,
    quoted: token.quoted,
  };
  return { start: token.start, end: token.end, name, value };
}

class Parser {
  private p = 0;

  constructor(
    private readonly src: string,
    private readonly toks: readonly Token[],
    private readonly depth: number,
    /** False while the lexer says the line is unfinished; nested sources are then not checked. */
    private readonly complete: boolean,
  ) {}

  private peek(k = 0): Token | undefined {
    return this.toks[this.p + k];
  }

  private isOp(token: Token | undefined, ...values: string[]): boolean {
    return token !== undefined && token.kind === 'op' && !isNewlineToken(this.src, token) && values.includes(token.value);
  }

  private isNewline(token: Token | undefined): boolean {
    return token !== undefined && isNewlineToken(this.src, token);
  }

  private skipNewlines(): void {
    while (this.isNewline(this.peek())) this.p += 1;
  }

  list(): List {
    const items: ListItem[] = [];
    this.skipNewlines();
    while (this.p < this.toks.length) {
      const node = this.andOr();
      const t = this.peek();
      if (t === undefined) {
        items.push({ node, background: false });
        break;
      }
      if (t.kind !== 'op') throw syntaxError(this.src, t, this.peek(1));
      // Only ; & and newline can follow an and-or list; && || | were consumed by it.
      this.p += 1;
      items.push({ node, background: t.value === '&' && !this.isNewline(t) });
      if (!this.isNewline(t)) {
        const next = this.peek();
        if (this.isOp(next, ';', '&', '&&', '||', '|', '|&')) throw syntaxError(this.src, next, this.peek(1), t);
      }
      this.skipNewlines();
    }
    const first = items[0];
    const last = items[items.length - 1];
    return {
      type: 'list',
      start: first?.node.start ?? 0,
      end: last?.node.end ?? 0,
      items,
    };
  }

  private andOr(): AndOr {
    const first = this.pipeline();
    const rest: { op: '&&' | '||'; pipe: Pipeline }[] = [];
    let end = first.end;
    for (let t = this.peek(); this.isOp(t, '&&', '||'); t = this.peek()) {
      const op = t?.value === '&&' ? '&&' : '||';
      this.p += 1;
      this.skipNewlines();
      if (this.p >= this.toks.length) throw incomplete('andor');
      const pipe = this.pipeline();
      rest.push({ op, pipe });
      end = pipe.end;
    }
    return { type: 'andor', start: first.start, end, first, rest };
  }

  private pipeline(): Pipeline {
    const startToken = this.peek();
    const start = startToken?.start ?? this.src.length;
    let negate = false;
    for (let t = this.peek(); t?.kind === 'word' && t.raw === '!'; t = this.peek()) {
      negate = !negate;
      this.p += 1;
    }
    const cmds: SimpleCommand[] = [];
    const next = this.peek();
    if (negate && (next === undefined || next.kind === 'op')) {
      // A lone `!` negates an empty command, so its status is 1, as in bash.
      const at = this.toks[this.p - 1]?.end ?? start;
      if (this.isOp(next, '|', '|&')) throw syntaxError(this.src, next);
      cmds.push({ type: 'cmd', start: at, end: at, assigns: [], words: [], redirects: [] });
      return { type: 'pipe', start, end: at, negate, cmds };
    }
    cmds.push(this.command());
    for (let t = this.peek(); this.isOp(t, '|', '|&'); t = this.peek()) {
      if (t?.value === '|&') {
        // `a |& b` is `a 2>&1 | b`: stderr joins stdout after a's own redirections.
        const left = cmds.pop();
        if (left !== undefined) cmds.push({ ...left, redirects: [...left.redirects, { start: t.start, end: t.end, op: '2>&1' }] });
      }
      this.p += 1;
      this.skipNewlines();
      if (this.p >= this.toks.length) throw incomplete('pipe');
      cmds.push(this.command());
    }
    const last = cmds[cmds.length - 1];
    return { type: 'pipe', start, end: last?.end ?? start, negate, cmds };
  }

  private command(): SimpleCommand {
    const assigns: Assign[] = [];
    const words: Word[] = [];
    const redirects: Redirect[] = [];
    const first = this.peek();
    if (first === undefined || first.kind === 'op') throw syntaxError(this.src, first, this.peek(1));
    const start = first.start;
    let end = start;
    for (let t = this.peek(); t !== undefined && t.kind !== 'op'; t = this.peek()) {
      if (t.kind === 'redir') {
        const next = this.peek(1);
        if (t.value === '<' && next?.kind === 'redir' && next.value === '<' && next.start === t.end) {
          throw notSupported('<<', { start: t.start, end: next.end });
        }
        if (t.unsupportedFd !== undefined) {
          throw new Stop({
            ok: false,
            incomplete: false,
            message: `${t.unsupportedFd}: file descriptors other than 0, 1 and 2 are not supported`,
            at: { start: t.start, end: t.end },
          });
        }
        // Process substitution: `cat <(ls)`.
        if (next?.kind === 'word' && !next.quoted && next.raw.startsWith('(') && (t.raw === '<' || t.raw === '>')) {
          throw notSupported(`${t.raw}(`, { start: t.start, end: next.end });
        }
        this.p += 1;
        if (!takesTarget(t.value)) {
          redirects.push({ start: t.start, end: t.end, op: t.value });
          end = t.end;
          continue;
        }
        if (next === undefined || next.kind !== 'word') throw syntaxError(this.src, next, this.peek(1));
        this.p += 1;
        const target = toWord(next);
        this.checkNested(target);
        redirects.push({ start: t.start, end: next.end, op: t.value, target });
        end = next.end;
        continue;
      }
      if (words.length === 0 && t.assign !== undefined) {
        const assign = assignment(this.src, t);
        this.checkNested(assign.value);
        assigns.push(assign);
      } else {
        if (words.length === 0 && assigns.length === 0) this.checkCommandWord(t);
        if (words.length === 1 && !t.quoted && t.raw === '()') throw notSupported('function', t);
        const word = toWord(t);
        this.checkNested(word);
        words.push(word);
      }
      this.p += 1;
      end = t.end;
    }
    return { type: 'cmd', start, end, assigns, words, redirects };
  }

  /** Reports compound-command keywords in command position. */
  private checkCommandWord(t: WordToken): void {
    if (t.quoted) return;
    if (UNSUPPORTED.has(t.raw)) throw notSupported(t.raw, t);
    if (UNEXPECTED.has(t.raw)) throw syntaxError(this.src, t);
    if (t.raw.startsWith('((')) throw notSupported('((', t);
    if (FUNCTION_DEFINITION.test(t.raw)) throw notSupported('function', t);
    // A subshell: `(cd /tmp; pwd)`. Elsewhere a parenthesis is text, so `echo :)` is a smiley.
    if (t.raw.startsWith('(')) throw notSupported('(', t);
  }

  /** Parses the command substitutions inside a word, so their syntax errors surface now. */
  private checkNested(word: Word): void {
    if (!this.complete) return;
    const visit = (parts: readonly WordPart[]): void => {
      for (const part of parts) {
        if (part.kind === 'param' && part.arg !== undefined) visit(part.arg);
        if (part.kind !== 'cmdsub' || this.depth >= MAX_NESTING) continue;
        const nested = parseSource(part.source, lex(part.source), this.depth + 1);
        if (nested.ok === true) continue;
        const message = nested.incomplete === true ? nestedIncomplete(part.source, nested.reason) : nested.message;
        throw new Stop({ ok: false, incomplete: false, message, at: { start: word.start, end: word.end } });
      }
    };
    visit(word.parts);
  }
}

/** bash's message for a command substitution whose source stops short. */
function nestedIncomplete(source: string, reason: IncompleteReason): string {
  return reason === 'pipe' || reason === 'andor' ? "syntax error near unexpected token ')'" : describeIncomplete(source, reason);
}

function parseSource(src: string, lexed: LexResult, depth: number): ParseResult {
  const tokens = lexed.tokens;
  const parser = new Parser(src, tokens, depth, lexed.complete);
  try {
    const ast = parser.list();
    const reason = incompleteReason(lexed);
    if (reason !== null) return { ok: false, incomplete: true, reason, tokens };
    return { ok: true, ast, tokens };
  } catch (error) {
    if (error instanceof Stop) return { ...error.failure, tokens } satisfies ParseFailure;
    throw error;
  }
}

/** Parses one line (or several joined by newlines). Never throws. */
export function parse(src: string): ParseResult {
  return parseSource(src, lex(src), 0);
}

/**
 * bash's message when a script or a `$( )` ends while a line is unfinished, for `source` and
 * friends; at the prompt an unfinished line gets a `> ` continuation prompt instead.
 */
export function describeIncomplete(src: string, reason: IncompleteReason): string {
  if (reason === 'quote') {
    const quote = lex(src).openQuote ?? '"';
    return `unexpected EOF while looking for matching '${quote}'`;
  }
  return 'syntax error: unexpected end of file';
}
