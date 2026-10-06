// Where the cursor is, for completion (docs/plan/designs/terminal-input.md, "COMPLETION ENGINE",
// a-c). Built on the shared lexer's partial mode, so completion, execution and the editor agree
// on where words start and end. It finds the word being completed, the simple command it belongs
// to (after the last | || && ; or &, or inside an open $( )), and what the word is in that
// command: a command name, a subcommand, a flag, a flag's value, an operand, a redirection's
// target or a $variable. sudo, time, xargs and env hand the rest of the line on as a fresh
// command; an alias is expanded first.

import { lex, lexPartial } from '../lexer';
import type { Quote, WordToken } from '../lexer-types';
import type { ArgSpec, CommandSpec, FlagSpec, SubcommandSpec, ValueSource } from '../types';
import { cutAt, scanRaw } from './quote';
import type { CompletionEnv, EditState, Slot } from './types';

/** Words that run the rest of the line as a command, when no spec says how. */
const PREFIX_WORDS = new Set(['time', 'nohup', 'xargs', 'exec', 'nice', '!']);

/** How deep aliases and prefixes may nest before completion stops following them. */
const MAX_DEPTH = 8;

/** `NAME=value` at the start of a command: an assignment, not the command's name. */
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** What an operand of an unknown command, or of a script, completes to: paths. */
export const ANY_PATH: Extract<ValueSource, { kind: 'path' }> = { kind: 'path', accept: 'any' };

/** A command name typed with a slash: a script to run. */
export const EXEC_PATH: Extract<ValueSource, { kind: 'path' }> = { kind: 'path', accept: 'exec' };

export interface CursorContext {
  /** The text a completion replaces starts here and ends at the cursor. */
  readonly from: number;
  /** What was typed there, quotes removed. */
  readonly prefix: string;
  readonly quoteAtFrom: Quote | null;
  /** The quote open at the cursor. */
  readonly quote: Quote | null;
  readonly atWordStart: boolean;
  readonly slot: Slot;
  readonly spec?: CommandSpec;
  readonly sub?: string;
  /** The command's words before the cursor word, unquoted, with an alias expanded. */
  readonly words: readonly string[];
  /** Which operand the word is, counting from 0 after flags and the subcommand. */
  readonly argIndex: number;
  /** Where values for the word come from. */
  readonly source?: ValueSource;
  /** The argument's or the value's name, for the placeholder. */
  readonly valueName?: string;
  /** The flags the command takes, in declared order, and those already given. */
  readonly flags: readonly FlagSpec[];
  readonly used: ReadonlySet<FlagSpec>;
}

/** The word under the cursor. */
interface CursorWord {
  readonly start: number;
  /** Its raw text up to the cursor. */
  readonly raw: string;
  /** Unquoted, up to the cursor. */
  readonly value: string;
  readonly quote: Quote | null;
  readonly token: WordToken | null;
}

/** Where a word's completion starts once `k` of its unquoted characters are kept: after `--color=`. */
function inside(word: CursorWord, k: number): { from: number; prefix: string; quoteAtFrom: Quote | null } {
  const scan = scanRaw(word.raw);
  const cut = cutAt(scan, word.raw, k);
  return { from: word.start + cut.index, prefix: scan.value.slice(k), quoteAtFrom: cut.quote };
}

/** The words of an alias's value: its first simple command, unquoted. */
function aliasWords(value: string): string[] {
  const words: string[] = [];
  for (const token of lex(value).tokens) {
    if (token.kind === 'op') break;
    if (token.kind === 'word') words.push(token.value);
  }
  return words;
}

const hasOwn = (record: object, key: string): boolean => Object.prototype.hasOwnProperty.call(record, key);

function isOption(word: string): boolean {
  return word.length > 1 && word.startsWith('-');
}

/** The long flag `name` names, exactly or as the unambiguous prefix getopt_long accepts. */
function findLong(name: string, flags: readonly FlagSpec[]): FlagSpec | undefined {
  const exact = flags.find((flag) => flag.long === name);
  if (exact !== undefined) return exact;
  const prefixed = flags.filter((flag) => flag.long?.startsWith(name));
  return prefixed.length === 1 ? prefixed[0] : undefined;
}

/**
 * Notes the flags an option word gives, and returns the flag still waiting for its value in the
 * next word, if any: `-o` in `set -o`, `--format` in `stat --format`.
 */
