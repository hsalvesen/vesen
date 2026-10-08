// Option parsing in the style of GNU getopt_long, driven by a command's FlagSpec list
// (docs/plan/designs/shell-architecture.md, section 2, step 5):
//
// - short options, alone or combined (-la), with a value attached (-n5) or as the next word (-n 5)
// - long options with --name=value or --name value, and unambiguous prefixes (--al for --all)
// - `--` ends the options; `-` alone is an operand
// - GNU argument permutation (options may follow operands), unless the spec sets posixArgs
// - a numeric shortcut: `head -5` is `head -n 5` when the spec names the flag
// - --help is always help; -h is help only when the spec has no h flag of its own; --version
//   prints the version, as every GNU tool's does (not for a shell builtin, which has none)
// - mistakes are worded as coreutils words them, with status 2:
//     ls: invalid option -- 'z'
//     Try 'ls --help' for more information.

import type { CommandSpec, FlagSpec, OptValue } from './types';
import { UsageError } from './types';

/** A usage error found while reading options; the message has no `name: ` prefix. */
export class FlagError extends UsageError {
  constructor(message: string) {
    super(message);
    this.name = 'FlagError';
  }
}

export interface ParsedArgs {
  readonly opts: Readonly<Record<string, OptValue>>;
  /** The operands, in order. */
  readonly args: readonly string[];
  /** True when --help (or -h, for a spec without an h flag) was given. */
  readonly help: boolean;
  /** True when --version was given, before any --help. */
  readonly version?: boolean;
}

/** The spec fields option parsing reads. */
export type FlagSource = Pick<CommandSpec, 'flags' | 'posixArgs' | 'numericShortcut'>;

/** The key a flag's value is stored under in ctx.opts. */
export function flagKey(flag: FlagSpec): string {
  return flag.key ?? flag.long ?? flag.short ?? '';
}

/** "Try 'ls --help' for more information." */
export function tryHelp(name: string): string {
  return `Try '${name} --help' for more information.`;
}

const INTEGER = /^[+-]?\d+$/;

class Reader {
  readonly opts: Record<string, OptValue> = {};
  readonly args: string[] = [];
  /** Keys set from the words, as opposed to defaults. */
  private readonly given = new Set<string>();
  private readonly shorts = new Map<string, FlagSpec>();
  private readonly longs: FlagSpec[] = [];

  constructor(source: FlagSource) {
    for (const flag of source.flags ?? []) {
      if (flag.short !== undefined) this.shorts.set(flag.short, flag);
      if (flag.long !== undefined) this.longs.push(flag);
      // Defaults are visible to the command whether or not the flag is given.
      if (flag.value?.default !== undefined) this.opts[flagKey(flag)] = this.convert(flag, flag.value.default, false);
    }
  }

  get definesH(): boolean {
    return this.shorts.has('h');
  }

  findShort(c: string): FlagSpec | undefined {
    return this.shorts.get(c);
  }

  findLong(name: string): FlagSpec {
    const exact = this.longs.find((flag) => flag.long === name);
    if (exact) return exact;
    const matches = this.longs.filter((flag) => flag.long?.startsWith(name));
    if (matches.length === 1 && matches[0]) return matches[0];
    if (matches.length > 1) {
      const options = matches.map((flag) => `'--${flag.long}'`).join(' ');
      throw new FlagError(`option '--${name}' is ambiguous; possibilities: ${options}`);
    }
    throw new FlagError(`unrecognized option '--${name}'`);
  }

  /** Records a flag without a value (or with its optional value left out). */
  setBare(flag: FlagSpec): void {
    const key = flagKey(flag);
    if (flag.value !== undefined) {
      // An optional value that was not given: the flag is on.
      this.store(flag, key, true);
      return;
    }
    if (flag.repeatable) {
      const before = this.opts[key];
      this.opts[key] = (typeof before === 'number' ? before : 0) + 1;
    } else {
      this.opts[key] = true;
    }
  }

  setValue(flag: FlagSpec, value: string, spelled: string): void {
    this.store(flag, flagKey(flag), this.convert(flag, value, true, spelled));
  }

  private store(flag: FlagSpec, key: string, value: string | number | boolean): void {
    if (flag.repeatable && typeof value !== 'boolean') {
      const before = this.opts[key];
      const list = Array.isArray(before) && this.given.has(key) ? before : [];
      this.opts[key] = [...list, String(value)];
    } else {
      this.opts[key] = value;
    }
    this.given.add(key);
  }

  private convert(flag: FlagSpec, value: string, check: boolean, spelled = ''): string | number {
    if (flag.value?.source.kind !== 'int') return value;
    if (INTEGER.test(value)) return Number(value);
    if (check) throw new FlagError(`invalid argument '${value}' for '${spelled}'`);
    return value;
  }
}

function longSpelling(flag: FlagSpec): string {
  return flag.long !== undefined ? `--${flag.long}` : `-${flag.short ?? ''}`;
}

