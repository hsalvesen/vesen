// test and [: evaluate a condition and exit 0 when it holds, 1 when it does not and 2 on a
// mistake, as bash's builtin does. With && and || it stands in for if, which vesen does not have:
//
//   [ -f notes.txt ] && cat notes.txt || echo 'no notes'
//
// The grammar is POSIX test's with bash's extras: ! ( ) -a -o, the file tests, the string and
// integer comparisons, and -nt -ot -ef.

import type { RawArgsSpec } from '../../shell/flags';
import { defineCommand, type CommandContext, type CommandSpec, type RunnerChoice } from '../../shell/types';
import type { Stat } from '../../vfs/types';

/** A mistake in the expression; test exits 2. */
export class TestError extends Error {}

const UNARY = new Set(['-e', '-f', '-d', '-r', '-w', '-x', '-s', '-L', '-h', '-b', '-c', '-p', '-S', '-g', '-u', '-k', '-O', '-G', '-N', '-t', '-z', '-n']);
const BINARY = new Set(['=', '==', '!=', '<', '>', '-eq', '-ne', '-lt', '-le', '-gt', '-ge', '-nt', '-ot', '-ef']);

const INTEGER = /^\s*[+-]?\d+\s*$/;

/** What the expression needs from the world: files, and whether a descriptor is a terminal. */
export interface TestWorld {
  stat(path: string): Stat | null;
  lstat(path: string): Stat | null;
  access(path: string, want: 'r' | 'w' | 'x'): boolean;
  realpath(path: string): string | null;
  isTerminal(fd: number): boolean;
  readonly uid: number;
  readonly gid: number;
}

function integer(text: string): number {
  if (!INTEGER.test(text)) throw new TestError(`${text}: integer expression expected`);
  return Number(text.trim());
}

function unary(op: string, operand: string, world: TestWorld): boolean {
  switch (op) {
    case '-z':
      return operand === '';
    case '-n':
      return operand !== '';
    case '-t':
      return world.isTerminal(integer(operand));
    case '-L':
    case '-h':
      return world.lstat(operand)?.type === 'symlink';
  }
  const stat = world.stat(operand);
  if (stat === null) return false;
  switch (op) {
    case '-e':
      return true;
    case '-f':
      return stat.type === 'file';
    case '-d':
      return stat.type === 'directory';
    case '-c':
      return stat.type === 'device';
    case '-b':
    case '-p':
    case '-S':
      return false;
    case '-r':
    case '-w':
    case '-x':
      return world.access(operand, op.charAt(1) as 'r' | 'w' | 'x');
    case '-s':
      return stat.size > 0;
    case '-g':
      return (stat.mode & 0o2000) !== 0;
    case '-u':
      return (stat.mode & 0o4000) !== 0;
    case '-k':
      return (stat.mode & 0o1000) !== 0;
    case '-O':
      return stat.uid === world.uid;
    case '-G':
      return stat.gid === world.gid;
    case '-N':
      return false;
  }
  return false;
}

function binary(left: string, op: string, right: string, world: TestWorld): boolean {
  switch (op) {
    case '=':
    case '==':
      return left === right;
    case '!=':
      return left !== right;
    case '<':
      return left < right;
    case '>':
      return left > right;
    case '-eq':
      return integer(left) === integer(right);
    case '-ne':
      return integer(left) !== integer(right);
    case '-lt':
      return integer(left) < integer(right);
    case '-le':
      return integer(left) <= integer(right);
    case '-gt':
      return integer(left) > integer(right);
    case '-ge':
      return integer(left) >= integer(right);
    case '-nt':
    case '-ot': {
      const a = world.stat(left);
      const b = world.stat(right);
      if (op === '-nt') return a !== null && (b === null || a.mtime > b.mtime);
      return b !== null && (a === null || a.mtime < b.mtime);
    }
    case '-ef': {
      const a = world.realpath(left);
      return a !== null && a === world.realpath(right);
    }
  }
  throw new TestError(`${op}: binary operator expected`);
}

