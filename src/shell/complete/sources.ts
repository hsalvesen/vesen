// Where candidates come from (docs/plan/designs/terminal-input.md, "COMPLETION ENGINE", e): the
// registry's commands and aliases with their summaries, a spec's subcommands and flags, and each
// ValueSource: paths through ~, .., $VAR and nested folders; command names; enums such as the
// theme names, with swatches; a spec's examples and the values history has seen; variables and
// aliases.

import { lex } from '../lexer';
import type { Candidate, CommandSpec, EnumValue, ValueSource } from '../types';
import { ANY_PATH, type CursorContext } from './context';
import { matchPrefix } from './match';
import type { CompletionEnv, FsEntry } from './types';

/** Candidates for one word, before matching (paths come already matched, folder by folder). */
export interface Pool {
  readonly items: readonly Candidate[];
  /** Keep the order given: subcommands and flags, as their spec declares them. */
  readonly ordered?: boolean;
  /** Match ignoring case, always: theme names, places, tickers. */
  readonly caseInsensitive?: boolean;
  /** Already matched against what was typed. */
  readonly matched?: boolean;
  readonly caseFolded?: boolean;
}

const EMPTY: Pool = { items: [] };

/** How much of history the examples look through, newest first. */
const HISTORY_SCAN = 200;

type PathSource = Extract<ValueSource, { kind: 'path' }>;

const SUMMARY_MAX = 50;

function short(text: string): string {
  const one = text.replace(/\s+/g, ' ');
  return one.length > SUMMARY_MAX ? `${one.slice(0, SUMMARY_MAX - 1)}…` : one;
}

function variable(env: CompletionEnv, name: string): string | undefined {
  for (const [key, value] of env.vars()) if (key === name) return value;
  return undefined;
}

// ── Commands ───────────────────────────────────────────────────────────────────────────────

/**
 * A command that stays out of a Tab list of command names (docs/plan/08, wave E): one whose spec
 * says `featured: false`, and every fun command unless it says `featured: true`. `help` still
 * lists them, under their category.
 */
export function keepsQuiet(spec: CommandSpec | undefined): boolean {
  if (spec === undefined) return false;
  return spec.featured === false || (spec.category === 'fun' && spec.featured !== true);
}

/**
 * Command names without the quiet ones (keepsQuiet), unless one is the word typed whole or
 * nothing else matches: `c` lists cat and cd but not cowsay, while `cow` finds cowsay and `sl`
 * keeps sl beside sleep.
 */
export function withoutQuiet(items: readonly Candidate[], typed: string, env: CompletionEnv): Candidate[] {
  const loud = items.filter((c) => c.value === typed || (c.kind !== 'command' && c.kind !== 'alias') || !keepsQuiet(env.registry.get(c.value)));
  return loud.length > 0 ? loud : [...items];
}

/**
 * Every command name and its aliases. As a line's first word (`programs`), also the shell's
 * aliases and the scripts on $PATH; as the operand of help, man or which, only the commands.
 */
export function commandCandidates(env: CompletionEnv, programs: boolean): Candidate[] {
  const items: Candidate[] = [];
  for (const spec of env.registry.list()) {
    items.push({ value: spec.name, label: spec.name, kind: 'command', summary: spec.summary, terminal: true });
    for (const alias of spec.aliases ?? []) items.push({ value: alias, label: alias, kind: 'alias', summary: spec.summary, terminal: true });
  }
  if (programs) {
    for (const [name, value] of env.aliases()) {
      items.push({ value: name, label: name, kind: 'alias', summary: short(`alias for ${value}`), terminal: true });
    }
    for (const dir of (variable(env, 'PATH') ?? '').split(':')) {
      if (!dir.startsWith('/')) continue;
      for (const entry of env.fs.list(dir) ?? []) {
        if (entry.type !== 'file' || entry.exec !== true || env.registry.get(entry.name) !== undefined) continue;
        items.push({ value: entry.name, label: entry.name, kind: 'exec', summary: `${dir}/${entry.name}`, terminal: true });
      }
    }
  }
  return items;
}

function subcommandCandidates(spec: CommandSpec): Candidate[] {
  return Object.entries(spec.subcommands ?? {})
    .filter(([, sub]) => sub.hidden !== true)
    .map(([name, sub]) => ({ value: name, label: name, kind: 'subcommand', summary: sub.summary, terminal: true }));
}

/** The flags not given yet, short then long, in declared order, and --help. */
function flagCandidates(context: CursorContext): Candidate[] {
  const items: Candidate[] = [];
  for (const flag of context.flags) {
    if (context.used.has(flag) && flag.repeatable !== true) continue;
    if (flag.short !== undefined) {
      items.push({ value: `-${flag.short}`, label: `-${flag.short}`, kind: 'flag', summary: flag.description, terminal: true });
    }
    if (flag.long !== undefined) {
      // A long flag that needs a value completes with its `=`, as GNU tools do.
      const needsValue = flag.value !== undefined && flag.value.optional !== true;
      const value = needsValue ? `--${flag.long}=` : `--${flag.long}`;
      items.push({ value, label: value, kind: 'flag', summary: flag.description, terminal: !needsValue });
    }
  }
  if (!context.flags.some((flag) => flag.long === 'help') && !context.words.includes('--help')) {
    items.push({ value: '--help', label: '--help', kind: 'flag', summary: 'show help and exit', terminal: true });
  }
  return items;
}