/**
 * Reads the options in `words` (the words after the command name) against `source`.
 * Throws FlagError for an unknown option, a missing or unexpected value, or a bad number.
 * --help anywhere among the options is help, even after a mistake, as the kernel promises.
 */
export function parseFlags(
  words: readonly string[],
  source: FlagSource,
  options: { readonly interceptHelp?: boolean; readonly interceptVersion?: boolean } = {},
): ParsedArgs {
  const intercept = options.interceptHelp ?? true;
  const reader = new Reader(source);
  const asked = intercept ? findHelp(words, source, reader.definesH, options.interceptVersion === true) : null;
  if (asked !== null) return { opts: reader.opts, args: [], help: asked === 'help', version: asked === 'version' };

  const shortcut = source.numericShortcut;
  const shortcutFlag = shortcut === undefined ? undefined : source.flags?.find((flag) => flagKey(flag) === shortcut);
  let i = 0;
  let operandsOnly = false;
  while (i < words.length) {
    const word = words[i] ?? '';
    i += 1;
    if (operandsOnly || word === '-' || !word.startsWith('-')) {
      reader.args.push(word);
      if (source.posixArgs && !operandsOnly) operandsOnly = true;
      continue;
    }
    if (word === '--') {
      operandsOnly = true;
      continue;
    }
    if (word.startsWith('--')) {
      const body = word.slice(2);
      const eq = body.indexOf('=');
      const name = eq === -1 ? body : body.slice(0, eq);
      const flag = reader.findLong(name);
      const spelled = `--${flag.long ?? name}`;
      if (eq !== -1) {
        if (flag.value === undefined) throw new FlagError(`option '${spelled}' doesn't allow an argument`);
        reader.setValue(flag, body.slice(eq + 1), spelled);
      } else if (flag.value === undefined || flag.value.optional) {
        reader.setBare(flag);
      } else {
        const value = words[i];
        if (value === undefined) throw new FlagError(`option '${spelled}' requires an argument`);
        i += 1;
        reader.setValue(flag, value, spelled);
      }
      continue;
    }
    if (shortcutFlag !== undefined && /^-\d+$/.test(word)) {
      reader.setValue(shortcutFlag, word.slice(1), longSpelling(shortcutFlag));
      continue;
    }
    // A cluster of short options: -la, -n5, -n 5.
    for (let k = 1; k < word.length; k += 1) {
      const c = word.charAt(k);
      const flag = reader.findShort(c);
      if (flag === undefined) {
        if (c === 'h' && intercept) return { opts: reader.opts, args: [], help: true };
        throw new FlagError(`invalid option -- '${c}'`);
      }
      if (flag.value === undefined) {
        reader.setBare(flag);
        continue;
      }
      const attached = word.slice(k + 1);
      if (attached !== '') {
        reader.setValue(flag, attached, `-${c}`);
      } else if (flag.value.optional) {
        reader.setBare(flag);
      } else {
        const value = words[i];
        if (value === undefined) throw new FlagError(`option requires an argument -- '${c}'`);
        i += 1;
        reader.setValue(flag, value, longSpelling(flag));
      }
      break;
    }
  }
  return { opts: reader.opts, args: reader.args, help: false };
}

/** Whether --help (or a help -h), or --version, comes first where an option may be. */
function findHelp(words: readonly string[], source: FlagSource, definesH: boolean, version: boolean): 'help' | 'version' | null {
  const valueFlags = new Set((source.flags ?? []).filter((flag) => flag.value && !flag.value.optional).map((flag) => flag.short));
  let skipNext = false;
  for (const word of words) {
    if (skipNext) {
      skipNext = false;
      continue;
    }
    if (word === '--') return null;
    if (word === '--help' || (word === '-h' && !definesH)) return 'help';
    if (word === '--version' && version) return 'version';
    if (!word.startsWith('-') || word === '-') {
      if (source.posixArgs) return null;
      continue;
    }
    // `-n --help`: the word after a short option that takes a value is that value.
    if (!word.startsWith('--') && word.length === 2 && valueFlags.has(word.charAt(1))) skipNext = true;
  }
  return null;
}

/**
 * True when a raw-args command's words ask for its help: --help before any `--`, or -h first.
 * A later -h is an argument, so `echo say -h` says it (F032).
 */
export function rawArgsAskForHelp(words: readonly string[]): boolean {
  if (words[0] === '-h') return true;
  const end = words.indexOf('--');
  return (end === -1 ? words : words.slice(0, end)).includes('--help');
}

/**
 * A spec that takes its words unparsed and reads its own options: echo, whose options are only
 * leading words such as -n or -neE (anything else is text to print, as in bash), test, set, exit
 * and true, and qr and weather, which word their own errors. Without handlesHelp,
 * rawArgsAskForHelp decides when such a command asked for help.
 */
export interface RawArgsSpec {
  readonly rawArgs?: boolean;
}

export function takesRawArgs(spec: CommandSpec): boolean {
  return (spec as RawArgsSpec).rawArgs === true;
}