/** Evaluates test's words. Throws TestError for a malformed expression. */
export function evaluate(words: readonly string[], world: TestWorld): boolean {
  let i = 0;
  const peek = (offset = 0): string | undefined => words[i + offset];

  const primary = (): boolean => {
    const word = peek();
    if (word === undefined) throw new TestError('argument expected');
    if (word === '(') {
      i += 1;
      const value = or();
      if (peek() !== ')') throw new TestError("')' expected");
      i += 1;
      return value;
    }
    // `a = b`: a binary operator in the middle wins, as POSIX reads three words.
    const op = peek(1);
    if (op !== undefined && BINARY.has(op) && peek(2) !== undefined) {
      i += 3;
      return binary(word, op, words[i - 1] ?? '', world);
    }
    if (UNARY.has(word) && peek(1) !== undefined) {
      i += 2;
      return unary(word, words[i - 1] ?? '', world);
    }
    i += 1;
    return word !== '';
  };

  const not = (): boolean => {
    if (peek() === '!' && peek(1) !== undefined) {
      i += 1;
      return !not();
    }
    return primary();
  };

  const and = (): boolean => {
    let value = not();
    while (peek() === '-a') {
      i += 1;
      const right = not();
      value = value && right;
    }
    return value;
  };

  const or = (): boolean => {
    let value = and();
    while (peek() === '-o') {
      i += 1;
      const right = and();
      value = value || right;
    }
    return value;
  };

  if (words.length === 0) return false;
  const value = or();
  if (i < words.length) throw new TestError(`${words[i] ?? ''}: unexpected argument`);
  return value;
}

/** The world as the command sees it: the VFS from the working directory, as the visitor. */
function worldOf(ctx: CommandContext): TestWorld {
  const quietly = <T>(fn: () => T): T | null => {
    try {
      return fn();
    } catch {
      return null;
    }
  };
  return {
    stat: (path) => quietly(() => ctx.fs.stat(ctx.resolve(path))),
    lstat: (path) => quietly(() => ctx.fs.lstat(ctx.resolve(path))),
    access: (path, want) => ctx.fs.access(ctx.resolve(path), want),
    realpath: (path) => quietly(() => ctx.fs.realpath(ctx.resolve(path))),
    isTerminal: (fd) => (fd === 0 ? ctx.stdin.isTTY : fd === 1 ? ctx.stdout.isTTY : fd === 2 ? ctx.stderr.isTTY : false),
    uid: ctx.user.uid,
    gid: ctx.user.gid,
  };
}

const spec: CommandSpec & RawArgsSpec & RunnerChoice = {
  name: 'test',
  aliases: ['['],
  category: 'shell',
  summary: 'check a condition: files, strings, numbers',
  synopsis: ['test EXPRESSION', '[ EXPRESSION ]'],
  description:
    "Exits 0 when EXPRESSION is true, 1 when it is false and 2 when it is malformed, printing nothing. With && and || it stands in for if: [ -d projects ] && cd projects. '[' needs a closing ']'.",
  rawArgs: true,
  handlesHelp: true,
  args: [{ name: 'EXPRESSION', source: { kind: 'free', placeholder: 'expression' }, optional: true, variadic: true }],
  man: [
    {
      heading: 'FILES',
      body: '-e FILE exists; -f a regular file; -d a directory; -L or -h a symbolic link; -c a character device; -r, -w, -x readable, writable, executable by you; -s not empty; -O, -G owned by your user, your group; FILE1 -nt FILE2 newer, -ot older, -ef the same file.',
    },
    {
      heading: 'STRINGS AND NUMBERS',
      body: '-z STRING empty; -n STRING, or STRING alone, not empty; S1 = S2, S1 != S2, S1 < S2, S1 > S2; N1 -eq N2, -ne, -lt, -le, -gt, -ge for whole numbers.',
    },
    { heading: 'COMBINING', body: '! EXPR not; EXPR1 -a EXPR2 and; EXPR1 -o EXPR2 or; ( EXPR ) groups.' },
  ],
  examples: [
    { line: '[ -f README.md ] && echo yes', offline: true },
    { line: 'test -d projects && cd projects', offline: true },
    { line: '[ 3 -gt 2 ] && echo bigger', offline: true },
    { line: '[ -z "$NOPE" ] && echo empty', offline: true },
  ],
  seeAlso: ['true', 'false'],
  async run(ctx) {
    let words = [...ctx.args];
    if (ctx.name === '[') {
      if (words[words.length - 1] !== ']') return ctx.fail("missing `]'", 2);
      words = words.slice(0, -1);
    }
    try {
      return evaluate(words, worldOf(ctx)) ? 0 : 1;
    } catch (error) {
      if (error instanceof TestError) return ctx.fail(error.message, 2);
      throw error;
    }
  },
};

export default defineCommand(spec);
