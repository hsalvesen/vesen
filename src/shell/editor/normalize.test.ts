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
});
