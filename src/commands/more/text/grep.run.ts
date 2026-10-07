// The body of grep; its spec, in grep.ts, loads this the first time grep runs. Patterns go
// through the shared guard (commands/lib/regex.ts), which translates GNU's basic and extended
// syntax and refuses what could freeze the page.

import { globMatch } from '../../../shell/glob';
import type { CommandContext, CommandDoc, ExitCode } from '../../../shell/types';
import { basename } from '../../../vfs/path';
import type { Stat } from '../../../vfs/types';
import { errorCode, reason } from '../../lib/files';
import { compilePatterns, isWordChar, patternMessage, SubjectTooLong, type SafeRegex } from '../../lib/regex';
import { inputRecords, optList, optOn, optString, pacer, splitRecords, utf8Length, type Rec } from '../../lib/text-input';

export const doc: CommandDoc = {
  description:
    'Searches each FILE for lines that match PATTERNS and prints them. PATTERNS is one or more patterns separated by new lines, or given with -e or -f; a line is selected when any of them matches. With no FILE it reads standard input, or with -r the working folder; - is standard input. When more than one FILE is searched, or a folder with -r, each line is preceded by the name of its file. PATTERNS are basic regular expressions unless -E (extended), -F (plain strings) or -P is given. -P takes one pattern in the syntax of JavaScript, the language of the page, which has most of Perl\'s: \\d, lookahead (?=...), lazy repeats such as .*?, but no possessive repeats or atomic groups. Matches are highlighted on the terminal, as with --color=auto.',
  man: [
    {
      heading: 'REGULAR EXPRESSIONS',
      body: 'Basic expressions use \\( \\), \\{ \\}, \\| and \\+ \\? for groups, counts, choices and repeats; with -E they are written ( ) { } | + ?. Both have . [...] [^...] ^ $ * and the classes [[:alpha:]] [[:digit:]] [[:space:]] [[:upper:]] [[:lower:]] [[:alnum:]] [[:punct:]], \\< \\> for the edges of words, and \\1 to \\9 for backreferences.',
    },
    {
      heading: 'LIMITS',
      body: 'A pattern runs in the browser, which cannot stop it once it starts, so grep refuses patterns that could run for ever: a repeated group with a repetition inside it, as in (a+)+, or a repeated choice whose branches overlap, as in (a|aa)*. The more open-ended repetitions such as .* a pattern has, the shorter the lines it may search; a longer line is reported as an error, and grep goes on to the next file. When two choices could both match at the same place, the first that matches is used rather than the longest.',
    },
    {
      heading: 'EXIT STATUS',
      body: '0 when a line is selected, 1 when none is, and 2 when an error occurred, unless -q was given and a line was selected.',
    },
  ],
};

// GNU's default colours: match, file name, line number, separator.
const SGR = { match: '01;31', file: '35', line: '32', sep: '36' } as const;

function paint(on: boolean, code: string, text: string): string {
  return on && text !== '' ? `\u001b[${code}m\u001b[K${text}\u001b[m\u001b[K` : text;
}

interface Options {
  readonly invert: boolean;
  readonly count: boolean;
  readonly listMatching: boolean;
  readonly listMissing: boolean;
  readonly only: boolean;
  readonly quiet: boolean;
  readonly silent: boolean;
  readonly lineNumbers: boolean;
  readonly byteOffset: boolean;
  readonly max: number;
  readonly before: number;
  readonly after: number;
  readonly color: boolean;
  readonly word: boolean;
  /** -H, -h or neither: whether names are printed is then decided by the operands. */
  readonly names: boolean | null;
}

/** Where a search stands, across files: what decides the exit status and the `--` separators. */
interface State {
  matched: boolean;
  errors: boolean;
  /** Something was printed, so the next group of context is separated by `--`. */
  printed: boolean;
  /** -q found a line: stop everything. */
  done: boolean;
  listed: boolean;
}

/** The width in UTF-16 units of the character at `at`. */
function charWidth(text: string, at: number): number {
  return (text.codePointAt(at) ?? 0) > 0xffff ? 2 : 1;
}

/** The character before `at`, whole. */
function charBefore(text: string, at: number): string {
  const low = text.charCodeAt(at - 1);
  return low >= 0xdc00 && low <= 0xdfff && at >= 2 ? text.slice(at - 2, at) : text.charAt(at - 1);
}

/**
 * The matches in `line`, as [start, end) pairs. With -w a match must not start just after a
 * word character (the pattern itself checks its end). Empty matches are kept only when asked.
 */
