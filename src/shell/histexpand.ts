// History expansion, the first thing done to a typed line, as in interactive bash:
//
//   !!        the previous command          !n    command number n
//   !-n       the command n back            !abc  the newest command starting with abc
//   !?abc?    the newest command containing abc
//   !$ !^ !*  the last word, the first argument, all arguments of the previous command
//   !!:2 !-2:$ !abc:*   a word designator after any event: :N :^ :$ :* :N-M :N*
//   !:N       word N of the previous command, as !!:N
//   ^old^new^ at the start of a line: the previous command with old replaced by new
//
// and after the event and designator, any number of modifiers, as bash reads them:
//
//   :h :t     the head or the tail of a path       :r :e   without, or only, the .suffix
//   :q :x     quoted as one word, or word by word  :p      print the line, do not run it
//   :s/a/b/   replace the first a with b (& in b is a; any delimiter, the last one optional)
//   :gs/a/b/  replace every a                      :& :g&  repeat the last replacement
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
  /** With `printOnly` (a :p modifier), the line is shown and kept in history, and not run. */
  | { readonly ok: true; readonly line: string; readonly changed: boolean; readonly printOnly?: boolean }
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
  // `!:1` is `!!:1`: a word designator or modifier straight after the `!`.
  if (n === ':') return { label: '!!', line: history.last(1), next: i + 1 };
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

/** The last :s replacement, for :& and g&; bash keeps it from line to line. */
export interface HistoryState {
  last?: { readonly old: string; readonly replacement: string };
}

/** ^old^new^ quick substitution; `line` starts with '^'. */
function quickSubstitution(line: string, history: HistoryLookup, state: HistoryState): HistoryExpansion {
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
  state.last = { old, replacement };
  const expanded = previous.slice(0, at) + replacement + previous.slice(at + old.length) + tail;
  return { ok: true, line: expanded, changed: true };
}

/** `text` quoted as one word, as :q quotes it. */
function quoteWord(text: string): string {
  return `'${text.replace(/'/g, "'\\''")}'`;
}

/** Replaces `old` with `replacement` in `text`, the first or every time; null when it is not there. */
function replace(text: string, old: string, replacement: string, global: boolean): string | null {
  if (old === '' || !text.includes(old)) return null;
  return global ? text.split(old).join(replacement) : text.replace(old, () => replacement);
}

/** Reads `s/old/new/` (any delimiter) at `j`, the `s`; the last delimiter may be left off at the end. */
function readSubstitution(line: string, j: number): { old: string; replacement: string; next: number } | null {
  const delimiter = line.charAt(j + 1);
  if (delimiter === '' || /\s/.test(delimiter)) return null;
  const read = (from: number): { text: string; next: number } => {
    let text = '';
    let k = from;
    while (k < line.length && line.charAt(k) !== delimiter) {
      if (line.charAt(k) === '\\' && line.charAt(k + 1) === delimiter) {
        text += delimiter;
        k += 2;
      } else {
        text += line.charAt(k);
        k += 1;
      }
    }
    return { text, next: k < line.length ? k + 1 : k };
  };
  const old = read(j + 2);
  const replacement = read(old.next);
  // An unescaped & in the replacement is the text replaced.
  const made = replacement.text.replace(/\\&|&/g, (m) => (m === '&' ? old.text : '&'));
  return { old: old.text, replacement: made, next: replacement.next };
}

/**
 * Applies the :modifiers starting at `at` (a ':') to `text`. Returns the result and where the
 * modifiers end, or an error in bash's words.
 */
function applyModifiers(
  line: string,
  at: number,
  text: string,
  state: HistoryState,
): { text: string; next: number; printOnly: boolean } | { error: string } {
  let next = at;
  let printOnly = false;
  while (line.charAt(next) === ':') {
    const j = next + 1;
    const c = line.charAt(j);
    if (c === '' || /\s/.test(c)) break;
    const lastSlash = text.lastIndexOf('/');
    const lastDot = text.lastIndexOf('.');
    switch (c) {
      case 'h':
        if (lastSlash !== -1) text = text.slice(0, lastSlash);
        next = j + 1;
        continue;
      case 't':
        if (lastSlash !== -1) text = text.slice(lastSlash + 1);
        next = j + 1;
        continue;
      case 'r':
        if (lastDot > lastSlash) text = text.slice(0, lastDot);
        next = j + 1;
        continue;
      case 'e':
        text = lastDot > lastSlash ? text.slice(lastDot) : '';
        next = j + 1;
        continue;
      case 'q':
        text = quoteWord(text);
        next = j + 1;
        continue;
      case 'x':
        text = text.split(/\s+/).filter((word) => word !== '').map(quoteWord).join(' ');
        next = j + 1;
        continue;
      case 'p':
        printOnly = true;
        next = j + 1;
        continue;
    }
    const global = c === 'g' || c === 'G';
    const k = global ? j + 1 : j;
    const op = line.charAt(k);
    if (op === 's') {
      const sub = readSubstitution(line, k);
      if (sub === null) return { error: `${line.slice(j, k + 2)}: unrecognized history modifier` };
      const done = replace(text, sub.old, sub.replacement, global);
      if (done === null) return { error: `${line.slice(next, sub.next)}: substitution failed` };
      state.last = { old: sub.old, replacement: sub.replacement };
      text = done;
      next = sub.next;
      continue;
    }
    if (op === '&') {
      const last = state.last;
      const done = last === undefined ? null : replace(text, last.old, last.replacement, global);
      if (done === null) return { error: `${line.slice(next, k + 1)}: substitution failed` };
      text = done;
      next = k + 1;
      continue;
    }
    return { error: `${c}: unrecognized history modifier` };
  }
  return { text, next, printOnly };
}

/**
 * Expands history references in a typed line. Never throws. `state` keeps the last :s
 * replacement for :& on a later line; the shell passes one per session.
 */
export function expandHistory(line: string, history: HistoryLookup, state: HistoryState = {}): HistoryExpansion {
  if (line.startsWith('^')) return quickSubstitution(line, history, state);
  let out = '';
  let changed = false;
  let printOnly = false;
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
        const modified = applyModifiers(line, next, text, state);
        if ('error' in modified) return { ok: false, error: modified.error };
        out += modified.text;
        if (modified.printOnly) printOnly = true;
        changed = true;
        i = modified.next;
        continue;
      }
    }
    out += c;
    i += 1;
  }
  return printOnly ? { ok: true, line: out, changed, printOnly } : { ok: true, line: out, changed };
}
