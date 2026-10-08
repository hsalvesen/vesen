// The one way a pattern typed by the visitor becomes a JavaScript RegExp (grep, sed, expr, and
// later find -regex). A JavaScript regular expression cannot be interrupted: one pattern that
// backtracks for ever, such as (a+)+$ against a long line of a's, would freeze the page. So every
// such pattern passes through guardRegex, which
//
//   - caps the pattern's length (MAX_PATTERN);
//   - refuses what is plainly catastrophic: a repeated group with a repetition inside it,
//     (a+)+ or (\w*\s?)*, unless every count is small and bounded, as in ([0-9]{1,3}\.){3}, and
//     a repeated choice whose branches can match the same text, (a|aa)*;
//   - caps how long a line it may be run against (SafeRegex.limit), from how many open-ended
//     repetitions follow one another on its worst path (d) and how many ways its bounded choices
//     multiply (W: ? counts 2, {0,9} 10, an unrepeated choice whose branches overlap one per
//     branch): n characters can cost about W * n^(d+1)/(d+1)! steps, held under STEP_BUDGET, and
//     never more than MAX_SUBJECT characters (the input cap). A pattern that leaves too short a
//     line, such as .?.?.? ... or .{0,9}.{0,9} ... or (a|a)(a|a) ..., is refused.
//
// translatePosix turns GNU basic and extended regular expressions (grep, grep -E, sed, sed -E,
// expr) into JavaScript's syntax, with GNU's error messages for the mistakes it can see.

/** The longest pattern accepted, in characters. */
export const MAX_PATTERN = 8192;

/** The longest line (or pattern space) any pattern is run against: the input cap. */
export const MAX_SUBJECT = 1_000_000;

/** Roughly how many backtracking steps one match may take in the worst case. */
export const STEP_BUDGET = 1e8;

/** A pattern whose safe line length would be shorter than this is refused outright. */
const MIN_LIMIT = 32;

/** A repetition with no upper bound, or one above this, counts as open-ended. */
const OPEN_REPEAT = 16;

/**
 * The most ways a bounded repetition of a group with counts inside it may split its text, as in
 * ([0-9]{1,3}\.){3} (27 ways); more, as in (a{1,9}){9}, is refused like (a+)+.
 */
const NESTED_WAYS = 10_000;

/** A pattern that is not valid; the message is GNU's, such as "Unmatched ( or \\(". */
export class RegexSyntaxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegexSyntaxError';
  }
}

/** A pattern the guard will not run, because it could take for ever. */
export class RegexRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegexRefused';
  }
}

/** A line longer than the pattern may safely be run against. */
export class SubjectTooLong extends Error {
  constructor(
    readonly length: number,
    readonly limit: number,
  ) {
    super(`line too long for this pattern (${length} characters, at most ${limit}); try a simpler pattern`);
    this.name = 'SubjectTooLong';
  }
}

export interface SafeRegex {
  /** The compiled expression, with the flags asked for. */
  readonly regex: RegExp;
  /** The longest subject it may be run against. */
  readonly limit: number;
  /** How many capturing groups it has. */
  readonly groups: number;
  /** Throws SubjectTooLong when `subject` is longer than `limit`. */
  check(subject: string): void;
}

// ── The guard ──────────────────────────────────────────────────────────────────────────────

/** What a part of a pattern can start with: some characters, or anything. */
type First = { readonly any: true } | { readonly any: false; readonly chars: ReadonlySet<string> };

const ANY: First = { any: true };
const NONE: First = { any: false, chars: new Set() };

