// Word expansion, in bash's order: braces, then tilde, parameters, command substitution and
// arithmetic (left to right), then field splitting of unquoted expansions on IFS, then pathname
// expansion, then quote removal (the lexer has already separated quoted from unquoted text, so
// quote removal is simply joining the parts).
//
// Supported:
// - braces: a{b,c}d, nested {a,{b,c}}, and sequences {1..5} {01..10} {a..e} {1..10..2}, in
//   unquoted text only; '{}', a lone '{' and ${…} are left alone, as in bash
// - tilde: ~ ~/x ~user (through an injected lookup, for ~guest and ~has), ~+ ($PWD), ~- ($OLDPWD)
// - parameters: $X ${X} ${X:-word} ${X-word} ${X:=word} ${X:+word} ${#X}, and the specials
//   $? $$ $# $0 $1… $@ $* $RANDOM $PWD; other ${…} forms fail as unsupported or a bad substitution
// - command substitution $( ) and backticks through an injected executor
// - arithmetic $(( )) through ./arith.ts
// - globbing through an injected matcher (./glob.ts), skipped when none is given or noglob is set
//
// Everything that can fail throws ExpandError with bash's wording, without the `vesen: ` prefix.

import { ArithError, evaluateArith } from './arith';
import { escapeGlob, GlobTooLarge, hasGlob, type GlobMatcher } from './glob';
import type { WordPart } from './lexer-types';
import { lexText } from './lexer';

export class ExpandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExpandError';
  }
}

/** A redirection target that came out as more or fewer than one word; it fails only its command. */
export class AmbiguousRedirect extends ExpandError {
  constructor(raw: string) {
    super(`${raw}: ambiguous redirect`);
    this.name = 'AmbiguousRedirect';
  }
}

/** The most words one command's expansion (braces and globs) may produce. */
export const MAX_WORDS = 100_000;

/** What a command substitution produced. */
export interface SubstResult {
  readonly stdout: string;
  readonly status: number;
}

/** Shell variables: Env from ./types satisfies this. */
export interface ExpandVars {
  get(name: string): string | undefined;
  set(name: string, value: string): void;
}

export interface ExpandOptions {
  readonly vars: ExpandVars;
  /** `$?`. */
  readonly status: number;
  /** `$$`. */
  readonly pid: number;
  /** `$0`. */
  readonly argv0: string;
  /** `$1` onwards, `$#`, `$@` and `$*`. */
  readonly args: readonly string[];
  /** `~` when HOME is unset. */
  readonly home: string;
  /** `$PWD` and `~+` when PWD is unset. */
  readonly cwd: string;
  /** Home folders for `~user`; undefined leaves `~user` as typed. */
  readonly userHome?: (name: string) => string | undefined;
  /** A number in [0, 1), for $RANDOM. */
  readonly random?: () => number;
  /** Pathname expansion; without it, words are never globbed. */
  readonly glob?: GlobMatcher;
  /** `set -f`. */
  readonly noglob?: boolean;
  /** Runs the source of a $( ) or backtick substitution and returns what it wrote. */
  readonly exec?: (source: string) => Promise<SubstResult>;
}

/** The parts of a word, as the AST and the lexer's word tokens both have them. */
export interface Expandable {
  readonly parts: readonly WordPart[];
}