function matchesIn(safe: SafeRegex, line: string, word: boolean, keepEmpty = false): [number, number][] {
  const re = safe.regex;
  const found: [number, number][] = [];
  re.lastIndex = 0;
  while (re.lastIndex <= line.length) {
    const m = re.exec(line);
    if (m === null) break;
    const start = m.index;
    const end = start + m[0].length;
    if (word && start > 0 && isWordChar(charBefore(line, start))) {
      re.lastIndex = start + charWidth(line, start);
      continue;
    }
    if (end > start || keepEmpty) found.push([start, end]);
    if (keepEmpty) return found;
    re.lastIndex = end > start ? end : start + charWidth(line, start);
  }
  return found;
}

/** True when `line` has a match. */
function hasMatch(safe: SafeRegex, line: string, word: boolean): boolean {
  if (!word) {
    safe.regex.lastIndex = 0;
    return safe.regex.test(line);
  }
  return matchesIn(safe, line, true, true).length > 0;
}

/** The line with its matches highlighted. */
function highlight(safe: SafeRegex, line: string, word: boolean): string {
  let text = '';
  let at = 0;
  for (const [start, end] of matchesIn(safe, line, word)) {
    text += line.slice(at, start) + paint(true, SGR.match, line.slice(start, end));
    at = end;
  }
  return text + line.slice(at);
}

class Searcher {
  constructor(
    private readonly ctx: CommandContext,
    private readonly safe: SafeRegex,
    private readonly o: Options,
    private readonly state: State,
  ) {}

  private prefix(name: string | null, line: number, offset: number, sep: string): string {
    const { o } = this;
    const c = o.color;
    let text = '';
    if (name !== null) text += paint(c, SGR.file, name) + paint(c, SGR.sep, sep);
    if (o.lineNumbers) text += paint(c, SGR.line, String(line)) + paint(c, SGR.sep, sep);
    if (o.byteOffset) text += paint(c, SGR.line, String(offset)) + paint(c, SGR.sep, sep);
    return text;
  }

  /** Searches one input's lines, naming it on each line when `named`; true when a line was selected. */
  async search(name: string, records: AsyncIterable<Rec> | Iterable<Rec>, named: boolean): Promise<boolean> {
    const { ctx, safe, o, state } = this;
    const breathe = pacer(ctx);
    const shown = named ? name : null;
    const out: string[] = [];
    const flush = async (): Promise<void> => {
      if (out.length === 0) return;
      const text = out.join('');
      out.length = 0;
      await ctx.stdout.write(text);
    };
    const contextOn = !o.only && (o.before > 0 || o.after > 0);
    const printLines = !o.count && !o.listMatching && !o.listMissing && !o.quiet;
    const before: { line: number; offset: number; text: string }[] = [];
    let lastPrinted = -1;
    let afterLeft = 0;
    let selected = 0;
    let lineNo = 0;
    let offset = 0;
    let binary = false;

    const emit = (line: number, at: number, text: string, isSelected: boolean): void => {
      if (contextOn && state.printed && lastPrinted !== line - 1) out.push(`${paint(o.color, SGR.sep, '--')}\n`);
      const lit = o.color && isSelected !== o.invert ? highlight(safe, text, o.word) : text;
      out.push(`${this.prefix(shown, line, at, isSelected ? ':' : '-')}${lit}\n`);
      lastPrinted = line;
      state.printed = true;
    };

    try {
      for await (const record of records) {
        lineNo += 1;
        const text = record.text;
        const at = offset;
        offset += utf8Length(text) + (record.nl ? 1 : 0);
        if (selected >= o.max) {
          // Past -m: only the trailing context is still printed.
          if (afterLeft > 0 && printLines) {
            emit(lineNo, at, text, false);
            afterLeft -= 1;
            continue;
          }
          break;
        }
        safe.check(text);
        if (text.includes('\0')) binary = true;
        const isSelected = hasMatch(safe, text, o.word) !== o.invert;
        if (!isSelected) {
          if (afterLeft > 0 && printLines && !binary) {
            emit(lineNo, at, text, false);
            afterLeft -= 1;
          } else if (o.before > 0) {
            before.push({ line: lineNo, offset: at, text });
            if (before.length > o.before) before.shift();
          }
          if (out.length > 256) await flush();
          await breathe();
          continue;
        }
        selected += 1;
        state.matched = true;
        if (o.quiet) {
          state.done = true;
          return true;
        }
        if (o.listMatching) break;
        if (printLines && !binary) {
          if (contextOn) for (const held of before) emit(held.line, held.offset, held.text, false);
          before.length = 0;
          if (o.only) {
            for (const [start, end] of o.invert ? [] : matchesIn(safe, text, o.word)) {
              out.push(`${this.prefix(shown, lineNo, at + utf8Length(text.slice(0, start)), ':')}${paint(o.color, SGR.match, text.slice(start, end))}\n`);
              state.printed = true;
            }
          } else {
            emit(lineNo, at, text, true);
          }
          afterLeft = o.after;
        }
        if (out.length > 256) await flush();
        await breathe();
      }
    } catch (error) {
      if (!(error instanceof SubjectTooLong)) throw error;
      await flush();
      state.errors = true;
      if (!o.silent) await ctx.fail(`${name}: ${error.message}`, 2);
    }
    await flush();
    if (binary && selected > 0 && printLines) await ctx.fail(`${name}: binary file matches`, 0);
    if (o.count) await ctx.stdout.write(`${shown === null ? '' : paint(o.color, SGR.file, shown) + paint(o.color, SGR.sep, ':')}${selected}\n`);
    if ((o.listMatching && selected > 0) || (o.listMissing && selected === 0)) {
      await ctx.stdout.write(`${paint(o.color, SGR.file, name)}\n`);
      state.listed = true;
    }
    return selected > 0;
  }
}

