import { describe, expect, it } from 'vitest';
import { treeFs } from '../testing/tree-fs';
import { ExpandError, Expander, isParamName, type ExpandOptions } from './expand';
import { createGlobber } from './glob';
import type { WordToken } from './lexer-types';
import { lex } from './lexer';
import { parse } from './parser';

const fs = treeFs({
  home: {
    guest: {
      'README.md': '',
      'history.txt': '',
      'linux.txt': '',
      '.bashrc': '',
      '.ssh': {},
      documents: { 'notes.md': '' },
    },
    has: {},
  },
});

interface Setup {
  readonly expander: Expander;
  readonly store: Map<string, string>;
  readonly commands: string[];
}

function setup(over: Partial<ExpandOptions> = {}, variables: Record<string, string> = {}): Setup {
  const store = new Map(Object.entries({ HOME: '/home/guest', PWD: '/home/guest', USER: 'guest', ...variables }));
  const commands: string[] = [];
  const expander = new Expander({
    vars: { get: (name) => store.get(name), set: (name, value) => void store.set(name, value) },
    status: 0,
    pid: 4242,
    argv0: 'vesen',
    args: [],
    home: '/home/guest',
    cwd: '/home/guest',
    userHome: (user) => ({ guest: '/home/guest', has: '/home/has', root: '/root' } as Record<string, string | undefined>)[user],
    random: () => 0.5,
    glob: createGlobber('/home/guest', fs),
    exec: async (source) => {
      commands.push(source);
      return { stdout: `<${source}>\n\n`, status: source.startsWith('false') ? 1 : 0 };
    },
    ...over,
  });
  return { expander, store, commands };
}

/** The first word token on a line. */
function firstWord(line: string): WordToken {
  const token = lex(line).tokens[0];
  if (token?.kind !== 'word') throw new Error(`no word in ${line}`);
  return token;
}

/** Expands every word on a line, as the arguments of one command. */
async function fields(line: string, over?: Partial<ExpandOptions>, variables?: Record<string, string>): Promise<string[]> {
  const words = lex(line).tokens.filter((t) => t.kind === 'word');
  return setup(over, variables).expander.fields(words);
}

describe('tilde expansion', () => {
  const cases: [string, string[], Record<string, string>?][] = [
    ['~', ['/home/guest']],
    ['~/x', ['/home/guest/x']],
    ['~guest', ['/home/guest']],
    ['~has/about.md', ['/home/has/about.md']],
    ['~root', ['/root']],
    ['~nobody/x', ['~nobody/x']],
    ['~+', ['/tmp'], { PWD: '/tmp' }],
    ['~-', ['/etc'], { OLDPWD: '/etc' }],
    ['~-', ['~-']],
    ['~', ['/srv'], { HOME: '/srv' }],
    ['"~"', ['~']],
    ["'~'/x", ['~/x']],
    ['\\~', ['~']],
    ['a~', ['a~']],
    ['x=~/a:~/b', ['x=/home/guest/a:/home/guest/b']],
  ];
  it.each(cases)('%j → %j', async (line, expected, variables) => {
    expect(await fields(line, {}, variables)).toEqual(expected);
  });

  it('expands a tilde in an assignment value', async () => {
    const r = parse('P=~/bin:~has');
    if (!r.ok) throw new Error('expected a tree');
    const value = r.ast.items[0]?.node.first.cmds[0]?.assigns[0]?.value;
    if (value === undefined) throw new Error('expected an assignment');
    expect(await setup().expander.string(value)).toBe('/home/guest/bin:/home/has');
  });

  it('falls back to the passwd home when HOME is unset', async () => {
    const { expander, store } = setup();
    store.delete('HOME');
    expect(await expander.fields(lex('~').tokens.filter((t) => t.kind === 'word'))).toEqual(['/home/guest']);
  });
});

