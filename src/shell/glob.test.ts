import { describe, expect, it } from 'vitest';
import { treeFs } from '../testing/tree-fs';
import { compareNames, createGlobber, escapeGlob, glob, globMatch, hasGlob, unescapeGlob } from './glob';

const fs = treeFs({
  home: {
    guest: {
      'README.md': '',
      'history.txt': '',
      'linux.txt': '',
      '.bashrc': '',
      '.ssh': { config: '' },
      bin: {},
      documents: { 'linux.txt': '', 'notes.md': '', '.hidden': '' },
      projects: { vesen: { 'README.md': '' }, site: {} },
      'a*b': '',
    },
    has: { 'about.md': '' },
  },
  etc: { hostname: '', hosts: '', passwd: '' },
});
const home = '/home/guest';

describe('globMatch', () => {
  const cases: [string, string, boolean][] = [
    ['*', 'a', true],
    ['*', '', true],
    ['*', '.a', false],
    ['.*', '.a', true],
    ['\\.*', '.a', true],
    ['?a', '.a', false],
    ['[.]a', '.a', false],
    ['a?c', 'abc', true],
    ['a?c', 'ac', false],
    ['a*', 'a', true],
    ['*.t?t', 'notes.txt', true],
    ['a*b*c', 'aXXbYYc', true],
    ['a*b*c', 'aXXbYY', false],
    ['*a*a*a*a*b', 'aaaaaaaaaaaaaaaaaaaaaaaa', false],
    ['[abc]x', 'bx', true],
    ['[a-c]x', 'dx', false],
    ['[a-c]x', 'cx', true],
    ['[!a]x', 'bx', true],
    ['[!a]x', 'ax', false],
    ['[^a]x', 'ax', false],
    ['[]]', ']', true],
    ['[!]]', 'a', true],
    ['[a-]', '-', true],
    ['[[:digit:]]*', '1st', true],
    ['[[:upper:]]*', 'README', true],
    ['[[:upper:]]*', 'readme', false],
    ['[[:alpha:]]', 'é', true],
    ['\\*', '*', true],
    ['\\*', 'a', false],
    ['a\\?', 'a?', true],
    ['[', '[', true],
    ['[a', '[a', true],
    ['?', '🐟', true],
    ['🐟*', '🐟.png', true],
    ['?', 'ab', false],
  ];
  it.each(cases)('%j against %j is %s', (pattern, name, expected) => {
    expect(globMatch(pattern, name)).toBe(expected);
  });
});

describe('hasGlob and escaping', () => {
  it.each([
    ['*', true],
    ['a?', true],
    ['[ab]', true],
    ['x/[!a]', true],
    ['\\*', false],
    ['[', false],
    ['a]', false],
    ['abc', false],
    ['~/x', false],
  ] as const)('%j → %s', (pattern, expected) => {
    expect(hasGlob(pattern)).toBe(expected);
  });

  it('escapes and unescapes the special characters', () => {
    expect(escapeGlob('a*b?[c]\\')).toBe('a\\*b\\?\\[c\\]\\\\');
    expect(unescapeGlob(escapeGlob('a*b?[c]\\'))).toBe('a*b?[c]\\');
    expect(hasGlob(escapeGlob('*?['))).toBe(false);
  });
});

describe('glob', () => {
  const cases: [string, string, string[]][] = [
    ['*.txt', home, ['history.txt', 'linux.txt']],
    ['*', home, ['a*b', 'bin', 'documents', 'history.txt', 'linux.txt', 'projects', 'README.md']],
    ['.*', home, ['.bashrc', '.ssh']],
    ['*/', home, ['bin/', 'documents/', 'projects/']],
    ['documents/*', home, ['documents/linux.txt', 'documents/notes.md']],
    ['documents/.*', home, ['documents/.hidden']],
    ['*/*.txt', home, ['documents/linux.txt']],
    ['projects/*/README.md', home, ['projects/vesen/README.md']],
    ['projects/*/', home, ['projects/site/', 'projects/vesen/']],
    ['/etc/host*', '/', ['/etc/hostname', '/etc/hosts']],
    ['/home/*/about.md', '/', ['/home/has/about.md']],
    ['../has/*', home, ['../has/about.md']],
    ['./*.md', home, ['./README.md']],
    ['[hl]*', home, ['history.txt', 'linux.txt']],
    ['[!a-l]*', home, ['projects', 'README.md']],
    ['*.nope', home, []],
    ['nope/*', home, []],
    ['history.txt/*', home, []],
    ['a\\*b', home, ['a*b']],
    ['*/*/*', '/home', ['guest/documents/linux.txt', 'guest/documents/notes.md', 'guest/projects/site', 'guest/projects/vesen']],
    ['*/*/*/*', '/home', ['guest/projects/vesen/README.md']],
  ];
  it.each(cases)('%j in %j', (pattern, cwd, expected) => {
    expect(glob(pattern, cwd, fs)).toEqual(expected);
  });

  it('binds a directory with createGlobber', () => {
    expect(createGlobber('/etc', fs)('p*')).toEqual(['passwd']);
  });
});

describe('compareNames', () => {
  it('sorts as an English locale does: dots ignored, case folded, lower case first', () => {
    const names = ['src', 'README.md', '.bashrc', 'bin', 'Bin', 'b', 'history.txt', 'a-b', 'ab'];
    expect([...names].sort(compareNames)).toEqual(['a-b', 'ab', 'b', '.bashrc', 'bin', 'Bin', 'history.txt', 'README.md', 'src']);
  });
});