function readOption(word: string, flags: readonly FlagSpec[], used: Set<FlagSpec>): FlagSpec | null {
  if (word.startsWith('--')) {
    const eq = word.indexOf('=');
    const flag = findLong(word.slice(2, eq === -1 ? undefined : eq), flags);
    if (flag === undefined) return null;
    used.add(flag);
    return flag.value !== undefined && flag.value.optional !== true && eq === -1 ? flag : null;
  }
  const letters = Array.from(word.slice(1));
  for (let i = 0; i < letters.length; i += 1) {
    const flag = flags.find((f) => f.short === letters[i]);
    if (flag === undefined) return null;
    used.add(flag);
    if (flag.value !== undefined) {
      // The rest of the word is its value (-n5), or the next word is.
      return i === letters.length - 1 && flag.value.optional !== true ? flag : null;
    }
  }
  return null;
}

/**
 * The argument at which a command's words become a command line of their own: sudo's COMMAND,
 * env's COMMAND, or `command`'s COMMAND when it is followed by the rest of that line.
 */
function reentryIndex(args: readonly ArgSpec[]): number {
  const at = args.findIndex((arg) => arg.source.kind === 'commandLine');
  if (at > 0 && args[at - 1]?.source.kind === 'command') return at - 1;
  return at;
}

/** True when a word can be the operand `arg`: env's NAME=VALUE operands look like assignments. */
function fits(arg: ArgSpec | undefined, word: string): boolean {
  return arg === undefined || arg.source.kind !== 'var' || ASSIGNMENT.test(word);
}

/** Which argument the operand at `index` (the word `word`) is, or that the rest is a new command. */
function argFor(args: readonly ArgSpec[], index: number, word: string): { arg?: ArgSpec; reenter: boolean } {
  const reentry = reentryIndex(args);
  if (reentry !== -1) {
    if (index >= reentry) return { reenter: true };
    const skippable = args.slice(index, reentry).every((arg) => arg.optional === true);
    if (skippable && !fits(args[index], word)) return { reenter: true };
  }
  const last = args[args.length - 1];
  const arg = args[index] ?? (last?.variadic === true ? last : undefined);
  return arg === undefined ? { reenter: false } : { arg, reenter: false };
}

interface Classified {
  readonly slot: Slot;
  readonly spec?: CommandSpec;
  readonly sub?: string;
  readonly words: readonly string[];
  readonly argIndex: number;
  readonly source?: ValueSource;
  readonly valueName?: string;
  readonly flags: readonly FlagSpec[];
  readonly used: ReadonlySet<FlagSpec>;
  /** For `--name=value`: how many characters of the word come before the value. */
  readonly valueAt?: number;
}

const NOTHING: ReadonlySet<FlagSpec> = new Set();

/** What the cursor word is, given the words of its command before it. */
function classify(input: readonly string[], word: CursorWord, env: CompletionEnv, depth: number): Classified {
  let words = [...input];
  while (words.length > 0 && ASSIGNMENT.test(words[0] ?? '')) words.shift();
  const name = words[0];
  if (name === undefined) return { slot: 'command', words: [], argIndex: 0, flags: [], used: NOTHING };

  const alias = depth < MAX_DEPTH ? env.aliases().get(name) : undefined;
  if (alias !== undefined) {
    const expanded = aliasWords(alias);
    if (expanded.length > 0 && expanded[0] !== name) return classify([...expanded, ...words.slice(1)], word, env, depth + 1);
    if (expanded.length > 0) words = [...expanded, ...words.slice(1)];
  }

  const spec = env.registry.get(name);
  if (spec === undefined) {
    if (PREFIX_WORDS.has(name) && depth < MAX_DEPTH) {
      let i = 1;
      while (i < words.length && isOption(words[i] ?? '')) i += 1;
      return classify(words.slice(i), word, env, depth + 1);
    }
    return { slot: 'arg', words, argIndex: words.length - 1, source: ANY_PATH, flags: [], used: NOTHING };
  }

  let sub: string | undefined;
  let subSpec: SubcommandSpec | undefined;
  const flags = (): FlagSpec[] => [...(spec.flags ?? []), ...(subSpec?.flags ?? [])];
  // A subcommand takes only its own operands: `theme ls` takes none, so offers no theme names.
  const operands = (): readonly ArgSpec[] => (sub === undefined ? (spec.args ?? []) : (subSpec?.args ?? []));
  const used = new Set<FlagSpec>();
  let positional = 0;
  let endOfOptions = false;
  let pending: FlagSpec | null = null;
  const optionsOpen = (): boolean => !endOfOptions && !(spec.posixArgs === true && positional > 0);

  for (let i = 1; i < words.length; i += 1) {
    const w = words[i] ?? '';
    if (pending !== null) {
      pending = null;
      continue;
    }
    if (optionsOpen()) {
      if (w === '--') {
        endOfOptions = true;
        continue;
      }
      if (isOption(w)) {
        pending = readOption(w, flags(), used);
        continue;
      }
    }
    if (positional === 0 && sub === undefined && spec.subcommands !== undefined && hasOwn(spec.subcommands, w)) {
      sub = w;
      subSpec = spec.subcommands[w];
      continue;
    }
    if (argFor(operands(), positional, w).reenter && depth < MAX_DEPTH) {
      return classify(words.slice(i), word, env, depth + 1);
    }
    positional += 1;
  }

  const base = { spec, ...(sub === undefined ? {} : { sub }), words, flags: flags(), used };
  if (pending !== null && pending.value !== undefined) {
    return { ...base, slot: 'flag-value', argIndex: positional, source: pending.value.source, valueName: pending.value.name };
  }
  const dash = word.raw.startsWith('-');
  if (dash && optionsOpen()) {
    const eq = word.value.indexOf('=');
    if (word.value.startsWith('--') && eq > 2) {
      const flag = findLong(word.value.slice(2, eq), flags());
      if (flag?.value === undefined) return { ...base, slot: 'none', argIndex: positional };
      return { ...base, slot: 'flag-value', argIndex: positional, source: flag.value.source, valueName: flag.value.name, valueAt: eq + 1 };
    }
    return { ...base, slot: 'flag', argIndex: positional };
  }
  const subcommands = spec.subcommands === undefined ? [] : Object.keys(spec.subcommands);
  if (positional === 0 && sub === undefined && subcommands.length > 0) return { ...base, slot: 'subcommand', argIndex: 0 };

  const target = argFor(operands(), positional, word.value);
  if (target.reenter && depth < MAX_DEPTH) return classify([], word, env, depth + 1);
  if (target.arg === undefined) return { ...base, slot: 'none', argIndex: positional };
  return { ...base, slot: 'arg', argIndex: positional, source: target.arg.source, valueName: target.arg.name };
}