describe('parameter expansion', () => {
  const vars = { NAME: 'Has', EMPTY: '', SPACED: 'a  b' };
  const cases: [string, string[]][] = [
    ['$USER', ['guest']],
    ['${USER}x', ['guestx']],
    ['"hi $NAME"', ['hi Has']],
    ['$UNSET', []],
    ['"$UNSET"', ['']],
    ['a$UNSET', ['a']],
    ['$EMPTY', []],
    ['"$EMPTY"', ['']],
    ['${UNSET:-def}', ['def']],
    ['${EMPTY:-def}', ['def']],
    ['${NAME:-def}', ['Has']],
    ['${UNSET-def}', ['def']],
    ['${EMPTY-def}', []],
    ['"${EMPTY-def}"', ['']],
    ['${NAME:+set}', ['set']],
    ['${EMPTY:+set}', []],
    ['"${UNSET:+set}"', ['']],
    ['${UNSET:-a b}', ['a', 'b']],
    ['"${UNSET:-a b}"', ['a b']],
    ['${UNSET:-"a b"}', ['a b']],
    ['${UNSET:-$NAME}', ['Has']],
    ['${UNSET:-~/x}', ['/home/guest/x']],
    ['${UNSET:-}', []],
    ['"${UNSET:-}"', ['']],
    ['${#NAME}', ['3']],
    ['${#UNSET}', ['0']],
    ['${#SPACED}', ['4']],
    ['$PWD', ['/home/guest']],
    ['$RANDOM', ['16384']],
    ['$$', ['4242']],
    ['$0', ['vesen']],
    ['$#', ['0']],
    ['$1', []],
    ['$!', []],
    ['\\$NAME', ['$NAME']],
    ["'$NAME'", ['$NAME']],
    ['"\\$NAME"', ['$NAME']],
    ['$', ['$']],
    ['cost: $5', ['cost:']],
  ];
  it.each(cases)('%j → %j', async (line, expected) => {
    expect(await fields(line, {}, vars)).toEqual(expected);
  });

  it('assigns with ${X:=word}', async () => {
    const { expander, store } = setup();
    const words = lex('${N:=5} ${N:=6} ${E:="a b"}').tokens.filter((t) => t.kind === 'word');
    expect(await expander.fields(words)).toEqual(['5', '5', 'a', 'b']);
    expect(store.get('N')).toBe('5');
    expect(store.get('E')).toBe('a b');
  });

  it('reads $? as the status of the last command, including after a failure', async () => {
    expect(await fields('$?')).toEqual(['0']);
    expect(await fields('$?', { status: 1 })).toEqual(['1']);
    expect(await fields('"status=$?"', { status: 127 })).toEqual(['status=127']);
    expect(await fields('${?}', { status: 130 })).toEqual(['130']);
  });

  it('reads positional parameters, $# $@ and $*', async () => {
    const args = ['one', 'two words', ''];
    expect(await fields('$# $1 $2', { args })).toEqual(['3', 'one', 'two', 'words']);
    expect(await fields('"$2" ${3:-empty}', { args })).toEqual(['two words', 'empty']);
    expect(await fields('"$@"', { args })).toEqual(['one', 'two words', '']);
    expect(await fields('"x$@y"', { args })).toEqual(['xone', 'two words', 'y']);
    expect(await fields('"$@"', { args: [] })).toEqual([]);
    expect(await fields('$@', { args })).toEqual(['one', 'two', 'words']);
    expect(await fields('"$*"', { args })).toEqual(['one two words ']);
    expect(await fields('${#@}', { args })).toEqual(['3']);
    expect(await fields('${10}', { args: ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'ten'] })).toEqual(['ten']);
  });

  it('rejects ${…} forms it does not support, in bash words', async () => {
    await expect(fields('${x/a/b}')).rejects.toThrow(new ExpandError('${x/a/b}: not supported in vesen'));
    await expect(fields('${X:?unset}')).rejects.toThrow(new ExpandError('${X:?unset}: not supported in vesen'));
    await expect(fields('${!X}')).rejects.toThrow(new ExpandError('${!X}: not supported in vesen'));
    await expect(fields('${}')).rejects.toThrow(new ExpandError('${}: bad substitution'));
    await expect(fields('${ X}')).rejects.toThrow(new ExpandError('${ X}: bad substitution'));
    await expect(fields('${#X:-a}')).rejects.toThrow(ExpandError);
    await expect(fields('${1:=x}')).rejects.toThrow(new ExpandError('$1: cannot assign in this way'));
  });

  it('knows parameter names', () => {
    for (const name of ['X', '_a1', '1', '10', '?', '#', '$', '@', '*', '0', '!', '-']) expect(isParamName(name)).toBe(true);
    for (const name of ['', '1a', 'a-b', '??', 'x/y']) expect(isParamName(name)).toBe(false);
  });
});

describe('field splitting', () => {
  const cases: [string, Record<string, string>, string[]][] = [
    ['$X', { X: 'a  b' }, ['a', 'b']],
    ['"$X"', { X: 'a  b' }, ['a  b']],
    ['x${X}y', { X: 'a b' }, ['xa', 'by']],
    ['x${X}y', { X: ' a b ' }, ['x', 'a', 'b', 'y']],
    ['$X', { X: '  ' }, []],
    ['x${X}y', { X: '  ' }, ['x', 'y']],
    ['$X', { X: '\ta\nb\t' }, ['a', 'b']],
    ['$X', { X: 'a::b', IFS: ':' }, ['a', '', 'b']],
    ['$X', { X: ':a', IFS: ':' }, ['', 'a']],
    ['$X', { X: 'a:', IFS: ':' }, ['a']],
    ['x${X}y', { X: 'a:', IFS: ':' }, ['xa', 'y']],
    ['$X', { X: 'a : b', IFS: ' :' }, ['a', 'b']],
    ['$X', { X: 'a b', IFS: '' }, ['a b']],
    ['$X', { X: 'a b', IFS: ':' }, ['a b']],
    ['a\\ b', {}, ['a b']],
    ['"a b" c', {}, ['a b', 'c']],
    ['$X$Y', { X: 'a ', Y: ' b' }, ['a', 'b']],
    ['"$X"$Y', { X: 'a ', Y: ' b' }, ['a ', 'b']],
  ];
  it.each(cases)('%j with %j → %j', async (line, variables, expected) => {
    expect(await fields(line, {}, variables)).toEqual(expected);
  });

  it('does not split assignment values or here-string text', async () => {
    const { expander } = setup({}, { X: 'a  b' });
    expect(await expander.string(firstWord('$X$(x y)*'))).toBe('a  b<x y>*');
    expect(await expander.string(firstWord('$UNSET'))).toBe('');
  });
});

