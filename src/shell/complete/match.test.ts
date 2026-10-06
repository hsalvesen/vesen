import { describe, expect, it } from 'vitest';
import { compareNames, dedupe, didYouMean, longestCommonPrefix, matchPrefix } from './match';
import { cutAt, escapeTail, scanRaw } from './quote';

describe('matchPrefix', () => {
  const items = ['README.md', 'readme.txt', 'Results'].map((value) => ({ value }));
  it('matches case-sensitively first, and ignores case only when nothing matches', () => {
    expect(matchPrefix(items, 'rea')).toEqual({ matched: [{ value: 'readme.txt' }], caseFolded: false });
    expect(matchPrefix(items, 'RE')).toEqual({ matched: [{ value: 'README.md' }], caseFolded: false });
    expect(matchPrefix(items, 'res')).toEqual({ matched: [{ value: 'Results' }], caseFolded: true });
    expect(matchPrefix(items, 're', true).matched).toHaveLength(3);
  });
});

describe('longestCommonPrefix', () => {
  it('shares only what every value has', () => {
    expect(longestCommonPrefix(['documents/', 'downloads/'])).toBe('do');
    expect(longestCommonPrefix(['cat', 'cathode'])).toBe('cat');
    expect(longestCommonPrefix([])).toBe('');
    expect(longestCommonPrefix(['Kanga', 'kangaroo'], true)).toBe('Kanga');
    expect(longestCommonPrefix(['Kanga', 'kangaroo'])).toBe('');
  });

  it('never splits a surrogate pair', () => {
    expect(longestCommonPrefix(['a😀', 'a😁'])).toBe('a');
  });
});

describe('didYouMean', () => {
  it('finds names two edits away at most, nearest first', () => {
    expect(didYouMean('fastfecth', ['fastfetch', 'help', 'theme'])).toEqual(['fastfetch']);
    expect(didYouMean('thme', ['theme', 'them', 'help'])).toEqual(['them', 'theme']);
    expect(didYouMean('zzzzzz', ['help'])).toEqual([]);
    expect(didYouMean('', ['help'])).toEqual([]);
    expect(didYouMean('ls', ['ls'])).toEqual([]);
  });
});

describe('dedupe and order', () => {
  it('keeps the first of each value', () => {
    const a = { value: 'Oslo', label: 'Oslo', kind: 'history', terminal: true } as const;
    const b = { value: 'oslo', label: 'oslo', kind: 'example', terminal: true } as const;
    expect(dedupe([a, b])).toHaveLength(2);
    expect(dedupe([a, b], true)).toEqual([a]);
    expect(['b', 'B', 'a'].sort(compareNames)).toEqual(['a', 'b', 'B']);
  });
});

describe('escapeTail', () => {
  it('escapes for where the text lands', () => {
    expect(escapeTail('my notes.txt', null)).toBe('my\\ notes.txt');
    expect(escapeTail("it's", "'")).toBe("it'\\''s");
    expect(escapeTail('a"b$c`d\\', '"')).toBe('a\\"b\\$c\\`d\\\\');
    expect(escapeTail('wow!', '"')).toBe('wow"\\!"');
    expect(escapeTail('~/x', null)).toBe('~/x');
    expect(escapeTail('#tag', null, true)).toBe('\\#tag');
    expect(escapeTail('#tag', null, false)).toBe('#tag');
    expect(escapeTail('a{b}*?[', null)).toBe('a\\{b}\\*\\?\\[');
  });
});

describe('scanRaw and cutAt', () => {
  it('maps typed characters to unquoted ones', () => {
    const scan = scanRaw('"my no');
    expect(scan.value).toBe('my no');
    expect(scan.endQuote).toBe('"');
    expect(cutAt(scan, '"my no', 5)).toEqual({ index: 6, quote: '"' });
    expect(cutAt(scan, '"my no', 0)).toEqual({ index: 1, quote: '"' });
  });

  it('keeps an opening quote, drops a closing one and a dangling backslash', () => {
    expect(cutAt(scanRaw('""'), '""', 0)).toEqual({ index: 1, quote: '"' });
    const closed = scanRaw('"ab"');
    expect(cutAt(closed, '"ab"', 2)).toEqual({ index: 3, quote: '"' });
    const dangling = scanRaw('my\\');
    expect(dangling.value).toBe('my');
    expect(cutAt(dangling, 'my\\', 2)).toEqual({ index: 2, quote: null });
    expect(scanRaw('a\\ b').value).toBe('a b');
    expect(scanRaw("'a\\b'").value).toBe('a\\b');
    expect(scanRaw('"a\\b\\$"').value).toBe('a\\b$');
  });
});
