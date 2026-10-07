// The one guard every regular expression a visitor types goes through (grep, sed, find -regex,
// pgrep and the rest). A JavaScript regular expression cannot be interrupted, so a pattern that
// backtracks without end would freeze the page, ^C included. The guard caps the pattern and the
// text it is run over, and refuses the shapes that backtrack catastrophically, such as a
// repeated group that itself repeats: (a+)+, (.*)*, (x+y*){2,}.
//
// Patterns are POSIX regular expressions, extended (ERE) or basic (BRE), turned into JavaScript
// ones: [[:alpha:]] and the other classes, and in a BRE \( \) \{ \} \| \+ \? as groups and
// counts, with ( ) { } | + ? themselves literal.

/** The longest pattern accepted, in characters. */
export const MAX_PATTERN_LENGTH = 1_000;

/** The longest line (or other text) one match is tried on; the rest of a longer one is not searched. */
export const MAX_SUBJECT_LENGTH = 10_000;

/** The most text one command searches in all, in characters (4 MB): a file, or a pipe's input. */
export const MAX_INPUT_LENGTH = 4_000_000;

/** A pattern the guard refuses, or that is not a valid expression; the message says why. */
export class PatternError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PatternError';
  }
}

export interface PatternOptions {
  /** A basic regular expression (grep, sed), not an extended one (grep -E, pgrep). */
  readonly basic?: boolean;
  readonly ignoreCase?: boolean;
  /** Every match, not only the first: sed's g, grep -o. */
  readonly global?: boolean;
}

const CLASSES: Readonly<Record<string, string>> = {
  alpha: 'A-Za-z',
  digit: '0-9',
  alnum: 'A-Za-z0-9',
  upper: 'A-Z',
  lower: 'a-z',
  space: ' \\t\\n\\r\\f\\v',
  blank: ' \\t',
  punct: '!-\\/:-@\\[-`{-~',
  xdigit: '0-9A-Fa-f',
  cntrl: '\\x00-\\x1f\\x7f',
  print: ' -~',
  graph: '!-~',
  word: 'A-Za-z0-9_',
};

/** A POSIX pattern as a JavaScript one. Throws PatternError for an unknown [:class:]. */
export function translatePosix(source: string, basic = false): string {
  let result = '';
  let i = 0;
  while (i < source.length) {
    const c = source.charAt(i);
    if (c === '[') {
      // A bracket expression: copied as it is, with its [:classes:] spelled out.
      let j = i + 1;
      let body = '';
      if (source.charAt(j) === '^') {
        body += '^';
        j += 1;
      }
      if (source.charAt(j) === ']') {
        body += '\\]';
        j += 1;
      }
      while (j < source.length && source.charAt(j) !== ']') {
        const class_ = /^\[:([a-z]+):\]/.exec(source.slice(j));
        if (class_?.[1] !== undefined) {
          const range = CLASSES[class_[1]];
          if (range === undefined) throw new PatternError(`invalid character class '${class_[1]}'`);
          body += range;
          j += class_[0].length;
          continue;
        }
        const d = source.charAt(j);
        body += d === '\\' || (d === '[' && source.charAt(j + 1) !== ':') ? `\\${d}` : d;
        j += 1;
      }
      if (j >= source.length) throw new PatternError('Unmatched [, [^, [:, [., or [=');
      result += `[${body}]`;
      i = j + 1;
      continue;
    }
    if (c === '\\') {
      const d = source.charAt(i + 1);
      if (d === '') throw new PatternError('Trailing backslash');
      if (basic && '(){}|+?'.includes(d)) result += d;
      else if (d === '<' || d === '>') result += '\\b';
      else result += `\\${d}`;
      i += 2;
      continue;
    }
    if (basic && '(){}|+?'.includes(c)) {
      result += `\\${c}`;
      i += 1;
      continue;
    }
    // A `*` at the very start of a BRE, or after a group's start, is a literal star.
    if (basic && c === '*' && (result === '' || result.endsWith('(') || result === '^')) {
      result += '\\*';
      i += 1;
      continue;
    }
    result += c;
    i += 1;
  }
  return result;
}