// ── Paths ──────────────────────────────────────────────────────────────────────────────────

interface Folder {
  /** The folder, absolute. */
  readonly abs: string;
  /** The folder part as it goes back on the line: as typed, with names matched by case put right. */
  readonly typed: string;
  readonly caseFolded: boolean;
}

const segmentsOf = (path: string): string[] => path.split('/').filter((s) => s !== '');
const absolute = (segments: readonly string[]): string => `/${segments.join('/')}`;

/** Resolves the folder part of a typed path (ending in '/', or empty), one folder at a time. */
function resolveFolder(typed: string, env: CompletionEnv): Folder | null {
  if (typed === '') return { abs: env.cwd(), typed: '', caseFolded: false };
  const segments = typed.split('/');
  segments.pop();
  const kept: string[] = [];
  let at: string[];
  let i = 1;
  let caseFolded = false;
  const first = segments[0] ?? '';
  const named = /^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?$/.exec(first);
  if (first === '') at = [];
  else if (first === '~') at = segmentsOf(env.home());
  else if (named?.[1] !== undefined) {
    const value = variable(env, named[1]);
    if (value === undefined || !value.startsWith('/')) return null;
    at = segmentsOf(value);
  } else {
    at = segmentsOf(env.cwd());
    i = 0;
  }
  if (i === 1) kept.push(first);
  for (; i < segments.length; i += 1) {
    const segment = segments[i] ?? '';
    kept.push(segment);
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      at.pop();
      continue;
    }
    const dirs = (env.fs.list(absolute(at)) ?? []).filter((entry) => entry.type === 'dir');
    let found = dirs.find((entry) => entry.name === segment);
    if (found === undefined) {
      // Per folder, case is ignored only when nothing matches it exactly: 'Documents/'.
      const lower = segment.toLowerCase();
      const folded = dirs.filter((entry) => entry.name.toLowerCase() === lower);
      if (folded.length !== 1) return null;
      found = folded[0];
      caseFolded = true;
    }
    if (found === undefined) return null;
    at.push(found.name);
    kept[kept.length - 1] = found.name;
  }
  return { abs: absolute(at), typed: `${kept.join('/')}/`, caseFolded };
}

function accepts(entry: FsEntry, accept: NonNullable<PathSource['accept']>): boolean {
  // Folders are always offered, so a path can be walked to what is wanted.
  if (entry.type === 'dir') return true;
  if (accept === 'dir') return false;
  if (accept === 'exec') return entry.exec === true;
  return true;
}

/** Files and folders for a typed path, matched one folder at a time; folders end in '/'. */
export function pathPool(typed: string, source: PathSource, env: CompletionEnv): Pool {
  if (typed === '~') return { items: [{ value: '~/', label: '~/', kind: 'dir', terminal: false }], matched: true };
  const slash = typed.lastIndexOf('/');
  const folder = resolveFolder(typed.slice(0, slash + 1), env);
  if (folder === null) return { items: [], matched: true };
  const base = typed.slice(slash + 1);
  const entries = env.fs.list(folder.abs) ?? [];
  // Dotfiles only once a dot is typed, as in bash.
  const hidden = base.startsWith('.');
  const eligible = entries
    .filter((entry) => (hidden || !entry.name.startsWith('.')) && accepts(entry, source.accept ?? 'any'))
    .map((entry) => ({ value: entry.name, entry }));
  const { matched, caseFolded } = matchPrefix(eligible, base);
  const items: Candidate[] = matched.map(({ entry }) => {
    const dir = entry.type === 'dir';
    const label = dir ? `${entry.name}/` : entry.name;
    return { value: folder.typed + label, label, kind: dir ? 'dir' : entry.exec === true ? 'exec' : 'file', terminal: !dir };
  });
  // The parent folder: for `cd ..`, and for cd, ls and mkdir's empty word or a lone dot.
  if (base === '..' || (source.includeParent === true && folder.typed === '' && (base === '' || base === '.'))) {
    items.unshift({ value: `${folder.typed}../`, label: '../', kind: 'dir', terminal: false });
  }
  return { items, matched: true, caseFolded: caseFolded || folder.caseFolded };
}

// ── Values ─────────────────────────────────────────────────────────────────────────────────

