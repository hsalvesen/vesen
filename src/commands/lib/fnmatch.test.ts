// find -name and tree -I's patterns (lib/fnmatch.ts): fnmatch(3) with no special leading dot.
import { describe, expect, it } from 'vitest';
import { fnmatch, matchesAny } from './fnmatch';

describe('fnmatch', () => {
  it('matches *, ? and bracket expressions over the whole name', () => {
    expect(fnmatch('*.txt', 'notes.txt')).toBe(true);
    expect(fnmatch('*.txt', 'notes.txt.bak')).toBe(false);
    expect(fnmatch('?.c', 'a.c')).toBe(true);
    expect(fnmatch('[ab]*', 'beta')).toBe(true);
    expect(fnmatch('[!ab]*', 'beta')).toBe(false);
    expect(fnmatch('[[:digit:]]x', '7x')).toBe(true);
    expect(fnmatch('\\*', '*')).toBe(true);
    expect(fnmatch('\\*', 'a')).toBe(false);
    expect(fnmatch('[a-c]x', 'bx')).toBe(true);
    expect(fnmatch('[^a-c]x', 'bx')).toBe(false);
    expect(fnmatch('[]a]', ']')).toBe(true);
    expect(fnmatch('a[', 'a[')).toBe(true);
    expect(fnmatch('*', '')).toBe(true);
    expect(fnmatch('?', '')).toBe(false);
    expect(fnmatch('é*', 'été')).toBe(true);
  });

  it('lets wildcards match a leading dot and a slash, as find does', () => {
    expect(fnmatch('*', '.bashrc')).toBe(true);
    expect(fnmatch('?bashrc', '.bashrc')).toBe(true);
    expect(fnmatch('*/vesen/*', './projects/vesen/info.txt')).toBe(true);
  });

  it('ignores case when asked, as -iname does', () => {
    expect(fnmatch('readme*', 'README.md')).toBe(false);
    expect(fnmatch('readme*', 'README.md', true)).toBe(true);
    expect(fnmatch('[A-C]*', 'beta', true)).toBe(true);
  });

  it('never backtracks for long: a pattern of many stars against a long name is quick', () => {
    const started = Date.now();
    expect(fnmatch(`${'*a'.repeat(40)}b`, 'a'.repeat(4000))).toBe(false);
    expect(Date.now() - started).toBeLessThan(500);
  });
});

describe('matchesAny', () => {
  it('takes alternatives separated by |', () => {
    expect(matchesAny(['*.txt|bin'], 'bin')).toBe(true);
    expect(matchesAny(['*.txt|bin'], 'notes.txt')).toBe(true);
    expect(matchesAny(['*.txt|bin'], 'src')).toBe(false);
    expect(matchesAny(['a', 'b*'], 'beta')).toBe(true);
    expect(matchesAny(['|'], 'x')).toBe(false);
  });
});