const DEFAULT_IFS = ' \t\n';
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SPECIAL = /^[?#$!@*0-]$/;
/** ${…} forms bash has and vesen does not: ${X/a/b}, ${X#p}, ${X%p}, ${X:?m}, ${X^}, ${!X} … */
const BASH_FORM = /^!?([A-Za-z_][A-Za-z0-9_]*|[0-9]+|[?#$!@*-])(\[[^\]]*\])?([:#%/^,@?=+].*)?$/s;

/** True for a parameter name the expander knows: a variable name, digits, or a special. */
export function isParamName(name: string): boolean {
  return NAME.test(name) || /^[0-9]+$/.test(name) || SPECIAL.test(name);
}

/** A run of text in a field; `active` text is unquoted, so glob characters in it are live. */
interface Chunk {
  readonly text: string;
  readonly active: boolean;
}

/** Builds the fields of one word, splitting unquoted expansions on IFS. */
class Fields {
  private readonly out: Chunk[][] = [];
  private current: Chunk[] = [];
  /** True once the current field exists, even if empty: `""` or `"$EMPTY"` make an empty field. */
  private exists = false;

  constructor(
    private readonly ifs: string,
    private readonly splitting: boolean,
  ) {}

  add(text: string, active: boolean): void {
    if (text === '') return;
    this.current.push({ text, active });
    this.exists = true;
  }

  /** Quoted text was here, so the field exists even when it is empty. */
  mark(): void {
    this.exists = true;
  }

  /** Ends the current field if it exists. */
  end(): void {
    if (this.exists) this.out.push(this.current);
    this.current = [];
    this.exists = false;
  }

  /** Ends the current field even if it is empty, as a non-blank IFS delimiter or "$@" does. */
  cut(): void {
    this.out.push(this.current);
    this.current = [];
    this.exists = false;
  }

  /** Adds the result of an unquoted expansion, splitting it on IFS. */
  split(text: string): void {
    if (!this.splitting || this.ifs === '') {
      this.add(text, true);
      return;
    }
    const ifs = this.ifs;
    const blank = (c: string): boolean => (c === ' ' || c === '\t' || c === '\n') && ifs.includes(c);
    const delimiter = (c: string): boolean => ifs.includes(c) && !blank(c);
    let piece = '';
    let i = 0;
    while (i < text.length) {
      const c = text.charAt(i);
      if (!blank(c) && !delimiter(c)) {
        piece += c;
        i += 1;
        continue;
      }
      this.add(piece, true);
      piece = '';
      // A run of IFS blanks, with at most one other IFS character in it, is one delimiter.
      let hard = false;
      while (i < text.length && blank(text.charAt(i))) i += 1;
      if (i < text.length && delimiter(text.charAt(i))) {
        hard = true;
        i += 1;
        while (i < text.length && blank(text.charAt(i))) i += 1;
      }
      if (hard) this.cut();
      else this.end();
    }
    this.add(piece, true);
  }

  finish(): Chunk[][] {
    this.end();
    return this.out;
  }
}

export class Expander {
  private lastSubstStatus: number | null = null;

  constructor(private readonly o: ExpandOptions) {}

  /** The status of the last command substitution, for a command that is only assignments. */
  get substStatus(): number | null {
    return this.lastSubstStatus;
  }

  /** Expands command words into fields: braces, then split, globbed, quotes removed. */
  async fields(words: readonly Expandable[]): Promise<string[]> {
    const result: string[] = [];
    for (const word of words) {
      for (const parts of expandBraces(word.parts)) {
        const fields = new Fields(this.ifs(), true);
        await this.parts(parts, fields, false);
        for (const chunks of fields.finish()) {
          for (const path of this.pathnames(chunks)) result.push(path);
        }
        if (result.length > MAX_WORDS) throw new ExpandError('argument list too long');
      }
    }
    return result;
  }

  /** Expands one word to one string with no splitting or globbing: assignments, here-strings. */
  async string(word: Expandable): Promise<string> {
    const fields = new Fields(this.ifs(), false);
    await this.parts(word.parts, fields, false);
    return fields
      .finish()
      .map((chunks) => chunks.map((c) => c.text).join(''))
      .join(' ');
  }

  /** Expands a redirection target, which must come out as exactly one word. */
  async target(word: Expandable & { readonly raw: string }): Promise<string> {
    const fields = await this.fields([word]);
    const only = fields[0];
    if (fields.length !== 1 || only === undefined) throw new AmbiguousRedirect(word.raw);
    return only;
  }

  private ifs(): string {
    return this.o.vars.get('IFS') ?? DEFAULT_IFS;
  }

  private async parts(parts: readonly WordPart[], fields: Fields, inArgument: boolean): Promise<void> {
    for (const part of parts) {
      switch (part.kind) {
        case 'lit':
          if (part.q !== 0) {
            fields.add(part.text, false);
            fields.mark();
          } else if (inArgument) {
            // Unquoted text in ${X:-a b} is the result of an expansion, so it is split.
            fields.split(part.text);
          } else {
            fields.add(part.text, true);
          }
          break;
        case 'tilde':
          fields.add(this.tilde(part.user), false);
          fields.mark();
          break;
        case 'param':
          await this.param(part, fields);
          break;
        case 'cmdsub':
          this.emit(await this.substitute(part.source), part.q, fields);
          break;
        case 'arith':
          this.emit(await this.arithmetic(part.expr), part.q, fields);
          break;
      }
    }
  }

  /** Adds an expansion's result: split when unquoted, one quoted run otherwise. */
  private emit(text: string, q: 0 | 2, fields: Fields): void {
    if (q === 0) {
      fields.split(text);
    } else {
      fields.add(text, false);
      fields.mark();
    }
  }

  private tilde(user: string | undefined): string {
    if (user === undefined) return this.o.vars.get('HOME') ?? this.o.home;
    if (user === '+') return this.o.vars.get('PWD') ?? this.o.cwd;
    if (user === '-') return this.o.vars.get('OLDPWD') ?? '~-';
    return this.o.userHome?.(user) ?? `~${user}`;
  }

  private async param(part: Extract<WordPart, { kind: 'param' }>, fields: Fields): Promise<void> {
    if (part.name === '@' && part.q === 2 && part.op === undefined) {
      // "$@" is one field per argument, and no field at all when there are none.
      this.o.args.forEach((arg, k) => {
        if (k > 0) fields.cut();
        fields.add(arg, false);
        fields.mark();
      });
      return;
    }
    const value = this.lookup(part);
    const unset = value === undefined;
    const empty = unset || value === '';
    const argument = async (): Promise<void> => {
      if (part.q === 2) fields.mark();
      await this.parts(part.arg ?? [], fields, part.q === 0);
    };
    switch (part.op) {
      case ':-':
        if (empty) await argument();
        else this.emit(value, part.q, fields);
        return;
      case '-':
        if (unset) await argument();
        else this.emit(value, part.q, fields);
        return;
      case ':+':
        if (!empty) await argument();
        else if (part.q === 2) fields.mark();
        return;
      case ':=': {
        if (!empty) {
          this.emit(value, part.q, fields);
          return;
        }
        const assigned = await this.string({ parts: part.arg ?? [] });
        this.assign(part.name, assigned);
        this.emit(assigned, part.q, fields);
        return;
      }
      default:
        this.emit(value ?? '', part.q, fields);
    }
  }

  /** The value of a parameter, or undefined when it is unset. */
  private lookup(part: Extract<WordPart, { kind: 'param' }>): string | undefined {
    const name = part.name;
    if (part.braced && name.length > 1 && name.charAt(0) === '#') {
      const inner = name.slice(1);
      if (!isParamName(inner) || part.op !== undefined) throw this.badSubstitution(name);
      if (inner === '@' || inner === '*') return String(this.o.args.length);
      return String(Array.from(this.get(inner) ?? '').length);
    }
    if (!isParamName(name)) throw this.badSubstitution(name);
    return this.get(name);
  }

  private badSubstitution(inner: string): ExpandError {
    const form = '${' + inner + '}';
    return new ExpandError(BASH_FORM.test(inner) ? `${form}: not supported in vesen` : `${form}: bad substitution`);
  }

  /** Reads a parameter by name: specials, positionals, then shell variables. */
  private get(name: string): string | undefined {
    switch (name) {
      case '?':
        return String(this.o.status);
      case '$':
        return String(this.o.pid);
      case '#':
        return String(this.o.args.length);
      case '@':
        return this.o.args.join(' ');
      case '*':
        return this.o.args.join(this.ifs().charAt(0));
      case '!':
      case '-':
        return undefined;
      case 'RANDOM':
        return String(Math.floor((this.o.random?.() ?? 0) * 32768) % 32768);
      case 'PWD':
        return this.o.vars.get('PWD') ?? this.o.cwd;
    }
    if (/^[0-9]+$/.test(name)) {
      const n = Number(name);
      return n === 0 ? this.o.argv0 : this.o.args[n - 1];
    }
    return this.o.vars.get(name);
  }

  private assign(name: string, value: string): void {
    if (!NAME.test(name)) throw new ExpandError(`$${name}: cannot assign in this way`);
    this.o.vars.set(name, value);
  }

  private async substitute(source: string): Promise<string> {
    if (this.o.exec === undefined) throw new ExpandError('command substitution is not available here');
    const result = await this.o.exec(source);
    this.lastSubstStatus = result.status;
    return result.stdout.replace(/\n+$/, '');
  }

  private async arithmetic(expr: string): Promise<string> {
    const text = await this.string({ parts: lexText(expr) });
    try {
      return evaluateArith(text, { get: (name) => this.get(name), set: (name, value) => this.assign(name, value) }).toString();
    } catch (error) {
      if (error instanceof ArithError) throw new ExpandError(error.message);
      throw error;
    }
  }

  /** Globs one field; a field that matches nothing stays as it is. */
  private pathnames(chunks: readonly Chunk[]): string[] {
    const text = chunks.map((c) => c.text).join('');
    const matcher = this.o.glob;
    if (matcher === undefined || this.o.noglob === true) return [text];
    const pattern = chunks.map((c) => (c.active ? c.text : escapeGlob(c.text))).join('');
    if (!hasGlob(pattern)) return [text];
    let matches: readonly string[];
    try {
      matches = matcher(pattern);
    } catch (error) {
      if (error instanceof GlobTooLarge) throw new ExpandError('argument list too long');
      throw error;
    }
    return matches.length > 0 ? [...matches] : [text];
  }
}

// ── Braces ─────────────────────────────────────────────────────────────────────────────────

/** One unquoted character, or a part brace expansion leaves whole (quoted text, $X, $( )). */
type BraceAtom = { readonly c: string } | { readonly part: WordPart };

/** The most words one brace expression may make; {1..1000000} is refused rather than built. */
export const MAX_BRACE_WORDS = 10_000;

const isChar = (atom: BraceAtom | undefined, c: string): boolean => atom !== undefined && 'c' in atom && atom.c === c;

/** The text of atoms that are all unquoted characters, or null. */
function plainText(atoms: readonly BraceAtom[]): string | null {
  let text = '';
  for (const atom of atoms) {
    if (!('c' in atom)) return null;
    text += atom.c;
  }
  return text;
}

const chars = (text: string): BraceAtom[] => Array.from(text, (c) => ({ c }));

/** The words of a sequence expression {x..y[..step]}, or null when the text is not one. */
function sequence(inner: readonly BraceAtom[]): string[] | null {
  const text = plainText(inner);
  if (text === null) return null;
  const numeric = /^([+-]?\d+)\.\.([+-]?\d+)(?:\.\.([+-]?\d+))?$/.exec(text);
  const letters = /^([A-Za-z])\.\.([A-Za-z])(?:\.\.([+-]?\d+))?$/.exec(text);
  const match = numeric ?? letters;
  if (match === null) return null;
  const [, a = '', b = '', stepText] = match;
  const step = Math.abs(stepText === undefined ? 1 : Number(stepText)) || 1;
  const from = numeric ? Number(a) : a.charCodeAt(0);
  const to = numeric ? Number(b) : b.charCodeAt(0);
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to)) return null;
  const count = Math.floor(Math.abs(to - from) / step) + 1;
  if (count > MAX_BRACE_WORDS) throw new ExpandError(`{${text}}: brace expansion makes too many words`);
  // {01..10} pads to the wider end, as bash does when either end has a leading zero.
  const padded = numeric !== null && (/^[+-]?0\d/.test(a) || /^[+-]?0\d/.test(b));
  const width = padded ? Math.max(a.replace(/^[+-]/, '').length, b.replace(/^[+-]/, '').length) : 0;
  const words: string[] = [];
  const direction = to >= from ? 1 : -1;
  for (let k = 0, n = from; k < count; k += 1, n += direction * step) {
    if (!numeric) words.push(String.fromCharCode(n));
    else words.push(n < 0 ? `-${String(-n).padStart(width, '0')}` : String(n).padStart(width, '0'));
  }
  return words;
}

/** Brace expansion over atoms: the first brace expression, then whatever follows it, recursively. */
function braceAtoms(atoms: readonly BraceAtom[], budget: { left: number; expanded: boolean }): BraceAtom[][] {
  for (let i = 0; i < atoms.length; i += 1) {
    if (!isChar(atoms[i], '{')) continue;
    // `${` never reaches here (the lexer reads it as a parameter); a quoted brace is a part.
    let depth = 0;
    let close = -1;
    const commas: number[] = [];
    for (let j = i + 1; j < atoms.length; j += 1) {
      if (isChar(atoms[j], '{')) depth += 1;
      else if (isChar(atoms[j], '}')) {
        if (depth === 0) {
          close = j;
          break;
        }
        depth -= 1;
      } else if (isChar(atoms[j], ',') && depth === 0) commas.push(j);
    }
    if (close === -1) continue;
    let alternatives: BraceAtom[][];
    if (commas.length > 0) {
      alternatives = [];
      let from = i + 1;
      for (const comma of [...commas, close]) {
        alternatives.push(atoms.slice(from, comma));
        from = comma + 1;
      }
    } else {
      const words = sequence(atoms.slice(i + 1, close));
      if (words === null) continue;
      alternatives = words.map(chars);
    }
    budget.expanded = true;
    const before = atoms.slice(0, i);
    const after = braceAtoms(atoms.slice(close + 1), budget);
    const results: BraceAtom[][] = [];
    for (const alternative of alternatives) {
      for (const middle of braceAtoms(alternative, budget)) {
        for (const rest of after) {
          budget.left -= 1;
          if (budget.left < 0) throw new ExpandError('brace expansion makes too many words');
          results.push([...before, ...middle, ...rest]);
        }
      }
    }
    return results;
  }
  return [atoms.slice()];
}

/**
 * Brace expansion of one word's parts: one list of parts per word it makes, in order. Only
 * unquoted literal text takes part; everything else is carried along whole.
 */
export function expandBraces(parts: readonly WordPart[]): (readonly WordPart[])[] {
  if (!parts.some((part) => part.kind === 'lit' && part.q === 0 && part.text.includes('{'))) return [parts];
  const atoms: BraceAtom[] = [];
  for (const part of parts) {
    if (part.kind === 'lit' && part.q === 0) atoms.push(...chars(part.text));
    else atoms.push({ part });
  }
  const budget = { left: MAX_BRACE_WORDS, expanded: false };
  const words = braceAtoms(atoms, budget);
  if (!budget.expanded) return [parts];
  return words.map((word) => {
    const out: WordPart[] = [];
    let text = '';
    for (const atom of word) {
      if ('c' in atom) {
        text += atom.c;
        continue;
      }
      if (text !== '') out.push({ kind: 'lit', text, q: 0 });
      text = '';
      out.push(atom.part);
    }
    if (text !== '') out.push({ kind: 'lit', text, q: 0 });
    return out;
  });
}