/** A line's operands for a command, after its name, flags and the subcommand; null for another command. */
function operands(line: string, spec: CommandSpec, sub: string | undefined): string[] | null {
  const words: string[] = [];
  for (const token of lex(line).tokens) {
    if (token.kind !== 'word') break;
    words.push(token.value);
  }
  const name = words.shift();
  if (name === undefined || (name !== spec.name && !(spec.aliases ?? []).includes(name))) return null;
  const rest = words.filter((word) => !word.startsWith('-'));
  if (sub === undefined) return rest;
  return rest[0] === sub ? rest.slice(1) : null;
}

/** The operand at `index` of a line, or all the rest joined for a variadic argument: 'New York'. */
function operandAt(words: readonly string[], index: number, variadic: boolean): string | undefined {
  if (words.length <= index) return undefined;
  return variadic ? words.slice(index).join(' ') : words[index];
}

function examplePool(context: CursorContext, source: Extract<ValueSource, { kind: 'examples' }>, env: CompletionEnv): Pool {
  const spec = context.spec;
  if (spec === undefined) return EMPTY;
  const args = (context.sub !== undefined ? spec.subcommands?.[context.sub]?.args : undefined) ?? spec.args ?? [];
  const last = args[args.length - 1];
  const variadic = last?.variadic === true && context.argIndex >= args.length - 1;
  const items: Candidate[] = [];
  if (source.fromHistory === true) {
    const history = env.history();
    for (let i = history.length - 1, seen = 0; i >= 0 && seen < HISTORY_SCAN; i -= 1, seen += 1) {
      const words = operands(history[i] ?? '', spec, context.sub);
      const value = words === null ? undefined : operandAt(words, context.argIndex, variadic);
      if (value !== undefined && value !== '') items.push({ value, label: value, kind: 'history', summary: 'from history', terminal: true });
    }
  }
  for (const example of spec.examples ?? []) {
    const words = operands(example.line, spec, context.sub);
    const value = words === null ? undefined : operandAt(words, context.argIndex, variadic);
    if (value === undefined || value === '') continue;
    items.push({ value, label: value, kind: 'example', ...(example.note === undefined ? {} : { summary: example.note }), terminal: true });
  }
  return { items, ...(source.caseInsensitive === true ? { caseInsensitive: true } : {}) };
}

function enumPool(source: Extract<ValueSource, { kind: 'enum' }>, env: CompletionEnv): Pool {
  const values: readonly EnumValue[] = source.values(env.appearance === undefined ? {} : { appearance: env.appearance });
  const items = values.map(
    (v): Candidate => ({
      value: v.value,
      label: v.value,
      kind: 'value',
      ...(v.summary === undefined ? {} : { summary: v.summary }),
      ...(v.swatch === undefined ? {} : { swatch: v.swatch }),
      terminal: true,
    }),
  );
  return { items, ...(source.caseInsensitive === true ? { caseInsensitive: true } : {}) };
}

/** Candidates for a value: an operand, a flag's value, a redirection's target. */
export function valuePool(context: CursorContext, env: CompletionEnv): Pool {
  const source = context.source;
  if (source === undefined) return EMPTY;
  switch (source.kind) {
    case 'path':
      return pathPool(context.prefix, source, env);
    case 'command':
    case 'commandLine':
      return { items: commandCandidates(env, source.kind === 'commandLine') };
    case 'enum':
      return enumPool(source, env);
    case 'examples':
      return examplePool(context, source, env);
    case 'var':
      return { items: env.vars().map(([name, value]) => ({ value: name, label: name, kind: 'var', summary: short(value), terminal: true })) };
    case 'alias':
      return { items: [...env.aliases()].map(([name, value]) => ({ value: name, label: name, kind: 'alias', summary: short(value), terminal: true })) };
    case 'free':
      // Free text, but a word being typed may be a file, as bash completes one for echo, printf
      // and test: `echo REA`, `[ -d doc`. An empty word keeps its placeholder; an option is not a path.
      return context.prefix !== '' && !context.prefix.startsWith('-') ? pathPool(context.prefix, ANY_PATH, env) : EMPTY;
    default:
      return EMPTY;
  }
}

/** `$NAME` or `${NAME}` for each variable. */
export function variablePool(context: CursorContext, env: CompletionEnv): Pool {
  const braced = context.prefix.startsWith('${');
  const items = env.vars().map(
    ([name, value]): Candidate => {
      const ref = braced ? `\${${name}}` : `$${name}`;
      return { value: ref, label: ref, kind: 'var', summary: short(value), terminal: true };
    },
  );
  return { items };
}

/** Everything the word could be, before it is matched against what was typed. */
export function gather(context: CursorContext, env: CompletionEnv): Pool {
  switch (context.slot) {
    case 'command':
      return { items: commandCandidates(env, true) };
    case 'subcommand':
      return { items: context.spec === undefined ? [] : subcommandCandidates(context.spec), ordered: true };
    case 'flag':
      return { items: flagCandidates(context), ordered: true };
    case 'flag-value':
    case 'arg':
    case 'redirect':
      return valuePool(context, env);
    case 'var':
      return variablePool(context, env);
    case 'none':
      return EMPTY;
  }
}