interface Info {
  /** Contains a quantifier of any kind. */
  readonly quantified: boolean;
  /** Can match the empty string. */
  readonly nullable: boolean;
  /** What a match can start with. */
  readonly first: First;
  /** The exact text it matches, when it is plain literal characters. */
  readonly literal: string | null;
  /** A group's branches, when it has more than one. */
  readonly branches?: readonly Info[];
  /** A group (as opposed to one character, a class or an escape). */
  readonly group?: boolean;
  /** How many ways its counts can divide a text between them: 1 with none, Infinity when open-ended. */
  readonly ways: number;
  /**
   * The most open-ended repetitions one path through it meets: added up along a sequence, the
   * largest of a choice's branches (one branch is tried after another, not inside it).
   */
  readonly degree: number;
  /**
   * How many ways its bounded choices can multiply, at most: ? counts 2, {0,9} 10, and a choice
   * whose branches could both start at the same place adds its branches up (otherwise only one
   * of them gets past its first character, and it counts as its largest).
   */
  readonly weight: number;
}

interface Scan {
  readonly src: string;
  i: number;
  readonly fold: boolean;
  /** The places a match must choose at: bounded counts such as ? and {0,9}, and overlapping choices. */
  choices: number;
}

function union(a: First, b: First): First {
  if (a.any || b.any) return ANY;
  return { any: false, chars: new Set([...a.chars, ...b.chars]) };
}

function overlaps(a: First, b: First): boolean {
  if (a.any || b.any) return true;
  for (const c of a.chars) if (b.chars.has(c)) return true;
  return false;
}

function charFirst(c: string, fold: boolean): First {
  return { any: false, chars: new Set(fold ? [c.toLowerCase(), c.toUpperCase()] : [c]) };
}

/** True when no word in `words` begins another, which makes a repeated choice of them unambiguous. */
function prefixFree(words: readonly string[]): boolean {
  for (let a = 0; a < words.length; a += 1) {
    for (let b = 0; b < words.length; b += 1) {
      const x = words[a] ?? '';
      const y = words[b] ?? '';
      if (a !== b && (x === '' || y.startsWith(x))) return false;
    }
  }
  return true;
}

const NESTED = 'a repeated group with a repetition inside it, as in (a+)+, can take forever to match';
const AMBIGUOUS = 'a repeated choice whose branches can match the same text, as in (a|aa)*, can take forever to match';

const OPAQUE: Info = { quantified: false, nullable: false, first: ANY, literal: null, ways: 1, degree: 0, weight: 1 };
const EMPTY: Info = { quantified: false, nullable: true, first: NONE, literal: '', ways: 1, degree: 0, weight: 1 };

/** Reads `\…` at s.i (the backslash). */
function readEscape(s: Scan): Info {
  const c = s.src.charAt(s.i + 1);
  s.i += 2;
  if ((c === 'u' || c === 'p' || c === 'P') && s.src.charAt(s.i) === '{') {
    const end = s.src.indexOf('}', s.i);
    s.i = end === -1 ? s.src.length : end + 1;
    return OPAQUE;
  }
  if (c === 'x') s.i += 2;
  else if (c === 'u') s.i += 4;
  else if (c === 'c') s.i += 1;
  if (c === 'x' || c === 'u' || c === 'c' || /[dDwWsSfnrtv0]/.test(c)) return OPAQUE;
  if (c === 'b' || c === 'B') return EMPTY;
  if (/[1-9]/.test(c)) {
    while (/\d/.test(s.src.charAt(s.i))) s.i += 1;
    return OPAQUE;
  }
  // An escaped punctuation character stands for itself.
  return { ...OPAQUE, first: charFirst(c, s.fold), literal: c };
}

/** Skips a character class at s.i (the `[`). */
function skipClass(s: Scan): void {
  s.i += 1;
  if (s.src.charAt(s.i) === '^') s.i += 1;
  while (s.i < s.src.length && s.src.charAt(s.i) !== ']') s.i += s.src.charAt(s.i) === '\\' ? 2 : 1;
  s.i += 1;
}

