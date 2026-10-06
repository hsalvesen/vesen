// Quote-aware insertion for completion (docs/plan/designs/terminal-input.md, "accept()"). What
// the visitor typed is kept exactly as typed, and only the text a completion adds is escaped,
// for the quote it lands in. scanRaw maps the typed characters to the unquoted text the lexer
// reads, so a completion can be spliced in at the right place inside quotes and escapes.

import type { Quote } from '../lexer-types';

export interface RawScan {
  /** The text with quotes removed and escapes applied. */
  readonly value: string;
  /** For each character of `value`: where its raw form starts and ends, and the quote open there. */
  readonly starts: readonly number[];
  readonly ends: readonly number[];
  readonly quotes: readonly (Quote | null)[];
  /** The quote open at the end of the raw text. */
  readonly endQuote: Quote | null;
}

/** Backslash escapes inside double quotes, as in bash: \" \\ \$ \` and a line continuation. */
const DOUBLE_ESCAPES = new Set(['"', '\\', '$', '`', '\n']);

/**
 * Reads raw word text as the lexer does: single and double quotes, and backslash escapes. `quote`
 * is the quote already open where the text starts.
 */
export function scanRaw(raw: string, quote: Quote | null = null): RawScan {
  const starts: number[] = [];
  const ends: number[] = [];
  const quotes: (Quote | null)[] = [];
  let value = '';
  let q = quote;
  let i = 0;
  const take = (from: number, to: number, char: string): void => {
    starts.push(from);
    ends.push(to);
    quotes.push(q);
    value += char;
  };
  while (i < raw.length) {
    const c = raw.charAt(i);
    if (q === "'") {
      if (c === "'") q = null;
      else take(i, i + 1, c);
      i += 1;
    } else if (q === '"') {
      if (c === '"') {
        q = null;
        i += 1;
      } else if (c === '\\' && i + 1 < raw.length && DOUBLE_ESCAPES.has(raw.charAt(i + 1))) {
        if (raw.charAt(i + 1) !== '\n') take(i, i + 2, raw.charAt(i + 1));
        i += 2;
      } else {
        take(i, i + 1, c);
        i += 1;
      }
    } else if (c === "'" || c === '"') {
      q = c;
      i += 1;
    } else if (c === '\\') {
      // A lone backslash at the end escapes what comes next, which is not typed yet.
      if (i + 1 < raw.length && raw.charAt(i + 1) !== '\n') take(i, i + 2, raw.charAt(i + 1));
      i += 2;
    } else {
      take(i, i + 1, c);
      i += 1;
    }
  }
  return { value, starts, ends, quotes, endQuote: q };
}

/**
 * Where to cut `raw` to keep its first `k` unquoted characters, and the quote open there. A
 * quote opened right after them is kept (`"` before a completion of `"my`), a closing quote or
 * a dangling backslash is not: the completion closes the quote itself, or escapes what it adds.
 */
export function cutAt(scan: RawScan, raw: string, k: number, quote: Quote | null = null): { index: number; quote: Quote | null } {
  if (k < scan.value.length) return { index: scan.starts[k] ?? 0, quote: scan.quotes[k] ?? null };
  const last = scan.value.length - 1;
  let index = last >= 0 ? (scan.ends[last] ?? 0) : 0;
  let q = last >= 0 ? (scan.quotes[last] ?? null) : quote;
  while (q === null && index < raw.length && (raw.charAt(index) === '"' || raw.charAt(index) === "'")) {
    q = raw.charAt(index) as Quote;
    index += 1;
  }
  return { index, quote: q };
}

/** Characters with a meaning to the shell outside quotes. `~` is not one: only a leading ~ expands, and that is the visitor's. */
const SPECIAL = new Set([' ', '\t', "'", '"', '\\', '|', '&', ';', '<', '>', '$', '`', '*', '?', '[', '{', '!']);

/**
 * Escapes text a completion adds, for the quote it lands in: backslashes outside quotes, `'\''`
 * for a single quote inside single quotes, and \" \\ \$ \` inside double quotes. A `#` is escaped
 * only where it would start a comment, at the start of a word. A newline is quoted, since a
 * backslash before one continues the line.
 */
export function escapeTail(text: string, quote: Quote | null, atWordStart = false): string {
  if (quote === "'") return text.replace(/'/g, "'\\''");
  if (quote === '"') return text.replace(/["\\$`]/g, '\\$&').replace(/!/g, '"\\!"');
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charAt(i);
    if (c === '\n') out += "'\n'";
    else if (SPECIAL.has(c) || (c === '#' && atWordStart && i === 0)) out += `\\${c}`;
    else out += c;
  }
  return out;
}