describe('command substitution', () => {
  it('runs the source and strips trailing newlines', async () => {
    const { expander, commands } = setup();
    const words = lex('$(ls -l) "$(a  b)" `date` $(c d)').tokens.filter((t) => t.kind === 'word');
    expect(await expander.fields(words)).toEqual(['<ls', '-l>', '<a  b>', '<date>', '<c', 'd>']);
    expect(commands).toEqual(['ls -l', 'a  b', 'date', 'c d']);
  });

  it('remembers the status of the last substitution', async () => {
    const { expander } = setup();
    expect(expander.substStatus).toBeNull();
    await expander.fields(lex('$(true)').tokens.filter((t) => t.kind === 'word'));
    expect(expander.substStatus).toBe(0);
    await expander.fields(lex('$(false)').tokens.filter((t) => t.kind === 'word'));
    expect(expander.substStatus).toBe(1);
  });

  it('fails plainly when no executor is wired in', async () => {
    await expect(fields('$(ls)', { exec: undefined })).rejects.toThrow(new ExpandError('command substitution is not available here'));
  });
});

describe('arithmetic expansion', () => {
  const cases: [string, string[], Record<string, string>?][] = [
    ['$((1+2))', ['3']],
    ['$(( X * 2 ))', ['42'], { X: '21' }],
    ['$(($X + 1))', ['22'], { X: '21' }],
    ['$((${X:-4} * 2))', ['8']],
    ['"$(( 7 / 2 ))"', ['3']],
    ['$((2**62))', ['4611686018427387904']],
    ['$(( $(n) + 1 ))', ['2'], {}],
    ['n$((-1))', ['n-1']],
  ];
  it.each(cases)('%j → %j', async (line, expected, variables) => {
    const exec = async (): Promise<{ stdout: string; status: number }> => ({ stdout: '1\n', status: 0 });
    expect(await fields(line, { exec }, variables)).toEqual(expected);
  });

  it('assigns through the shell variables', async () => {
    const { expander, store } = setup();
    await expander.fields(lex('$((n = 4)) $((n += 1))').tokens.filter((t) => t.kind === 'word'));
    expect(store.get('n')).toBe('5');
  });

  it('reports arithmetic errors as expansion errors', async () => {
    await expect(fields('$((1/0))')).rejects.toThrow(new ExpandError('1/0: division by 0 (error token is "0")'));
    await expect(fields('$((1 +))')).rejects.toThrow(ExpandError);
  });
});

describe('pathname expansion', () => {
  const cases: [string, string[], Record<string, string>?][] = [
    ['*.txt', ['history.txt', 'linux.txt']],
    ['*', ['documents', 'history.txt', 'linux.txt', 'README.md']],
    ['.*', ['.bashrc', '.ssh']],
    ['*.nope', ['*.nope']],
    ['[hl]*.txt', ['history.txt', 'linux.txt']],
    ['[!h]*.txt', ['linux.txt']],
    ['?????.txt', ['linux.txt']],
    ['documents/*', ['documents/notes.md']],
    ['~/*.md', ['/home/guest/README.md']],
    ['"*".txt', ['*.txt']],
    ["'*.txt'", ['*.txt']],
    ['\\*.txt', ['*.txt']],
    ['$P', ['history.txt', 'linux.txt'], { P: '*.txt' }],
    ['"$P"', ['*.txt'], { P: '*.txt' }],
    ['${P}x', ['*.txtx'], { P: '*.txt' }],
    ['x*', ['x*']],
  ];
  it.each(cases)('%j → %j', async (line, expected, variables) => {
    expect(await fields(line, {}, variables)).toEqual(expected);
  });

  it('leaves words alone with noglob or without a matcher', async () => {
    expect(await fields('*.txt', { noglob: true })).toEqual(['*.txt']);
    expect(await fields('*.txt', { glob: undefined })).toEqual(['*.txt']);
  });
});

describe('redirection targets', () => {
  it('expands to exactly one word', async () => {
    const { expander } = setup({}, { F: 'out.txt', TWO: 'a b' });
    expect(await expander.target(firstWord('~/$F'))).toBe('/home/guest/out.txt');
    expect(await expander.target(firstWord('"$TWO"'))).toBe('a b');
    expect(await expander.target(firstWord('README*'))).toBe('README.md');
    await expect(expander.target(firstWord('$TWO'))).rejects.toThrow('$TWO: ambiguous redirect');
    await expect(expander.target(firstWord('*.txt'))).rejects.toThrow('*.txt: ambiguous redirect');
    await expect(expander.target(firstWord('$UNSET'))).rejects.toBeInstanceOf(ExpandError);
  });
});