/** Reads a quantifier at s.i, if there is one: its bounds. */
function readQuantifier(s: Scan): { min: number; max: number } | null {
  const c = s.src.charAt(s.i);
  let bounds: { min: number; max: number } | null = null;
  if (c === '*') bounds = { min: 0, max: Infinity };
  else if (c === '+') bounds = { min: 1, max: Infinity };
  else if (c === '?') bounds = { min: 0, max: 1 };
  if (bounds !== null) {
    s.i += 1;
  } else if (c === '{') {
    const match = /^\{(\d+)(,(\d*))?\}/.exec(s.src.slice(s.i));
    if (match === null) return null;
    const min = Number(match[1]);
    const max = match[2] === undefined ? min : match[3] === '' ? Infinity : Number(match[3]);
    bounds = { min, max };
    s.i += match[0].length;
  } else {
    return null;
  }
  // A lazy quantifier backtracks just as much.
  if (s.src.charAt(s.i) === '?') s.i += 1;
  return bounds;
}

/**
 * True when two branches of a choice could both match at the same place, so a failure later on
 * tries each: one can match nothing, or two can start with the same character (plain words that
 * do not begin one another excepted, as in (foo|far)).
 */
function overlapping(s: Scan, branches: readonly Info[]): boolean {
  if (branches.some((b) => b.nullable)) return true;
  const words = branches.map((b) => b.literal);
  if (words.every((w): w is string => w !== null)) return !prefixFree(s.fold ? words.map((w) => w.toLowerCase()) : words);
  for (let a = 0; a < branches.length; a += 1) {
    for (let b = a + 1; b < branches.length; b += 1) {
      if (overlaps((branches[a] as Info).first, (branches[b] as Info).first)) return true;
    }
  }
  return false;
}

/** Reads alternatives until `)` or the end; s.i is left on the `)`. */
function readAlternatives(s: Scan): Info {
  const branches: Info[] = [readSequence(s)];
  while (s.src.charAt(s.i) === '|') {
    s.i += 1;
    branches.push(readSequence(s));
  }
  if (branches.length === 1) return branches[0] as Info;
  const weights = branches.map((b) => b.weight);
  const ambiguous = overlapping(s, branches);
  if (ambiguous) s.choices += 1;
  return {
    quantified: branches.some((b) => b.quantified),
    nullable: branches.some((b) => b.nullable),
    first: branches.reduce<First>((all, b) => union(all, b.first), NONE),
    literal: null,
    branches,
    ways: branches.reduce((sum, b) => sum + b.ways, 0),
    degree: Math.max(...branches.map((b) => b.degree)),
    weight: ambiguous ? weights.reduce((sum, w) => sum + w, 0) : Math.max(...weights),
  };
}

/** How many ways `atom` repeated between `min` and `max` times can divide a text, at most. */
function repeatWays(atom: Info, quant: { readonly min: number; readonly max: number }): number {
  if (quant.max > OPEN_REPEAT) return Infinity;
  return (quant.max - quant.min + 1) * atom.ways ** quant.max;
}

/** Refuses a repetition (max > 1) of `atom` that could backtrack for ever. */
function checkRepeat(s: Scan, atom: Info, quant: { readonly min: number; readonly max: number }): void {
  if (atom.quantified && !(repeatWays(atom, quant) <= NESTED_WAYS)) throw new RegexRefused(NESTED);
  const branches = atom.branches;
  if (branches !== undefined) {
    if (overlapping(s, branches)) throw new RegexRefused(AMBIGUOUS);
    return;
  }
  // A repeated group that can match nothing but is not simply empty, such as (\b.?)*.
  if (atom.group === true && atom.nullable && atom.literal !== '') throw new RegexRefused(NESTED);
}

