// History expansion, the first thing done to a typed line, as in interactive bash:
//
//   !!        the previous command          !n    command number n
//   !-n       the command n back            !abc  the newest command starting with abc
//   !?abc?    the newest command containing abc
//   !$ !^ !*  the last word, the first argument, all arguments of the previous command
//   !!:2 !-2:$ !abc:*   a word designator after any event: :N :^ :$ :* :N-M :N*
//   ^old^new^ at the start of a line: the previous command with old replaced by new
//
// It is inert inside single quotes (and $'…'), after a backslash, and when the `!` is followed by
// a blank, `=`, `(`, `"` or the end of the line, so `echo hi!`, `a != b` and `! false` are left
// alone. Unlike bash, a `!` right after `[` is also left alone, so the glob `[!a]*` works.
//
// When the line changes, the shell echoes the expanded line and stores that in history.

import type { HistoryApi } from './types';
import { lex } from './lexer';

export type HistoryLookup = Pick<HistoryApi, 'get' | 'last' | 'findPrefix' | 'search'>;

export type HistoryExpansion =
  | { readonly ok: true; readonly line: string; readonly changed: boolean }
  /** bash's wording without the `vesen: ` prefix, such as "!foo: event not found". */
  | { readonly ok: false; readonly error: string };

/** Characters after `!` that leave it literal. */
const LITERAL_AFTER = new Set(['', ' ', '\t', '\n', '\r', '=', '(', '"']);
/** Characters that end the text of `!prefix`. */
const PREFIX_END = /[\s;&|<>()`'"\\:!]/;

/** The words of a history line, as bash numbers them for !$ !^ !*: operators count as words. */
function historyWords(line: string): string[] {
  return lex(line).tokens.map((t) => t.raw);
}

/**
 * Applies a word designator (the text after ':', or '$' '^' '*' for the shortcuts) to a line.
 * Returns the selected words, or null for a designator that selects nothing.
 */
function selectWords(line: string, designator: string): string | null {
  const words = historyWords(line);
  const last = words.length - 1;
  const index = (s: string): number => (s === '^' ? 1 : s === '$' ? last : Number(s));
  let from: number;
  let to: number;
  if (designator === '*') {
    if (last < 1) return '';
    from = 1;
    to = last;
  } else if (/^([0-9]+|\^|\$)$/.test(designator)) {
    from = index(designator);
    to = from;
  } else if (/^([0-9]+|\^)\*$/.test(designator)) {
    from = index(designator.slice(0, -1));
    to = last;
  } else {
    const range = /^([0-9]+|\^)?-([0-9]+|\$)?$/.exec(designator);
    if (range === null) return null;
    from = range[1] === undefined ? 0 : index(range[1]);
    to = range[2] === undefined ? last - 1 : index(range[2]);
  }
  if (from < 0 || to > last || from > to) return null;
  return words.slice(from, to + 1).join(' ');
}

/** Reads a word designator after ':' at `i`; returns it and the index after it. */
function readDesignator(line: string, i: number): { text: string; next: number } | null {
  const match = /^(?:[0-9]+-(?:[0-9]+|\$)?|-(?:[0-9]+|\$)?|[0-9]+\*?|\^\*?|\$|\*)/.exec(line.slice(i));
  if (match === null) return null;
  return { text: match[0], next: i + match[0].length };
}

interface Event {
  /** What bash prints in an error, such as `!foo`. */
  readonly label: string;
  readonly line: string | undefined;
  readonly next: number;
  /** A shortcut designator implied by the event itself: !$ !^ !*. */
  readonly words?: string;
}

/** Reads the event after the `!` at `i`; null when the `!` is literal. */
function readEvent(line: string, i: number, history: HistoryLookup): Event | null {
  const n = line.charAt(i + 1);
  if (LITERAL_AFTER.has(n)) return null;
  if (n === '!') return { label: '!!', line: history.last(1), next: i + 2 };
  if (n === '$' || n === '^' || n === '*') return { label: `!${n}`, line: history.last(1), next: i + 2, words: n };
  const number = /^-?[0-9]+/.exec(line.slice(i + 1));
  if (number !== null) {
    const text = number[0];
    const value = Number(text);
    const found = text.startsWith('-') ? history.last(-value) : history.get(value);
    return { label: `!${text}`, line: value === 0 ? undefined : found, next: i + 1 + text.length };
  }
  if (n === '?') {
    const close = line.indexOf('?', i + 2);
    const end = close === -1 ? line.length : close;
    const query = line.slice(i + 2, end);
    const found = query === '' ? undefined : history.search(query)?.line;
    return { label: `!?${query}`, line: found, next: close === -1 ? end : close + 1 };
  }
  if (n === '#') return null;
  let j = i + 1;
  while (j < line.length && !PREFIX_END.test(line.charAt(j))) j += 1;
  const prefix = line.slice(i + 1, j);
  if (prefix === '') return null;
  return { label: `!${prefix}`, line: history.findPrefix(prefix), next: j };
}

/** ^old^new^ quick substitution; `line` starts with '^'. */
function quickSubstitution(line: string, history: HistoryLookup): HistoryExpansion {
  const second = line.indexOf('^', 1);
  const old = second === -1 ? line.slice(1) : line.slice(1, second);
  const rest = second === -1 ? '' : line.slice(second + 1);
  const third = rest.indexOf('^');
  const replacement = third === -1 ? rest : rest.slice(0, third);
  const tail = third === -1 ? '' : rest.slice(third + 1);
  const previous = history.last(1);
  if (previous === undefined) return { ok: false, error: '!!: event not found' };
  const at = old === '' ? -1 : previous.indexOf(old);
  if (at === -1) return { ok: false, error: `:s^${old}^${replacement}: substitution failed` };
  const expanded = previous.slice(0, at) + replacement + previous.slice(at + old.length) + tail;
  return { ok: true, line: expanded, changed: true };
}

/** Expands history references in a typed line. Never throws. */
export function expandHistory(line: string, history: HistoryLookup): HistoryExpansion {
  if (line.startsWith('^')) return quickSubstitution(line, history);
  let out = '';
  let changed = false;
  let single = false;
  let ansi = false;
  let double = false;
  let i = 0;
  while (i < line.length) {
    const c = line.charAt(i);
    if (single) {
      if (c === "'") single = false;
      out += c;
      i += 1;
      continue;
    }
    if (ansi) {
      if (c === '\\') {
        out += line.slice(i, i + 2);
        i += 2;
        continue;
      }
      if (c === "'") ansi = false;
      out += c;
      i += 1;
      continue;
    }
    if (c === '\\') {
      out += line.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (c === "'" && !double) {
      if (line.charAt(i - 1) === '$') ansi = true;
      else single = true;
    } else if (c === '"') {
      double = !double;
    } else if (c === '!') {
      const before = line.charAt(i - 1);
      const literal = before === '[' || before === '$' || (before === '{' && line.charAt(i - 2) === '$');
      const event = literal ? null : readEvent(line, i, history);
      if (event !== null) {
        if (event.line === undefined) return { ok: false, error: `${event.label}: event not found` };
        let designator = event.words;
        let next = event.next;
        if (designator === undefined && line.charAt(next) === ':') {
          const read = readDesignator(line, next + 1);
          if (read !== null) {
            designator = read.text;
            next = read.next;
          }
        }
        let text: string | null = event.line;
        if (designator !== undefined) text = selectWords(event.line, designator);
        if (text === null) return { ok: false, error: `${line.slice(i, next)}: bad word specifier` };
        out += text;
        changed = true;
        i = next;
        continue;
      }
    }
    out += c;
    i += 1;
  }
  return { ok: true, line: out, changed };
}
