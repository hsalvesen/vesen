// The body of find; its spec, in find.ts, loads this the first time find runs.
//
// The expression is parsed once into a tree of tests, operators and actions, then evaluated for
// each file, in GNU find's order: a folder before what is in it, or after with -depth (which
// -delete turns on). Links are not followed unless -L (or -H, for the starting points) says so.
// -exec and -ok run their command through the shell, so it can be any vesen command, with each
// word quoted as it is; `{} +` gathers the names and runs the command once at the end. Patterns
// are shell patterns matched without backtracking (lib/fnmatch.ts): there is no -regex.

import { out } from '../../../output/model';
import { EXIT, type CommandContext, type CommandDoc, type ExitCode } from '../../../shell/types';
import { ACCOUNTS, GROUPS } from '../../../vfs/identity';
import type { Stat } from '../../../vfs/types';
import { applyMode, compileMode } from '../../lib/chmod-mode';
import { childPath, reason } from '../../lib/files';
import { fnmatch } from '../../lib/fnmatch';
import { inodeOf, kibBlocks, lsDate, modeString } from '../../lib/listing';
import { searchPath } from '../../lib/lookup';
import { shellQuote } from '../../shell/alias';

/** What --help, help and man say about find, besides its spec (find.ts). */
export const doc: CommandDoc = {
  description:
    "Walks each STARTING-POINT (the working directory when none is given) and everything below it, and evaluates the EXPRESSION for every file and folder it finds, printing the ones for which it is true. With no action in the EXPRESSION, -print is implied. Paths are printed as they were reached from the starting point, so 'find .' prints ./README.md.",
  man: [
    {
      heading: 'OPTIONS',
      body: "{accent}-H{/} follow links named as starting points, {accent}-L{/} follow every link, {accent}-P{/} follow none (the default); these come before the starting points. {accent}-maxdepth N{/} and {accent}-mindepth N{/} limit how deep it looks (0 is the starting point itself), and {accent}-depth{/} handles what is in a folder before the folder.",
    },
    {
      heading: 'TESTS',
      body: "{accent}-name PATTERN{/} and {accent}-iname PATTERN{/} the last part of the name, {accent}-path PATTERN{/} and {accent}-ipath{/} the whole path as printed, with * ? and [...]; {accent}-type f|d|l|c{/} file, folder, link or device (several as f,d); {accent}-size [+-]N[ckMG]{/} size rounded up to units of 512 bytes, or bytes, KiB, MiB or GiB; {accent}-empty{/}; {accent}-newer FILE{/} modified after FILE; {accent}-mtime [+-]N{/} days and {accent}-mmin [+-]N{/} minutes since the last change; {accent}-user NAME{/}, {accent}-group NAME{/}, {accent}-uid N{/}, {accent}-gid N{/}, {accent}-nouser{/}, {accent}-nogroup{/}; {accent}-perm MODE{/} exactly MODE, {accent}-perm -MODE{/} all of its bits, {accent}-perm /MODE{/} any of them; {accent}-readable{/}, {accent}-writable{/}, {accent}-executable{/}; {accent}-links [+-]N{/}; {accent}-true{/} and {accent}-false{/}. For the numbers, +N means more than N, -N less than N, and N exactly N. Patterns are shell patterns, never regular expressions: vesen's find has no -regex.",
    },
    {
      heading: 'ACTIONS',
      body: "{accent}-print{/} the path and a newline; {accent}-print0{/} the path and a NUL; {accent}-ls{/} a line like ls -dils; {accent}-delete{/} remove the file or empty folder; {accent}-exec COMMAND ;{/} run COMMAND with each {} replaced by the path (true when it exits 0), on its own, as a program runs: a cd or an export there does not change your shell, and it reads nothing from standard input; {accent}-exec COMMAND {} +{/} run COMMAND once with all the paths at the end; {accent}-ok COMMAND ;{/} like -exec, asking first; {accent}-prune{/} do not go into this folder; {accent}-quit{/} stop at once. At the prompt, ; must be quoted: \\; or ';'.",
    },
    {
      heading: 'OPERATORS',
      body: "{accent}( EXPR ){/} groups (quote the brackets: \\( and \\)), {accent}! EXPR{/} or {accent}-not EXPR{/} is true when EXPR is false, {accent}EXPR -a EXPR{/} (or two in a row) is true when both are, evaluating the second only when the first is true, and {accent}EXPR -o EXPR{/} is true when either is, evaluating the second only when the first is false.",
    },
    {
      heading: 'EXIT STATUS',
      body: '0 when every file was handled, 1 when a starting point was missing, a folder could not be read, a -delete failed, a -exec ... + command failed, or the expression had a mistake.',
    },
  ],
};