/** True when a name matches a --include, --exclude or --exclude-dir glob, a leading dot included. */
function nameMatches(glob: string, name: string): boolean {
  return globMatch(`x${glob}`, `x${name}`);
}

const COLOR_WORDS: Readonly<Record<string, 'always' | 'never' | 'auto'>> = {
  always: 'always',
  yes: 'always',
  force: 'always',
  never: 'never',
  no: 'never',
  none: 'never',
  auto: 'auto',
  tty: 'auto',
  'if-tty': 'auto',
};

/** Reads the patterns: -e and -f, or else the first operand; the rest are the files. */
async function readPatterns(ctx: CommandContext): Promise<{ patterns: string[]; files: string[] } | { status: ExitCode }> {
  const given = optList(ctx, 'regexp');
  const patternFiles = optList(ctx, 'file');
  const patterns: string[] = [];
  if (given.length === 0 && patternFiles.length === 0) {
    const [first, ...rest] = ctx.args;
    if (first === undefined) {
      await ctx.stderr.write('Usage: grep [OPTION]... PATTERNS [FILE]...\n');
      return { status: await ctx.usage() };
    }
    return { patterns: first.split('\n'), files: rest };
  }
  for (const p of given) patterns.push(...p.split('\n'));
  for (const file of patternFiles) {
    let text: string;
    try {
      text = file === '-' ? await ctx.stdin.text() : ctx.fs.readFile(ctx.resolve(file));
    } catch (error) {
      return { status: await ctx.fail(`${file}: ${reason(error)}`, 2) };
    }
    const lines = text.split('\n');
    if (lines[lines.length - 1] === '') lines.pop();
    patterns.push(...lines);
  }
  return { patterns, files: [...ctx.args] };
}