/** Reads one sequence of quantified atoms, until `|`, `)` or the end. */
function readSequence(s: Scan): Info {
  let quantified = false;
  let nullable = true;
  let first: First = NONE;
  let text: string | null = '';
  let ways = 1;
  let degree = 0;
  let weight = 1;
  while (s.i < s.src.length) {
    const c = s.src.charAt(s.i);
    if (c === '|' || c === ')') break;
    let atom: Info;
    if (c === '(') {
      s.i += 1;
      let lookaround = false;
      const head = /^\?(?::|=|!|<=|<!|<[A-Za-z_$][\w$]*>)/.exec(s.src.slice(s.i));
      if (head !== null) {
        lookaround = head[0] === '?=' || head[0] === '?!' || head[0] === '?<=' || head[0] === '?<!';
        s.i += head[0].length;
      }
      const inner = readAlternatives(s);
      s.i += 1;
      atom = lookaround
        ? { ...EMPTY, quantified: inner.quantified, literal: null, ways: inner.ways, degree: inner.degree, weight: inner.weight }
        : { ...inner, group: true };
    } else if (c === '[') {
      skipClass(s);
      atom = OPAQUE;
    } else if (c === '\\') {
      atom = readEscape(s);
    } else if (c === '^' || c === '$') {
      s.i += 1;
      atom = EMPTY;
    } else if (c === '.') {
      s.i += 1;
      atom = OPAQUE;
    } else {
      const ch = String.fromCodePoint(s.src.codePointAt(s.i) ?? 0);
      s.i += ch.length;
      atom = { ...OPAQUE, first: charFirst(ch, s.fold), literal: ch };
    }
    const quant = readQuantifier(s);
    if (quant !== null) {
      if (quant.max > 1) checkRepeat(s, atom, quant);
      // An exact count, such as [0-9]{20}, leaves nothing to choose however large it is.
      const open = quant.max > OPEN_REPEAT && quant.min !== quant.max;
      if (!open && quant.max > quant.min) s.choices += 1;
      atom = {
        quantified: true,
        nullable: atom.nullable || quant.min === 0,
        first: atom.first,
        literal: null,
        ways: repeatWays(atom, quant),
        degree: open ? atom.degree + 1 : atom.degree,
        weight: open ? atom.weight : (quant.max - quant.min + 1) * atom.weight ** quant.max,
      };
    }
    // The sequence starts with what its leading nullable parts and first solid part start with.
    if (nullable) first = union(first, atom.first);
    nullable = nullable && atom.nullable;
    quantified = quantified || atom.quantified;
    text = text !== null && atom.literal !== null ? text + atom.literal : null;
    ways *= atom.ways;
    degree += atom.degree;
    weight *= atom.weight;
  }
  return { quantified, nullable, first, literal: text, ways, degree, weight };
}

function factorial(n: number): number {
  let f = 1;
  for (let k = 2; k <= n; k += 1) f *= k;
  return f;
}

/**
 * The longest subject a pattern may be run against, with `open` open-ended repetitions on its
 * worst path and bounded choices that cost `weight` steps at each place: the n with
 * W * n^(d+1)/(d+1)! steps within STEP_BUDGET.
 */
export function subjectLimit(open: number, weight = 1): number {
  const n = Math.floor(((STEP_BUDGET * factorial(open + 1)) / weight) ** (1 / (open + 1)));
  return Math.min(MAX_SUBJECT, n);
}

/**
 * Checks a JavaScript pattern and compiles it. Throws RegexRefused for one that could take for
 * ever or is too long, and RegexSyntaxError for one JavaScript cannot read.
 */
export function guardRegex(source: string, flags = ''): SafeRegex {
  if (source.length > MAX_PATTERN) throw new RegexRefused(`pattern too long (${source.length} characters, at most ${MAX_PATTERN})`);
  const scan: Scan = { src: source, i: 0, fold: flags.includes('i'), choices: 0 };
  const info = readAlternatives(scan);
  let { degree, weight } = info;
  while (scan.i < source.length) {
    // A stray `)`: carry on so the rest is checked too; RegExp reports it below.
    scan.i += 1;
    const more = readAlternatives(scan);
    degree += more.degree;
    weight *= more.weight;
  }
  // Each way through the choices is walked choice by choice, so the ways cost that many steps.
  const limit = subjectLimit(degree, weight * Math.max(1, scan.choices));
  if (limit < MIN_LIMIT) {
    throw new RegexRefused(
      subjectLimit(degree) < MIN_LIMIT
        ? 'too many open-ended repetitions such as * and +; simplify the pattern'
        : 'too many optional parts, counts such as {0,9} or overlapping choices; simplify the pattern',
    );
  }
  let regex: RegExp;
  try {
    regex = new RegExp(source, flags);
  } catch (error) {
    throw new RegexSyntaxError(error instanceof Error ? error.message : String(error));
  }
  // The pattern or nothing matches the empty string at once, with every group in the result.
  const groups = (new RegExp(`${source}|`, flags.replace(/[gy]/g, '')).exec('')?.length ?? 1) - 1;
  return {
    regex,
    limit,
    groups,
    check(subject) {
      if (subject.length > limit) throw new SubjectTooLong(subject.length, limit);
    },
  };
}

