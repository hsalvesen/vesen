// Alias expansion, done on the line after history expansion and before parsing, as bash does:
//
// - Only an unquoted word in command position is looked up: at the start of the line, after
//   | || && ; & or a newline, and after NAME=value assignments that start a command.
// - The replacement is spliced in as source text, so an alias may hold pipes, lists or
//   redirections (`alias count='ls | wc -l'`), and its own first word is looked up again.
// - An alias is never expanded inside its own expansion, so `alias ls='ls -F'` terminates.
// - When a value ends in a blank, the word after the alias is looked up too
//   (`alias sudo='sudo '` makes `sudo ll` work).
//
// Aliases defined on a line take effect from the next line, as in bash, because the whole line
// is expanded before any of it runs.

import { lex, takesTarget } from './lexer';

/** Where alias values are looked up: the session's alias map satisfies this. */
export interface AliasTable {
  get(name: string): string | undefined;
}

export interface AliasExpansion {
  readonly line: string;
  readonly changed: boolean;
}

/** The longest line alias expansion may produce; past it, remaining words are left alone. */
export const MAX_ALIAS_EXPANSION = 64 * 1024;

/** Characters an alias name may not contain, as in bash. */
const INVALID_NAME = /[\s/$`=\\'"|&;()<>]/;

/** True when `name` can be an alias: no blanks, quotes, `/`, `$`, `=` or shell operators. */
export function isValidAliasName(name: string): boolean {
  return name !== '' && !name.startsWith('-') && !INVALID_NAME.test(name);
}

interface Expanded {
  readonly text: string;
  /** True when the word after this text is in command position (or follows a blank-ended alias). */
  readonly commandNext: boolean;
  readonly changed: boolean;
}

function expandSource(src: string, aliases: AliasTable, seen: ReadonlySet<string>, commandPosition: boolean, budget: { left: number }): Expanded {
  const { tokens } = lex(src);
  let out = '';
  let copied = 0;
  let check = commandPosition;
  let changed = false;
  let target = false;
  for (const t of tokens) {
    if (t.kind === 'op') {
      check = true;
      target = false;
      continue;
    }
    if (t.kind === 'redir') {
      target = takesTarget(t.value);
      continue;
    }
    if (target) {
      // A redirection target is never a command; the word after it may still be.
      target = false;
      continue;
    }
    const value = check && !t.quoted && !seen.has(t.raw) ? aliases.get(t.raw) : undefined;
    if (value !== undefined && isValidAliasName(t.raw) && budget.left >= value.length) {
      budget.left -= value.length;
      const inner = expandSource(value, aliases, new Set([...seen, t.raw]), true, budget);
      out += src.slice(copied, t.start) + inner.text;
      copied = t.end;
      changed = true;
      check = inner.commandNext || /[ \t]$/.test(value);
      continue;
    }
    check = check && t.assign !== undefined;
  }
  out += src.slice(copied);
  return { text: out, commandNext: check, changed };
}

/** Expands aliases in a line. Never throws. */
export function expandAliases(line: string, aliases: AliasTable): AliasExpansion {
  const result = expandSource(line, aliases, new Set(), true, { left: MAX_ALIAS_EXPANSION });
  return { line: result.text, changed: result.changed };
}
