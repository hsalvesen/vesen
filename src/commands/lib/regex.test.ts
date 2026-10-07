// The one guard for visitors' regular expressions: POSIX classes and BRE groups translated, the
// pattern and the text capped, and the shapes that backtrack for ever refused.
import { describe, expect, it } from 'vitest';
import { catastrophic, checkInputLength, compilePattern, matches, MAX_INPUT_LENGTH, MAX_PATTERN_LENGTH, MAX_SUBJECT_LENGTH, PatternError, translatePosix } from './regex';

describe('translatePosix', () => {
  it('spells out the POSIX classes inside brackets', () => {
    expect(translatePosix('[[:digit:]]+')).toBe('[0-9]+');
    expect(translatePosix('[^[:space:]x]')).toBe('[^ \\t\\n\\r\\f\\vx]');
    expect(() => translatePosix('[[:nope:]]')).toThrow(PatternError);
    expect(() => translatePosix('[abc')).toThrow('Unmatched [');
  });

  it('keeps a bracket that opens with ] and a backslash inside one literal', () => {
    expect(new RegExp(translatePosix('[]a]')).test(']')).toBe(true);
    expect(new RegExp(translatePosix('[\\n]')).test('\\')).toBe(true);
  });

  it('reads a basic expression: \\( \\) \\{ \\} \\| \\+ \\? are groups and counts, the bare ones literal', () => {
    expect(translatePosix('\\(ab\\)\\{2\\}', true)).toBe('(ab){2}');
    expect(translatePosix('a|b(c)+?', true)).toBe('a\\|b\\(c\\)\\+\\?');
    expect(translatePosix('*star', true)).toBe('\\*star');
    expect(translatePosix('\\<word\\>')).toBe('\\bword\\b');
  });
});

describe('catastrophic', () => {
  it.each(['(a+)+', '(a*)*', '(.*)*', '(\\w+\\s?)*$', '((ab)*c)+', '(x+y){2,}', '(?:a+)+b', '(a|b+)*'])('refuses %s', (pattern) => {
    expect(catastrophic(pattern)).not.toBeNull();
  });

  it.each(['a+b+', '(ab)+', '(a|b)*c', '([0-9]{1,3}\\.){3}[0-9]{1,3}', '[(a+)+]', '\\(a+\\)+', '(a?)+', '^\\d+(\\.\\d+)?$'])('allows %s', (pattern) => {
    expect(catastrophic(pattern)).toBeNull();
  });
});

describe('compilePattern', () => {
  it('compiles an extended pattern, with case folding when asked', () => {
    expect(compilePattern('^v.sh$').test('vesh')).toBe(true);
    expect(compilePattern('VESH', { ignoreCase: true }).test('vesh')).toBe(true);
    expect(compilePattern('a', { global: true }).flags).toBe('g');
  });

  it('refuses a pattern that is too long, could run for ever, or is not valid', () => {
    expect(() => compilePattern('a'.repeat(MAX_PATTERN_LENGTH + 1))).toThrow('pattern too long');
    expect(() => compilePattern('(a+)+$')).toThrow(/^refused: a repeated group/);
    expect(() => compilePattern('a(')).toThrow(PatternError);
  });

  it('tries a match on the first MAX_SUBJECT_LENGTH characters of a long text only', () => {
    const re = compilePattern('end$');
    expect(matches(re, `${'x'.repeat(10)}end`)).toBe(true);
    expect(matches(re, `${'x'.repeat(MAX_SUBJECT_LENGTH)}end`)).toBe(false);
    // A global expression starts afresh each time.
    const global = compilePattern('x', { global: true });
    expect(matches(global, 'x')).toBe(true);
    expect(matches(global, 'x')).toBe(true);
  });

  it('caps how much text one command searches', () => {
    expect(() => checkInputLength(MAX_INPUT_LENGTH)).not.toThrow();
    expect(() => checkInputLength(MAX_INPUT_LENGTH + 1)).toThrow('input too large');
  });
});