// ── POSIX to JavaScript ────────────────────────────────────────────────────────────────────

export type PosixSyntax = 'basic' | 'extended';

export interface TranslateOptions {
  /** Added to backreference numbers, when several patterns are joined into one. */
  readonly groupOffset?: number;
  /** sed's extras: \n, \t and the other escapes for control characters. */
  readonly sed?: boolean;
}

export interface Translated {
  /** The pattern in JavaScript's syntax, for the `u` flag. */
  readonly source: string;
  /** How many capturing groups it has. */
  readonly groups: number;
}

/** Characters with a meaning in a JavaScript pattern outside a class. */
const JS_SPECIAL = new Set(Array.from('\\^$.|?*+()[]{}/'));

function literal(c: string): string {
  return JS_SPECIAL.has(c) ? `\\${c}` : c;
}

/** A character inside a JavaScript class. */
function classLiteral(c: string): string {
  return c === '\\' || c === ']' || c === '[' || c === '^' || c === '-' ? `\\${c}` : c;
}

const PUNCT = '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~';

/** The POSIX character classes, as the inside of a JavaScript class (with the `u` flag). */
export const POSIX_CLASSES: Readonly<Record<string, string>> = {
  alpha: '\\p{L}',
  digit: '0-9',
  alnum: '\\p{L}\\p{Nd}',
  upper: '\\p{Lu}',
  lower: '\\p{Ll}',
  space: ' \\t\\n\\v\\f\\r',
  blank: ' \\t',
  punct: Array.from(PUNCT).map(classLiteral).join(''),
  print: '\\x20-\\x7e\\u00a0-\\uffff',
  graph: '\\x21-\\x7e\\u00a1-\\uffff',
  cntrl: '\\x00-\\x1f\\x7f',
  xdigit: '0-9A-Fa-f',
};

const UNMATCHED_BRACKET = 'Unmatched [, [^, [:, [., or [=';

/** Reads `[=c=]` or `[.c.]` at `i`: the one character it names, and where it ends. */
function namedChar(p: string, i: number): { ch: string; next: number } {
  const kind = p.charAt(i + 1);
  const end = p.indexOf(`${kind}]`, i + 2);
  if (end === -1) throw new RegexSyntaxError(UNMATCHED_BRACKET);
  const name = p.slice(i + 2, end);
  if (Array.from(name).length !== 1) throw new RegexSyntaxError('Invalid collation character');
  return { ch: name, next: end + 2 };
}