/** One file or folder as the expression sees it. */
interface Visit {
  /** Where it is, for the file system. */
  readonly path: string;
  /** The path as printed: from the starting point as typed. */
  readonly shown: string;
  /** Its last name, as -name matches it. */
  readonly name: string;
  readonly depth: number;
  readonly stat: Stat;
  /** Set by -prune: do not go into this folder. */
  pruned: boolean;
}

type Result = boolean | Promise<boolean>;

type Expr =
  | { readonly kind: 'and' | 'or'; readonly left: Expr; readonly right: Expr }
  | { readonly kind: 'not'; readonly expr: Expr }
  | { readonly kind: 'primary'; readonly name: string; readonly test: (visit: Visit) => Result };

/** A mistake in the expression, in GNU find's words. */
class FindError extends Error {}

/** `-exec ... {} +`: the names gathered so far, run in batches. */
interface Batch {
  readonly command: readonly string[];
  paths: string[];
  size: number;
}

/** The most names (and characters) one -exec ... + line may take before it is run. */
const BATCH_NAMES = 1000;
const BATCH_CHARS = 64 * 1024;

interface Comparison {
  readonly op: '+' | '-' | '=';
  readonly n: number;
}

function compare(value: number, by: Comparison): boolean {
  return by.op === '+' ? value > by.n : by.op === '-' ? value < by.n : value === by.n;
}

const SIZE_UNITS: Readonly<Record<string, number>> = { b: 512, c: 1, w: 2, k: 1024, M: 1024 ** 2, G: 1024 ** 3 };

const TYPES: Readonly<Record<string, Stat['type'] | null>> = { f: 'file', d: 'directory', l: 'symlink', c: 'device', b: null, p: null, s: null, D: null };

/** Words that are an expression's own, not a predicate. */
const OPERATORS = new Set(['(', ')', '!', '-not', '-a', '-and', '-o', '-or', ',']);

/** Options that change the whole search, wherever they are; GNU warns when one follows a test. */
const GLOBAL = new Set(['-maxdepth', '-mindepth', '-depth', '-d', '-xdev', '-mount', '-noleaf', '-ignore_readdir_race', '-noignore_readdir_race', '-follow']);

class Finder {
  maxDepth = Number.POSITIVE_INFINITY;
  minDepth = 0;
  depthFirst = false;
  follow: 'P' | 'H' | 'L' = 'P';
  /** An action other than -prune and -quit was given, so -print is not implied. */
  acted = false;
  /** A test or action came before a global option. */
  private lastPositional: string | null = null;
  readonly batches: Batch[] = [];
  readonly warnings: string[] = [];
  status = 0;
  quit = false;
  private i = 0;
  /** The predicate whose argument was the last word read, for the unquoted-pattern hint. */
  private lastArgOf: string | null = null;

  constructor(
    private readonly ctx: CommandContext,
    private readonly words: readonly string[],
  ) {}

  private peek(): string | undefined {
    return this.words[this.i];
  }

  private next(): string | undefined {
    const word = this.words[this.i];
    this.i += 1;
    return word;
  }

  /** The argument a predicate takes. */
  private argument(predicate: string): string {
    const word = this.next();
    if (word === undefined) throw new FindError(`missing argument to \`${predicate}'`);
    this.lastArgOf = predicate;
    return word;
  }