/** How many times a quantifier at `source[i]` may repeat what it follows, and its length; null when none starts there. */
function quantifierAt(source: string, i: number): { readonly max: number; readonly length: number } | null {
  const c = source.charAt(i);
  if (c === '*' || c === '+') return { max: Infinity, length: 1 };
  if (c === '?') return { max: 1, length: 1 };
  if (c !== '{') return null;
  const match = /^\{(\d*)(,(\d*))?\}/.exec(source.slice(i));
  if (match === null) return null;
  const max = match[2] === undefined ? Number(match[1] || 0) : match[3] === '' ? Infinity : Number(match[3]);
  return { max, length: match[0].length };
}

/**
 * Why a JavaScript pattern could backtrack without end, or null: a group that repeats and holds
 * something that repeats without limit, at any depth, such as (a+)+, (\w+\s?)* or ((ab)*c){2,}.
 * Bounded counts inside a repeat, as in ([0-9]{1,3}\.){3}, are allowed.
 */
export function catastrophic(source: string): string | null {
  // For each open group, whether anything inside the group around it repeats without limit.
  const groups: boolean[] = [];
  let unbounded = false;
  let i = 0;
  // Steps past a quantifier at i, if there is one, and its lazy `?`; says how far it may repeat.
  const skipQuantifier = (): number => {
    const quantifier = quantifierAt(source, i);
    if (quantifier === null) return 1;
    i += quantifier.length;
    if (source.charAt(i) === '?') i += 1;
    return quantifier.max;
  };
  while (i < source.length) {
    const c = source.charAt(i);
    if (c === '(') {
      groups.push(unbounded);
      unbounded = false;
      i += 1;
      continue;
    }
    if (c === ')') {
      const inner = unbounded;
      unbounded = groups.pop() ?? false;
      i += 1;
      const max = skipQuantifier();
      if (inner && max > 1) return 'a repeated group that repeats without limit inside, such as (a+)+, could run for ever';
      // What the group holds repeats in the group around it too.
      if (inner || max === Infinity) unbounded = true;
      continue;
    }
    if (c === '\\') {
      i += 2;
    } else if (c === '[') {
      // A class is one character, whatever is inside it.
      let j = i + 1;
      if (source.charAt(j) === '^') j += 1;
      if (source.charAt(j) === ']') j += 1;
      while (j < source.length && source.charAt(j) !== ']') j += source.charAt(j) === '\\' ? 2 : 1;
      i = j + 1;
    } else {
      i += 1;
    }
    if (skipQuantifier() === Infinity) unbounded = true;
  }
  return null;
}

/**
 * A visitor's pattern as a RegExp, through the guard: at most MAX_PATTERN_LENGTH characters, no
 * catastrophic shape, valid. Throws PatternError saying what is wrong.
 */
export function compilePattern(pattern: string, options: PatternOptions = {}): RegExp {
  if (pattern.length > MAX_PATTERN_LENGTH) throw new PatternError(`pattern too long (more than ${MAX_PATTERN_LENGTH} characters)`);
  const source = translatePosix(pattern, options.basic === true);
  const danger = catastrophic(source);
  if (danger !== null) throw new PatternError(`refused: ${danger}`);
  try {
    return new RegExp(source, `${options.ignoreCase === true ? 'i' : ''}${options.global === true ? 'g' : ''}`);
  } catch (error) {
    const message = error instanceof Error ? error.message.replace(/^Invalid regular expression: /, '') : String(error);
    throw new PatternError(message);
  }
}

/** Whether `re` matches `text`, trying at most MAX_SUBJECT_LENGTH characters of it. */
export function matches(re: RegExp, text: string): boolean {
  re.lastIndex = 0;
  return re.test(text.length > MAX_SUBJECT_LENGTH ? text.slice(0, MAX_SUBJECT_LENGTH) : text);
}

/** Throws PatternError when a command is about to search more than MAX_INPUT_LENGTH characters. */
export function checkInputLength(length: number): void {
  if (length > MAX_INPUT_LENGTH) throw new PatternError(`input too large to search (more than ${MAX_INPUT_LENGTH} characters)`);
}