/** Reads a bracket expression at `start` (just after `[`); returns the JS class and where it ends. */
function bracket(p: string, start: number): { cls: string; next: number } {
  let i = start;
  let negate = false;
  if (p.charAt(i) === '^') {
    negate = true;
    i += 1;
  }
  let items = '';
  let first = true;
  let prev: string | null = null;
  for (;;) {
    if (i >= p.length) throw new RegexSyntaxError(UNMATCHED_BRACKET);
    const c = p.charAt(i);
    if (c === ']' && !first) {
      i += 1;
      break;
    }
    first = false;
    if (c === '[' && p.charAt(i + 1) === ':') {
      const end = p.indexOf(':]', i + 2);
      if (end === -1) throw new RegexSyntaxError(UNMATCHED_BRACKET);
      const cls = POSIX_CLASSES[p.slice(i + 2, end)];
      if (cls === undefined) throw new RegexSyntaxError('Invalid character class name');
      items += cls;
      prev = null;
      i = end + 2;
      continue;
    }
    let ch: string;
    if (c === '[' && (p.charAt(i + 1) === '=' || p.charAt(i + 1) === '.')) {
      const named = namedChar(p, i);
      ch = named.ch;
      i = named.next;
    } else {
      ch = String.fromCodePoint(p.codePointAt(i) ?? 0);
      i += ch.length;
    }
    // A range: the character before, a dash, then one that is not the closing bracket.
    if (ch === '-' && prev !== null && i < p.length && p.charAt(i) !== ']') {
      let end: string;
      if (p.charAt(i) === '[' && (p.charAt(i + 1) === '=' || p.charAt(i + 1) === '.')) {
        const named = namedChar(p, i);
        end = named.ch;
        i = named.next;
      } else {
        end = String.fromCodePoint(p.codePointAt(i) ?? 0);
        i += end.length;
      }
      if ((end.codePointAt(0) ?? 0) < (prev.codePointAt(0) ?? 0)) throw new RegexSyntaxError('Invalid range end');
      items += `-${classLiteral(end)}`;
      prev = null;
      continue;
    }
    items += classLiteral(ch);
    prev = ch;
  }
  return { cls: `[${negate ? '^' : ''}${items}]`, next: i };
}

const SED_ESCAPES: Readonly<Record<string, string>> = { n: '\\n', t: '\\t', r: '\\r', f: '\\f', v: '\\v', a: '\\x07' };

/**
 * Turns a GNU basic or extended regular expression into JavaScript's syntax (for the `u` flag):
 * \( \) \{ \} \| \+ \? in basic, their bare forms in extended; bracket expressions with the POSIX
 * classes; \< \> \b \B \w \W \s \S; backreferences \1 to \9. Throws RegexSyntaxError in GNU's
 * words.
 */
