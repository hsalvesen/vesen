import { describe, expect, it } from 'vitest';
import { normalizePaste, normalizeTyped } from './normalize';

describe('normalizeTyped', () => {
  it.each([
    ['echo “hello”', 'echo "hello"'],
    ['echo it’s', "echo it's"],
    ['ls —all', 'ls --all'],
    ['ls –a', 'ls --a'],
    ['echo wait…', 'echo wait...'],
    ['cd docs', 'cd docs'],
    ['plain text', 'plain text'],
  ])('%j -> %j', (typed, plain) => {
    expect(normalizeTyped(typed)).toBe(plain);
  });
});

describe('normalizePaste', () => {
  it.each([
    ['$ ls -la\n', 'ls -la'],
    ['a\r\nb', 'a; b'],
    ['$ cd docs\n$ ls\n', 'cd docs; ls'],
    ['ls |\nwc -l', 'ls | wc -l'],
    ['make &&\n  make install', 'make && make install'],
    ['echo one \\\n  two', 'echo one   two'],
    ['echo a\n\n\necho b', 'echo a; echo b'],
    ['\techo\ttabs', 'echo tabs'],
    ['% zsh prompt', 'zsh prompt'],
    ['echo \\\\\necho b', 'echo \\\\; echo b'],
    ['   leading', 'leading'],
  ])('%j -> %j', (pasted, line) => {
    expect(normalizePaste(pasted)).toBe(line);
  });

  it('never contains a line break, so a paste cannot submit', () => {
    expect(normalizePaste('rm -rf ~\n')).not.toMatch(/[\r\n]/);
  });
  // A line copied from a page must run as it reads: no override can draw `rm -r ~/x` as
  // something else, and no escape sequence hides in it.
  it.each([
    ['right-to-left override', 'echo safe\u202erm -r ~', 'echo safe\ufffdrm -r ~'],
    ['left-to-right isolate', 'ls \u2066x\u2069', 'ls \ufffdx\ufffd'],
    ['escape sequence', 'echo \x1b[2Jhi', 'echo \ufffd[2Jhi'],
    ['C1 control', 'echo a\x85b', 'echo a\ufffdb'],
  ])('replaces a %s with U+FFFD', (_name, pasted, line) => {
    expect(normalizePaste(pasted)).toBe(line);
    expect(normalizeTyped(pasted)).toBe(line);
  });

  it('treats the Unicode line and paragraph separators as line breaks', () => {
    expect(normalizePaste('echo a\u2028echo b\u2029echo c')).toBe('echo a; echo b; echo c');
  });
});