/** A `$NAME` or `${NAME` being typed at the end of the word: how long it is, and whether braced. */
function trailingVariable(word: CursorWord): number | null {
  const token = word.token;
  if (token === null) return null;
  const last = token.parts[token.parts.length - 1];
  if (last?.kind === 'param' && last.op === undefined) {
    const typed = last.braced ? `\${${last.name}` : `$${last.name}`;
    if (word.raw.endsWith(typed) && /^[A-Za-z_][A-Za-z0-9_]*$|^$/.test(last.name)) return typed.length;
    return null;
  }
  // A lone `$`, not escaped and not in single quotes.
  if (last?.kind === 'lit' && last.q !== 1 && last.text.endsWith('$') && word.raw.endsWith('$') && !word.raw.endsWith('\\$')) return 1;
  return null;
}

/** Where the cursor is, and what the word there is. Never throws on any line. */
export function cursorContext(state: EditState, env: CompletionEnv): CursorContext {
  const lexed = lexPartial(state.text, state.cursor);
  const cursor = lexed.cursor;
  const token = lexed.word.token;
  const word: CursorWord = {
    start: lexed.word.start,
    raw: state.text.slice(lexed.word.start, cursor),
    value: lexed.word.value,
    quote: lexed.word.openQuote,
    token,
  };
  const whole = { from: word.start, prefix: word.value, quoteAtFrom: null, quote: word.quote, atWordStart: true };
  const none: CursorContext = { ...whole, slot: 'none', words: [], argIndex: 0, flags: [], used: NOTHING };
  if (lexed.inComment) return none;

  const variable = trailingVariable(word);
  if (variable !== null) {
    const from = cursor - variable;
    return { ...none, from, prefix: state.text.slice(from, cursor), quoteAtFrom: word.quote, atWordStart: from === word.start, slot: 'var' };
  }
  if (lexed.redirectTarget) return { ...none, slot: 'redirect', source: ANY_PATH };

  const before = lexed.words.map((w) => w.value);
  const leading = lexed.words.every((w) => w.assign !== undefined);
  if (token?.assign !== undefined && leading) {
    // `NAME=~/do`: the value is a path.
    const at = token.assign.name.length + 1;
    return { ...none, ...inside(word, at), atWordStart: false, slot: 'arg', source: ANY_PATH };
  }

  const found = classify(before, word, env, 0);
  const context: CursorContext = {
    ...whole,
    slot: found.slot,
    ...(found.spec === undefined ? {} : { spec: found.spec }),
    ...(found.sub === undefined ? {} : { sub: found.sub }),
    words: found.words,
    argIndex: found.argIndex,
    ...(found.source === undefined ? {} : { source: found.source }),
    ...(found.valueName === undefined ? {} : { valueName: found.valueName }),
    flags: found.flags,
    used: found.used,
  };
  if (found.slot === 'command' && word.value.includes('/')) return { ...context, slot: 'arg', source: EXEC_PATH };
  if (found.valueAt !== undefined) return { ...context, ...inside(word, found.valueAt), atWordStart: false };
  return context;
}