export function translatePosix(pattern: string, syntax: PosixSyntax, options: TranslateOptions = {}): Translated {
  const ere = syntax === 'extended';
  const offset = options.groupOffset ?? 0;
  let out = '';
  let groups = 0;
  /** The groups still open: their numbers, and where each starts in `out`. */
  const open: { n: number; at: number }[] = [];
  const closed = new Set<number>();
  /** Nothing to repeat yet: the start, or just after ( or | or a leading ^. */
  let atStart = true;
  /** Where the last atom starts in `out` (-1 for none), and whether it is already repeated. */
  let atomAt = -1;
  let quantified = false;
  /** The last atom was a backreference, so a digit after it needs a separator. */
  let afterBackref = false;

  const atom = (text: string): void => {
    if (afterBackref && /^\d/.test(text)) out += '(?:)';
    afterBackref = false;
    atomAt = out.length;
    out += text;
    quantified = false;
    atStart = false;
  };
  const anchor = (text: string): void => {
    out += text;
    afterBackref = false;
  };
  const openGroup = (): void => {
    open.push({ n: ++groups, at: out.length });
    out += '(';
    afterBackref = false;
    atStart = true;
    atomAt = -1;
  };
  const closeGroup = (): boolean => {
    const group = open.pop();
    if (group === undefined) return false;
    closed.add(group.n);
    out += ')';
    afterBackref = false;
    atomAt = group.at;
    quantified = false;
    atStart = false;
    return true;
  };
  const alternate = (): void => {
    out += '|';
    afterBackref = false;
    atStart = true;
    atomAt = -1;
  };
  const quantify = (q: string): void => {
    afterBackref = false;
    if (quantified) {
      // POSIX allows a** and a+?; JavaScript reads a second quantifier differently or not at
      // all. The simple pairs merge: two pluses or two question marks stay, anything else is *.
      const last = out.charAt(out.length - 1);
      if ((q === '*' || q === '+' || q === '?') && (last === '*' || last === '+' || last === '?')) {
        out = out.slice(0, -1) + (last === q ? q : '*');
        return;
      }
      out = `${out.slice(0, atomAt)}(?:${out.slice(atomAt)})`;
    }
    out += q;
    quantified = true;
  };
  const interval = (body: string): void => {
    const match = /^(\d*)(,(\d*))?$/.exec(body);
    if (match === null || (match[1] === '' && match[2] === undefined)) throw new RegexSyntaxError('Invalid content of \\{\\}');
    const min = match[1] === '' ? 0 : Number(match[1]);
    const max = match[2] === undefined ? min : match[3] === '' ? Infinity : Number(match[3]);
    if (max < min) throw new RegexSyntaxError('Invalid content of \\{\\}');
    if (min > 32767 || (max !== Infinity && max > 32767)) throw new RegexSyntaxError('Regular expression too big');
    quantify(max === Infinity ? `{${min},}` : max === min ? `{${min}}` : `{${min},${max}}`);
  };
  const nothingToRepeat = (): boolean => atStart || atomAt === -1;

  let i = 0;
  while (i < pattern.length) {
    const c = pattern.charAt(i);
    if (c === '\\') {
      if (i + 1 >= pattern.length) throw new RegexSyntaxError('Trailing backslash');
      const d = pattern.charAt(i + 1);
      i += 2;
      if (!ere && d === '(') {
        openGroup();
      } else if (!ere && d === ')') {
        if (!closeGroup()) throw new RegexSyntaxError('Unmatched ) or \\)');
      } else if (!ere && d === '|') {
        alternate();
      } else if (!ere && d === '{') {
        const end = pattern.indexOf('\\}', i);
        if (end === -1) throw new RegexSyntaxError('Unmatched \\{');
        if (nothingToRepeat()) {
          atom('\\{');
          continue;
        }
        interval(pattern.slice(i, end));
        i = end + 2;
      } else if (!ere && (d === '+' || d === '?')) {
        if (nothingToRepeat()) atom(literal(d));
        else quantify(d);
      } else if (/[1-9]/.test(d)) {
        const n = Number(d);
        if (!closed.has(n)) throw new RegexSyntaxError('Invalid back reference');
        atom(`\\${n + offset}`);
        afterBackref = true;
      } else if (d === '<') {
        anchor('\\b(?=\\w)');
      } else if (d === '>') {
        anchor('\\b(?!\\w)');
      } else if (d === 'b' || d === 'B') {
        anchor(`\\${d}`);
      } else if (d === '`') {
        anchor('^');
      } else if (d === "'") {
        anchor('$');
      } else if (d === 'w' || d === 'W' || d === 's' || d === 'S') {
        atom(`\\${d}`);
      } else if (options.sed && SED_ESCAPES[d] !== undefined) {
        atom(SED_ESCAPES[d] ?? '');
      } else {
        const ch = String.fromCodePoint(pattern.codePointAt(i - 1) ?? 0);
        i += ch.length - 1;
        atom(literal(ch));
      }
      continue;
    }
    if (c === '[') {
      // [:space:] alone is a mistake GNU names: the outer brackets are missing.
      if (/^\[:[a-z]+:\]/.test(pattern.slice(i))) throw new RegexSyntaxError('character class syntax is [[:space:]], not [:space:]');
      const read = bracket(pattern, i + 1);
      i = read.next;
      atom(read.cls);
      continue;
    }
    i += 1;
    if (c === '*') {
      if (nothingToRepeat()) atom('\\*');
      else quantify('*');
    } else if (c === '.') {
      atom('.');
    } else if (c === '^') {
      if (ere || atStart) {
        anchor('^');
        atStart = true;
        atomAt = -1;
      } else {
        atom('\\^');
      }
    } else if (c === '$') {
      const rest = pattern.slice(i);
      if (ere || rest === '' || rest.startsWith('\\)') || rest.startsWith('\\|')) anchor('$');
      else atom('\\$');
    } else if (ere && c === '(') {
      openGroup();
    } else if (ere && c === ')') {
      if (!closeGroup()) atom('\\)');
    } else if (ere && c === '|') {
      alternate();
    } else if (ere && (c === '+' || c === '?')) {
      if (nothingToRepeat()) atom(literal(c));
      else quantify(c);
    } else if (ere && c === '{') {
      const end = pattern.indexOf('}', i);
      const body = end === -1 ? '' : pattern.slice(i, end);
      if (!/^\d*(,\d*)?$/.test(body) || body === '' || body === ',' || nothingToRepeat()) {
        atom('\\{');
        continue;
      }
      interval(body);
      i = end + 1;
    } else {
      const ch = String.fromCodePoint(pattern.codePointAt(i - 1) ?? 0);
      i += ch.length - 1;
      atom(literal(ch));
    }
  }
  if (open.length > 0) throw new RegexSyntaxError('Unmatched ( or \\(');
  return { source: out, groups };
}