export async function run(ctx: CommandContext): Promise<ExitCode> {
  const read = await readPatterns(ctx);
  if ('status' in read) return read.status;
  const { patterns } = read;
  let files = read.files;

  const syntax = optOn(ctx, 'fixed-strings') ? 'fixed' : optOn(ctx, 'perl-regexp') ? 'perl' : optOn(ctx, 'extended-regexp') ? 'extended' : 'basic';
  const ignoreCase = optOn(ctx, 'ignore-case') && !optOn(ctx, 'no-ignore-case');
  const whole = optOn(ctx, 'line-regexp');
  const word = optOn(ctx, 'word-regexp') && !whole;
  let safe: SafeRegex = NEVER;
  // No patterns at all (an empty -f file) select nothing.
  if (patterns.length > 0) {
    try {
      safe = compilePatterns(patterns, { syntax, ignoreCase, flags: 'g', line: whole, word });
    } catch (error) {
      const message = patternMessage(error);
      if (message === null) throw error;
      return ctx.fail(message, 2);
    }
  }

  const colorOpt = ctx.opts.color;
  const when = typeof colorOpt === 'string' ? COLOR_WORDS[colorOpt] : 'auto';
  if (when === undefined) {
    await ctx.fail(`invalid argument '${String(colorOpt)}' for '--color'`, 2);
    await ctx.stderr.write("Valid arguments are:\n  - 'always', 'yes', 'force'\n  - 'never', 'no', 'none'\n  - 'auto', 'tty', 'if-tty'\n");
    return ctx.usage();
  }

  const context = Number(ctx.opts.context ?? 0);
  const after = Number(ctx.opts['after-context'] ?? context);
  const before = Number(ctx.opts['before-context'] ?? context);
  const bad = [after, before].find((n) => n < 0);
  if (bad !== undefined) return ctx.fail(`${bad}: invalid context length argument`, 2);
  const maxRaw = ctx.opts['max-count'];
  const max = maxRaw === undefined || Number(maxRaw) < 0 ? Infinity : Number(maxRaw);

  const o: Options = {
    invert: optOn(ctx, 'invert-match'),
    count: optOn(ctx, 'count'),
    listMatching: optOn(ctx, 'files-with-matches'),
    listMissing: optOn(ctx, 'files-without-match'),
    only: optOn(ctx, 'only-matching'),
    quiet: optOn(ctx, 'quiet'),
    silent: optOn(ctx, 'no-messages'),
    lineNumbers: optOn(ctx, 'line-number'),
    byteOffset: optOn(ctx, 'byte-offset'),
    max,
    before,
    after,
    color: when === 'always' || (when === 'auto' && ctx.stdout.isTTY),
    word,
    names: optOn(ctx, 'no-filename') ? false : optOn(ctx, 'with-filename') ? true : null,
  };
  const recurse = optOn(ctx, 'recursive') || optOn(ctx, 'dereference-recursive');
  const follow = optOn(ctx, 'dereference-recursive');
  const include = optList(ctx, 'include');
  const exclude = optList(ctx, 'exclude');
  const excludeDir = optList(ctx, 'exclude-dir');
  const implicitDot = recurse && files.length === 0;
  if (files.length === 0) files = recurse ? ['.'] : ['-'];
  const several = files.length > 1;
  const state: State = { matched: false, errors: false, printed: false, done: false, listed: false };
  const searcher = new Searcher(ctx, safe, o, state);
  const stdinName = optString(ctx, 'label') ?? '(standard input)';
  const named = (inFolder: boolean): boolean => o.names ?? (several || inFolder);

  const warn = async (message: string): Promise<void> => {
    state.errors = true;
    if (!o.silent) await ctx.fail(message, 2);
  };
  const wanted = (name: string): boolean => {
    if (include.length > 0 && !include.some((glob) => nameMatches(glob, name))) return false;
    return !exclude.some((glob) => nameMatches(glob, name));
  };
  const searchFile = async (shown: string, path: string, inFolder: boolean): Promise<void> => {
    let text: string;
    try {
      text = ctx.fs.readFile(path);
    } catch (error) {
      await warn(`${shown}: ${reason(error)}`);
      return;
    }
    if (o.max === 0) return;
    await searcher.search(shown, splitRecords(text), named(inFolder));
  };
  const visited = new Set<string>();
  const walk = async (shown: string, path: string): Promise<void> => {
    let names: string[];
    try {
      names = ctx.fs.readdir(path, { all: true });
    } catch (error) {
      await warn(`${shown || '.'}: ${reason(error)}`);
      return;
    }
    for (const name of names) {
      if (state.done) return;
      const childPath = path === '/' ? `/${name}` : `${path}/${name}`;
      const childShown = shown === '' ? name : shown.endsWith('/') ? `${shown}${name}` : `${shown}/${name}`;
      let stat: Stat;
      try {
        stat = ctx.fs.lstat(childPath);
        if (stat.type === 'symlink') {
          if (!follow) continue;
          stat = ctx.fs.stat(childPath);
        }
      } catch (error) {
        if (errorCode(error) !== 'ENOENT') await warn(`${childShown}: ${reason(error)}`);
        continue;
      }
      if (stat.type === 'directory') {
        if (excludeDir.some((glob) => nameMatches(glob, name))) continue;
        const real = ctx.fs.realpath(childPath);
        if (visited.has(real)) {
          await warn(`${childShown}: warning: recursive directory loop`);
          continue;
        }
        visited.add(real);
        await walk(childShown, childPath);
      } else if (stat.type === 'file' && wanted(name)) {
        await searchFile(childShown, childPath, true);
      }
    }
  };

  for (const file of files) {
    if (state.done) break;
    if (file === '-') {
      if (o.max !== 0) await searcher.search(stdinName, inputRecords(ctx), named(false));
      continue;
    }
    const path = ctx.resolve(file);
    let stat: Stat;
    try {
      stat = ctx.fs.stat(path);
    } catch (error) {
      await warn(`${file}: ${reason(error)}`);
      continue;
    }
    if (stat.type === 'directory') {
      if (!recurse) {
        await warn(`${file}: Is a directory`);
        continue;
      }
      visited.add(ctx.fs.realpath(path));
      await walk(implicitDot ? '' : file, path);
      continue;
    }
    if (wanted(basename(path))) await searchFile(file, path, false);
  }

  if (o.quiet && state.matched) return 0;
  if (state.errors) return 2;
  if (o.listMissing) return state.listed ? 0 : 1;
  return state.matched ? 0 : 1;
}

/** Matches nothing: what no patterns at all select. */
const NEVER: SafeRegex = { regex: /(?!)/gu, limit: Infinity, groups: 0, check: () => undefined };