  parse(): Expr | null {
    if (this.i >= this.words.length) return null;
    const expr = this.parseOr();
    const left = this.peek();
    if (left === ')') throw new FindError("invalid expression; you have too many ')'");
    if (left !== undefined) throw new FindError(`unexpected extra predicate '${left}'`);
    return expr;
  }

  private atEnd(): boolean {
    const word = this.peek();
    return word === undefined || word === ')';
  }

  private parseOr(): Expr {
    let left = this.parseAnd();
    for (let word = this.peek(); word === '-o' || word === '-or' || word === ','; word = this.peek()) {
      this.next();
      if (this.atEnd()) throw new FindError(`invalid expression; you have used a binary operator '${word}' with nothing after it.`);
      const right = this.parseAnd();
      // A comma evaluates both sides and is worth the second.
      left = word === ',' ? { kind: 'and', left: { kind: 'or', left, right: TRUE }, right } : { kind: 'or', left, right };
    }
    return left;
  }

  private parseAnd(): Expr {
    let left = this.parseNot();
    for (let word = this.peek(); word !== undefined && word !== ')' && word !== '-o' && word !== '-or' && word !== ','; word = this.peek()) {
      if (word === '-a' || word === '-and') {
        this.next();
        if (this.atEnd() || this.peek() === '-o' || this.peek() === '-or') {
          throw new FindError(`invalid expression; you have used a binary operator '${word}' with nothing after it.`);
        }
      }
      left = { kind: 'and', left, right: this.parseNot() };
    }
    return left;
  }