/** Escapes text so a JavaScript pattern matches it exactly (grep -F). */
export function escapeLiteral(text: string): string {
  return Array.from(text).map(literal).join('');
}

/** True for a letter, digit or underscore: what grep -w and \< \> call a word character. */
export function isWordChar(c: string | undefined): boolean {
  return c !== undefined && c !== '' && /[\p{L}\p{N}_]/u.test(c);
}

/** The message for a pattern that cannot be used, for "name: message"; null for anything else. */
export function patternMessage(error: unknown): string | null {
  if (error instanceof RegexSyntaxError || error instanceof RegexRefused || error instanceof SubjectTooLong) return error.message;
  return null;
}

export interface PatternOptions {
  /** GNU basic or extended, fixed strings, or `perl`: JavaScript's own syntax, as it is (grep -P). */
  readonly syntax: PosixSyntax | 'fixed' | 'perl';
  readonly ignoreCase?: boolean;
  /** For sed: \n and the other control escapes, and `.` matching a newline. */
  readonly sed?: boolean;
  /** Extra flags, such as `g`. */
  readonly flags?: string;
  /** Matches only at the start (expr's STRING : REGEXP). */
  readonly start?: boolean;
  /** Matches only whole lines (grep -x). */
  readonly line?: boolean;
  /** A match may not end inside a word (grep -w; the caller checks its start). */
  readonly word?: boolean;
}

/**
 * Several patterns (grep -e A -e B, or lines of one) as one guarded expression: each is
 * translated on its own, with its backreferences renumbered, and they are joined as choices.
 */
export function compilePatterns(patterns: readonly string[], options: PatternOptions): SafeRegex {
  const total = patterns.reduce((sum, p) => sum + p.length, 0);
  if (total > MAX_PATTERN) throw new RegexRefused(`pattern too long (${total} characters, at most ${MAX_PATTERN})`);
  let groups = 0;
  if (options.syntax === 'perl' && patterns.length > 1) throw new RegexSyntaxError('the -P option only supports a single pattern');
  const parts = patterns.map((pattern) => {
    if (options.syntax === 'fixed') return escapeLiteral(pattern);
    if (options.syntax === 'perl') return pattern;
    const translated = translatePosix(pattern, options.syntax, { groupOffset: groups, ...(options.sed ? { sed: true } : {}) });
    groups += translated.groups;
    return translated.source;
  });
  let source = parts.length === 1 ? (parts[0] ?? '') : parts.map((part) => `(?:${part})`).join('|');
  if (options.line) source = `^(?:${source})$`;
  else if (options.start) source = `^(?:${source})`;
  else if (options.word) source = `(?:${source})(?![\\p{L}\\p{N}_])`;
  const flags = `u${options.ignoreCase ? 'i' : ''}${options.sed ? 's' : ''}${options.flags ?? ''}`;
  return guardRegex(source, flags);
}
