// The contract for the one shell lexer (docs/plan/02-architecture-and-contracts.md, section 3).
// `lex(line)` in src/shell/lexer.ts implements it. It is total: it never throws, and an
// unfinished line comes back with `complete: false` instead of an error. The parser turns that
// into a `> ` continuation prompt, and completion lexes the line up to the cursor with the same
// function, so both always agree on where words start and end.
//
// Offsets are UTF-16 indices into the source line, half-open: [start, end).

/** An open quote character. */
export type Quote = '"' | "'";

/**
 * How a piece of a word was quoted, which decides what expansion may do to it:
 * 0 unquoted (split, glob, tilde), 1 single-quoted or backslash-escaped (nothing),
 * 2 double-quoted (parameters and substitutions only).
 */
export type QuoteLevel = 0 | 1 | 2;

/** Operators that separate commands. */
export type ControlOp = '|' | '||' | '&&' | ';' | '&';

/** Redirection operators; the target, if any, is the next word token. */
export type RedirOp = '<' | '>' | '>>' | '2>' | '2>>' | '&>' | '2>&1' | '>&2' | '<<<';

/** `${NAME:-word}` and friends. */
export type ParamOp = ':-' | '-' | ':=' | ':+';

export interface SourceRange {
  readonly start: number;
  readonly end: number;
}

export type WordPart =
  /** Literal text with quotes removed and escapes applied. */
  | { readonly kind: 'lit'; readonly text: string; readonly q: QuoteLevel }
  /** `$NAME`, `${NAME}`, `${NAME:-word}`, and the specials `$?`, `$#`, `$$`, `$0`. */
  | {
      readonly kind: 'param';
      readonly name: string;
      readonly braced: boolean;
      readonly op?: ParamOp;
      readonly arg?: readonly WordPart[];
      readonly q: 0 | 2;
    }
  /** `$( … )`. The parser parses `source` as a nested list. */
  | { readonly kind: 'cmdsub'; readonly source: string; readonly q: 0 | 2 }
  /** `$(( … ))`. */
  | { readonly kind: 'arith'; readonly expr: string; readonly q: 0 | 2 }
  /** A leading unquoted `~` or `~user`. */
  | { readonly kind: 'tilde'; readonly user?: string };

export interface WordToken extends SourceRange {
  readonly kind: 'word';
  /** Exactly `line.slice(start, end)`. */
  readonly raw: string;
  /** Quotes removed and escapes applied; parameters and substitutions left as typed. */
  readonly value: string;
  readonly parts: readonly WordPart[];
  /** True when any part of the word was quoted or escaped. */
  readonly quoted: boolean;
  /** The quote still open at the end of this word, when the line ends inside it. */
  readonly openQuote: Quote | null;
  /** True when the line ends with a lone backslash inside this word. */
  readonly danglingEscape: boolean;
  /** Set when the word has the shape `NAME=value`; the parser decides whether it assigns. */
  readonly assign?: { readonly name: string; readonly valueStart: number };
}

export interface OpToken extends SourceRange {
  readonly kind: 'op';
  readonly raw: ControlOp;
  readonly value: ControlOp;
}

export interface RedirToken extends SourceRange {
  readonly kind: 'redir';
  readonly raw: RedirOp;
  readonly value: RedirOp;
}

export type Token = WordToken | OpToken | RedirToken;
export type TokenKind = Token['kind'];

export interface LexResult {
  readonly tokens: readonly Token[];
  /** False while a quote, an escape or a `$(`, `${` or `$((` is still open at the end of the line. */
  readonly complete: boolean;
  readonly openQuote: Quote | null;
  readonly danglingEscape: boolean;
  /** Offset of an unquoted `#` that starts a comment; everything from there is ignored. */
  readonly commentAt: number | null;
}

/** The lexer's signature; src/shell/lexer.ts exports a function of this type as `lex`. */
export type Lex = (line: string) => LexResult;