  private parseNot(): Expr {
    const word = this.peek();
    if (word === '!' || word === '-not') {
      this.next();
      if (this.atEnd()) throw new FindError(`expected an expression after '${word}'`);
      return { kind: 'not', expr: this.parseNot() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Expr {
    const word = this.next();
    if (word === undefined) throw new FindError('expected an expression');
    if (word === '(') {
      if (this.peek() === ')') throw new FindError('invalid expression; empty parentheses are not allowed.');
      const inner = this.parseOr();
      if (this.next() !== ')') throw new FindError("invalid expression; I was expecting to find a ')' somewhere but did not see one.");
      return inner;
    }
    if (word === ')') throw new FindError("invalid expression; you have too many ')'");
    if (word === '-a' || word === '-and' || word === '-o' || word === '-or' || word === ',') {
      throw new FindError(`invalid expression; you have used a binary operator '${word}' with nothing before it.`);
    }
    if (!word.startsWith('-') || word === '-') {
      const hint = this.lastArgOf !== null && ['-name', '-iname', '-path', '-ipath', '-wholename', '-iwholename'].includes(this.lastArgOf);
      throw new FindError(`paths must precede expression: \`${word}'${hint ? `\npossible unquoted pattern after predicate \`${this.lastArgOf ?? ''}'?` : ''}`);
    }
    this.lastArgOf = null;
    if (GLOBAL.has(word)) {
      if (this.lastPositional !== null) {
        this.warnings.push(
          `warning: you have specified the global option ${word} after the argument ${this.lastPositional}, but global options are not positional, i.e., ${word} affects tests specified before it as well as those specified after it.  Please specify global options before other arguments.`,
        );
      }
      this.globalOption(word);
      return TRUE;
    }
    this.lastPositional = word;
    return this.predicate(word);
  }

  private depthArgument(word: string): number {
    const text = this.argument(word);
    if (!/^\d+$/.test(text)) throw new FindError(`Expected a positive decimal integer argument to ${word}, but got '${text}'`);
    return Number(text);
  }

  private globalOption(word: string): void {
    if (word === '-maxdepth') this.maxDepth = this.depthArgument(word);
    else if (word === '-mindepth') this.minDepth = this.depthArgument(word);
    else if (word === '-depth' || word === '-d') this.depthFirst = true;
    else if (word === '-follow') this.follow = 'L';
  }

  private number(word: string): Comparison {
    const text = this.argument(word);
    const match = /^([+-]?)(\d+)$/.exec(text);
    if (match === null) throw new FindError(`invalid argument \`${text}' to \`${word}'`);
    return { op: (match[1] || '=') as Comparison['op'], n: Number(match[2]) };
  }

  private primary(name: string, test: (visit: Visit) => Result): Expr {
    return { kind: 'primary', name, test };
  }

  private predicate(word: string): Expr {
    const ctx = this.ctx;
    const now = ctx.clock.now();
    switch (word) {
      case '-name':
      case '-iname': {
        const pattern = this.argument(word);
        const fold = word === '-iname';
        return this.primary(word, (visit) => fnmatch(pattern, visit.name, fold));
      }
      case '-path':
      case '-wholename':
      case '-ipath':
      case '-iwholename': {
        const pattern = this.argument(word);
        const fold = word.startsWith('-i');
        return this.primary(word, (visit) => fnmatch(pattern, visit.shown, fold));
      }
      case '-type': {
        const text = this.argument(word);
        const wanted = new Set<Stat['type'] | null>();
        for (const letter of text.split(',')) {
          if (letter.length !== 1 || !Object.prototype.hasOwnProperty.call(TYPES, letter)) {
            throw new FindError(`Unknown argument to -type: ${letter}`);
          }
          wanted.add(TYPES[letter] ?? null);
        }
        return this.primary(word, (visit) => wanted.has(visit.stat.type));
      }
      case '-size': {
        const text = this.argument(word);
        const match = /^([+-]?)(\d+)(.?)$/.exec(text);
        if (match === null) throw new FindError(`invalid argument \`${text}' to \`-size'`);
        const unit = SIZE_UNITS[match[3] || 'b'];
        if (unit === undefined) throw new FindError(`invalid -size type \`${match[3] ?? ''}'`);
        const by: Comparison = { op: (match[1] || '=') as Comparison['op'], n: Number(match[2]) };
        return this.primary(word, (visit) => compare(Math.ceil(visit.stat.size / unit), by));
      }
      case '-empty':
        return this.primary(word, (visit) => {
          if (visit.stat.type === 'file') return visit.stat.size === 0;
          if (visit.stat.type !== 'directory') return false;
          try {
            return ctx.fs.readdir(visit.path, { all: true }).length === 0;
          } catch {
            return false;
          }
        });
      case '-newer': {
        const reference = this.argument(word);
        let mtime: number;
        try {
          mtime = ctx.fs.stat(ctx.resolve(reference)).mtime;
        } catch (error) {
          throw new FindError(`'${reference}': ${reason(error)}`);
        }
        return this.primary(word, (visit) => visit.stat.mtime > mtime);
      }
      case '-mtime':
      case '-ctime':
      case '-atime': {
        const by = this.number(word);
        return this.primary(word, (visit) => compare(Math.floor((now - visit.stat.mtime) / 86_400_000), by));
      }
      case '-mmin':
      case '-cmin':
      case '-amin': {
        const by = this.number(word);
        return this.primary(word, (visit) => compare(Math.floor((now - visit.stat.mtime) / 60_000), by));
      }
      case '-user': {
        const name = this.argument(word);
        const account = ACCOUNTS.find((found) => found.name === name);
        if (account === undefined && !/^\d+$/.test(name)) throw new FindError(`'${name}' is not the name of a known user`);
        const uid = account?.uid ?? Number(name);
        return this.primary(word, (visit) => visit.stat.uid === uid);
      }
      case '-group': {
        const name = this.argument(word);
        const group = GROUPS.find((found) => found.name === name);
        if (group === undefined && !/^\d+$/.test(name)) throw new FindError(`'${name}' is not the name of an existing group`);
        const gid = group?.gid ?? Number(name);
        return this.primary(word, (visit) => visit.stat.gid === gid);
      }
      case '-uid': {
        const by = this.number(word);
        return this.primary(word, (visit) => compare(visit.stat.uid, by));
      }
      case '-gid': {
        const by = this.number(word);
        return this.primary(word, (visit) => compare(visit.stat.gid, by));
      }
      case '-nouser':
        return this.primary(word, (visit) => !ACCOUNTS.some((account) => account.name === visit.stat.owner));
      case '-nogroup':
        return this.primary(word, (visit) => !GROUPS.some((group) => group.name === visit.stat.group));
      case '-links': {
        const by = this.number(word);
        return this.primary(word, (visit) => compare(visit.stat.nlink, by));
      }
      case '-perm': {
        const text = this.argument(word);
        // -MODE all of the bits, /MODE any of them; +MODE is an ordinary symbolic mode, as in GNU find now.
        const kind = text.charAt(0);
        const body = kind === '-' || kind === '/' ? text.slice(1) : text;
        const mode = compileMode(body);
        if (mode === null) throw new FindError(`invalid mode '${text}'`);
        const bits = applyMode(mode, 0, false, 0);
        if (kind === '-') return this.primary(word, (visit) => (visit.stat.mode & bits) === bits);
        if (kind === '/') return this.primary(word, (visit) => bits === 0 || (visit.stat.mode & bits) !== 0);
        return this.primary(word, (visit) => (visit.stat.mode & 0o7777) === bits);
      }
      case '-readable':
      case '-writable':
      case '-executable': {
        const want = word === '-readable' ? 'r' : word === '-writable' ? 'w' : 'x';
        return this.primary(word, (visit) => ctx.fs.access(visit.path, want));
      }
      case '-true':
        return TRUE;
      case '-false':
        return this.primary(word, () => false);
      case '-print':
        this.acted = true;
        return this.primary(word, async (visit) => {
          await ctx.stdout.write(`${visit.shown}\n`);
          return true;
        });
      case '-print0':
        this.acted = true;
        return this.primary(word, async (visit) => {
          await ctx.stdout.write(`${visit.shown}\0`);
          return true;
        });
      case '-ls':
        this.acted = true;
        return this.primary(word, async (visit) => {
          await ctx.stdout.write(`${this.listing(visit)}\n`);
          return true;
        });
      case '-delete':
        this.acted = true;
        this.depthFirst = true;
        return this.primary(word, (visit) => this.remove(visit));
      case '-prune':
        return this.primary(word, (visit) => {
          visit.pruned = true;
          return true;
        });
      case '-quit':
        return this.primary(word, () => {
          this.quit = true;
          return true;
        });
      case '-exec':
      case '-ok':
        this.acted = true;
        return this.exec(word);
      default:
        throw new FindError(`unknown predicate \`${word}'`);
    }
  }

  /** -exec COMMAND ; and -exec COMMAND {} +, and -ok COMMAND ;. */
  private exec(word: string): Expr {
    const command: string[] = [];
    for (;;) {
      const arg = this.next();
      if (arg === undefined) throw new FindError(`missing argument to \`${word}'`);
      if (arg === ';') break;
      if (arg === '+' && command[command.length - 1] === '{}' && word === '-exec') {
        command.pop();
        if (command.length === 0) throw new FindError(`missing argument to \`${word}'`);
        if (command.includes('{}')) throw new FindError('Only one instance of {} is supported with -exec ... +');
        const batch: Batch = { command, paths: [], size: 0 };
        this.batches.push(batch);
        return this.primary(word, async (visit) => {
          batch.paths.push(visit.shown);
          batch.size += visit.shown.length + 1;
          if (batch.paths.length >= BATCH_NAMES || batch.size >= BATCH_CHARS) await this.flush(batch);
          return true;
        });
      }
      command.push(arg);
    }
    if (command.length === 0) throw new FindError(`missing argument to \`${word}'`);
    return this.primary(word, async (visit) => {
      const line = command.map((arg) => arg.split('{}').join(visit.shown));
      if (word === '-ok') {
        const answer = await this.ctx.tty.readLine({ prompt: `< ${command[0] ?? ''} ... ${visit.shown} > ? ` });
        if (answer === null || !/^\s*[yY]/.test(answer)) return false;
      }
      return (await this.runLine(line)) === 0;
    });
  }

  /** True when `name` is something -exec can run: a command, or a program file. */
  private runnable(name: string): boolean {
    const ctx = this.ctx;
    if (!name.includes('/')) return ctx.shell.registry.get(name) !== undefined || searchPath(ctx, name, false).length > 0;
    try {
      const path = ctx.resolve(name);
      return ctx.fs.stat(path).type === 'file' && ctx.fs.access(path, 'x');
    } catch {
      return false;
    }
  }

  /**
   * Runs a command as find runs a program: on its own, in a pipeline stage, so a cd or an export
   * there leaves the shell as it was, and reading nothing, as -ok's does.
   */
  private async runLine(words: readonly string[]): Promise<ExitCode> {
    const ctx = this.ctx;
    const name = words[0] ?? '';
    if (!this.runnable(name)) {
      await ctx.fail(`'${name}': No such file or directory`);
      this.status = 1;
      return EXIT.notFound;
    }
    const status = await ctx.shell.exec(`true | ${words.map(shellQuote).join(' ')}`, { stdin: ctx.stdin, stdout: ctx.stdout, stderr: ctx.stderr });
    if (ctx.signal.aborted) throw ctx.signal.reason;
    return status;
  }

  /** Runs a -exec ... + command on the names gathered, if any. */
  async flush(batch: Batch): Promise<void> {
    if (batch.paths.length === 0) return;
    const paths = batch.paths;
    batch.paths = [];
    batch.size = 0;
    if ((await this.runLine([...batch.command, ...paths])) !== 0) this.status = 1;
  }

  private async remove(visit: Visit): Promise<boolean> {
    // `find . -delete` empties the folder but leaves `.` itself, as GNU find does.
    if (visit.shown === '.' || visit.shown === './') return true;
    try {
      if (visit.stat.type === 'directory') this.ctx.fs.rmdir(visit.path);
      else this.ctx.fs.rm(visit.path);
      return true;
    } catch (error) {
      await this.ctx.fail(`cannot delete '${visit.shown}': ${reason(error)}`);
      this.status = 1;
      return false;
    }
  }

  /** -ls: inode, blocks, mode, links, owner, group, size, date and path, as `ls -dils` has them. */
  private listing(visit: Visit): string {
    const { stat } = visit;
    const date = lsDate(stat.mtime, this.ctx.clock.now(), this.ctx.clock.timeZone());
    const head = `${String(inodeOf(stat.path)).padStart(9)} ${String(kibBlocks(stat)).padStart(6)} ${modeString(stat)} ${String(stat.nlink).padStart(3)} ${stat.owner.padEnd(8)} ${stat.group.padEnd(8)} ${String(stat.size).padStart(8)} ${date} ${visit.shown}`;
    return stat.type === 'symlink' ? `${head} -> ${stat.target ?? ''}` : head;
  }

  /** Reads the -H, -L and -P before the starting points, then the starting points. */
  readStart(): string[] {
    for (let word = this.peek(); word === '-H' || word === '-L' || word === '-P'; word = this.peek()) {
      this.follow = word.charAt(1) as 'H' | 'L' | 'P';
      this.next();
    }
    const starts: string[] = [];
    for (let word = this.peek(); word !== undefined && !OPERATORS.has(word) && !(word.startsWith('-') && word !== '-'); word = this.peek()) {
      starts.push(word);
      this.next();
    }
    return starts;
  }
}

const TRUE: Expr = { kind: 'primary', name: '-true', test: () => true };

async function evaluate(expr: Expr, visit: Visit, finder: Finder): Promise<boolean> {
  if (finder.quit) return false;
  switch (expr.kind) {
    case 'and':
      return (await evaluate(expr.left, visit, finder)) && (await evaluate(expr.right, visit, finder));
    case 'or':
      return (await evaluate(expr.left, visit, finder)) || (await evaluate(expr.right, visit, finder));
    case 'not':
      return !(await evaluate(expr.expr, visit, finder));
    case 'primary':
      return expr.test(visit);
  }
}

/** The last name of a path as typed: `.` for `.`, `docs` for `docs/`. */
function lastName(typed: string): string {
  const trimmed = typed.replace(/\/+$/, '');
  if (trimmed === '') return '/';
  return trimmed.slice(trimmed.lastIndexOf('/') + 1);
}

async function walk(
  ctx: CommandContext,
  finder: Finder,
  expr: Expr,
  path: string,
  shown: string,
  name: string,
  depth: number,
  ancestors: readonly string[],
): Promise<void> {
  if (ctx.signal.aborted) throw ctx.signal.reason;
  if (finder.quit) return;
  let stat: Stat;
  try {
    stat = ctx.fs.lstat(path);
    const follow = finder.follow === 'L' || (finder.follow === 'H' && depth === 0);
    if (follow && stat.type === 'symlink') {
      try {
        stat = ctx.fs.stat(path);
      } catch {
        // A link to nothing stays a link, as -L leaves it.
      }
    }
  } catch (error) {
    await ctx.fail(`'${shown}': ${reason(error)}`);
    finder.status = 1;
    return;
  }
  const visit: Visit = { path, shown, name, depth, stat, pruned: false };
  if (!finder.depthFirst && depth >= finder.minDepth) await evaluate(expr, visit, finder);
  if (stat.type === 'directory' && depth < finder.maxDepth && !visit.pruned && !finder.quit) {
    let real = path;
    if (finder.follow !== 'P') {
      try {
        real = ctx.fs.realpath(path);
      } catch {
        real = path;
      }
    }
    const loop = ancestors.indexOf(real);
    if (loop !== -1) {
      await ctx.fail(`File system loop detected; '${shown}' is part of the same file system loop as '${shownAncestor(shown, ancestors.length - loop)}'.`);
      finder.status = 1;
    } else {
      let names: string[] | null = null;
      try {
        names = ctx.fs.readdir(path, { all: true });
      } catch (error) {
        await ctx.fail(`'${shown}': ${reason(error)}`);
        finder.status = 1;
      }
      for (const child of names ?? []) {
        if (finder.quit) break;
        await walk(ctx, finder, expr, `${path === '/' ? '' : path}/${child}`, childPath(shown, child), child, depth + 1, [...ancestors, real]);
      }
    }
  }
  if (finder.depthFirst && depth >= finder.minDepth && !finder.quit) await evaluate(expr, visit, finder);
}

/** The path `up` folders above `shown`, as it was printed. */
function shownAncestor(shown: string, up: number): string {
  let at = shown;
  for (let i = 0; i < up; i += 1) at = at.slice(0, Math.max(at.lastIndexOf('/'), 0)) || '/';
  return at;
}

export async function run(ctx: CommandContext): Promise<ExitCode> {
  const first = ctx.args[0];
  if (first === '--help' || first === '-h') {
    const { commandHelp, withDoc } = await import('../../../shell/help');
    for (const block of commandHelp(await withDoc(ctx.spec))) await ctx.stdout.block(block);
    return 0;
  }
  const finder = new Finder(ctx, ctx.args);
  let expr: Expr | null;
  let starts: string[];
  try {
    starts = finder.readStart();
    expr = finder.parse();
  } catch (error) {
    if (!(error instanceof FindError)) throw error;
    for (const line of error.message.split('\n')) await ctx.stderr.line(out.span(`find: ${line}`, { fg: 'error' }));
    return 1;
  }
  for (const warning of finder.warnings) await ctx.stderr.line(out.span(`find: ${warning}`, { fg: 'warn' }));
  const print: Expr = {
    kind: 'primary',
    name: '-print',
    test: async (visit) => {
      await ctx.stdout.write(`${visit.shown}\n`);
      return true;
    },
  };
  const whole: Expr = expr === null ? print : finder.acted ? expr : { kind: 'and', left: expr, right: print };
  for (const typed of starts.length === 0 ? ['.'] : starts) {
    if (finder.quit) break;
    const path = ctx.resolve(typed);
    try {
      ctx.fs.lstat(path);
    } catch (error) {
      await ctx.fail(`'${typed}': ${reason(error)}`);
      finder.status = 1;
      continue;
    }
    await walk(ctx, finder, whole, path, typed, lastName(typed), 0, []);
  }
  for (const batch of finder.batches) await finder.flush(batch);
  return finder.status;
}
