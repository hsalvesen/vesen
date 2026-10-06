// The syntax tree the parser builds (docs/plan/designs/shell-architecture.md, "src/shell/ast.ts").
// A line is a List of AndOr chains, each a run of Pipelines joined by && or ||, each a run of
// SimpleCommands joined by |. vesen has no compound commands: if, for, while, until, case,
// functions, groups and here-documents are reported as not supported.
//
// Word parts are the lexer's (./lexer-types.ts), so a word keeps its quoting all the way to
// expansion. Offsets are UTF-16 indices into the parsed line, half-open: [start, end).

import type { RedirOp, Token, WordPart } from './lexer-types';

export type { RedirOp, Token, WordPart } from './lexer-types';

export interface Pos {
  readonly start: number;
  readonly end: number;
}

export interface Word extends Pos {
  /** Exactly the source text of the word. */
  readonly raw: string;
  readonly parts: readonly WordPart[];
  /** True when any part was quoted or escaped. */
  readonly quoted: boolean;
}

/** `NAME=value` before the command name: alone it sets a shell variable, else the command's env. */
export interface Assign extends Pos {
  readonly name: string;
  /** The text after `=`. */
  readonly value: Word;
}

export interface Redirect extends Pos {
  readonly op: RedirOp;
  /** The file or text the redirection uses; absent for 2>&1 and >&2. */
  readonly target?: Word;
}

export interface SimpleCommand extends Pos {
  readonly type: 'cmd';
  readonly assigns: readonly Assign[];
  /** The command name and its arguments, before expansion; empty for `A=1` or `> file` alone. */
  readonly words: readonly Word[];
  /** In source order, which is the order they apply in. */
  readonly redirects: readonly Redirect[];
}

export interface Pipeline extends Pos {
  readonly type: 'pipe';
  /** `! cmd`: the status is inverted. */
  readonly negate: boolean;
  /** At least one command; a lone `!` gives one empty command, so its status is 1 as in bash. */
  readonly cmds: readonly SimpleCommand[];
}

export interface AndOr extends Pos {
  readonly type: 'andor';
  readonly first: Pipeline;
  readonly rest: readonly { readonly op: '&&' | '||'; readonly pipe: Pipeline }[];
}

export interface ListItem {
  readonly node: AndOr;
  /** Ended with `&`. vesen has no job control, so it still runs in the foreground, with a notice. */
  readonly background: boolean;
}

export interface List extends Pos {
  readonly type: 'list';
  /** Empty for a blank line or a comment. */
  readonly items: readonly ListItem[];
}

/**
 * Why a line is unfinished: an open quote, a trailing | or && / ||, a trailing backslash, or an
 * open $( ), ${ }, $(( )) or backtick. The editor shows a `> ` prompt and appends the next line.
 */
export type IncompleteReason = 'quote' | 'pipe' | 'andor' | 'backslash' | 'subst';

export type ParseResult =
  | { readonly ok: true; readonly ast: List; readonly tokens: readonly Token[] }
  | { readonly ok: false; readonly incomplete: true; readonly reason: IncompleteReason; readonly tokens: readonly Token[] }
  | {
      readonly ok: false;
      readonly incomplete: false;
      /**
       * bash's wording without the `vesen: ` prefix the shell prints before it, such as
       * "syntax error near unexpected token '|'" or "for: not supported in vesen".
       */
      readonly message: string;
      /** The offending token, or an empty range at the end of the line. */
      readonly at: Pos;
      readonly tokens: readonly Token[];
    };

export type ParseFailure = Extract<ParseResult, { ok: false }>;
