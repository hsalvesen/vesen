// The shared regular expression guard and the POSIX translation that grep, sed and expr use.
import { describe, expect, it } from 'vitest';
import {
  compilePatterns,
  guardRegex,
  MAX_PATTERN,
  MAX_SUBJECT,
  RegexRefused,
  RegexSyntaxError,
  subjectLimit,
  SubjectTooLong,
  translatePosix,
} from './regex';

const basic = (p: string): string => translatePosix(p, 'basic').source;
const extended = (p: string): string => translatePosix(p, 'extended').source;

describe('translatePosix', () => {
  it.each([
    ['a.c', 'a.c'],
    ['a*', 'a*'],
    ['*a', '\\*a'],
    ['^*a', '^\\*a'],
    ['\\(ab\\)*', '(ab)*'],
    ['a\\{2,3\\}', 'a{2,3}'],
    ['a\\{,3\\}', 'a{0,3}'],
    ['a\\{2,\\}', 'a{2,}'],
    ['a\\|b', 'a|b'],
    ['a\\+b\\?', 'a+b?'],
    ['a+b?(c)|{d}', 'a\\+b\\?\\(c\\)\\|\\{d\\}'],
    ['a^b$c', 'a\\^b\\$c'],
    ['^ab$', '^ab$'],
    ['\\(^a$\\)', '(^a$)'],
    ['\\(a\\)\\1', '(a)\\1'],
    ['\\(a\\)\\10', '(a)\\1(?:)0'],
    ['\\<the\\>', '\\b(?=\\w)the\\b(?!\\w)'],
    ['[[:digit:]]\\+', '[0-9]+'],
    ['[^a-c]', '[^a-c]'],
    ['[]x]', '[\\]x]'],
    ['[a\\]', '[a\\\\]'],
    ['[a-]', '[a\\-]'],
    ['a**', 'a*'],
    ['x/y', 'x\\/y'],
  ])('basic %s is %s', (posix, js) => {
    expect(basic(posix)).toBe(js);
  });

  it.each([
    ['(ab)+', '(ab)+'],
    ['a{2}', 'a{2}'],
    ['a{', 'a\\{'],
    ['a{x}', 'a\\{x\\}'],
    ['a|b', 'a|b'],
    ['\\(a\\)', '\\(a\\)'],
    ['+a', '\\+a'],
    ['a+?', 'a*'],
    ['(a)\\1', '(a)\\1'],
    ['a)', 'a\\)'],
  ])('extended %s is %s', (posix, js) => {
    expect(extended(posix)).toBe(js);
  });

  it.each([
    ['\\(a', 'basic', 'Unmatched ( or \\('],
    ['a\\)', 'basic', 'Unmatched ) or \\)'],
    ['(a', 'extended', 'Unmatched ( or \\('],
    ['[a', 'basic', 'Unmatched [, [^, [:, [., or [='],
    ['a\\{2', 'basic', 'Unmatched \\{'],
    ['a\\{3,2\\}', 'basic', 'Invalid content of \\{\\}'],
    ['z-a', 'basic', null],
    ['[z-a]', 'basic', 'Invalid range end'],
    ['\\1', 'basic', 'Invalid back reference'],
    ['a\\', 'basic', 'Trailing backslash'],
    ['[[:nope:]]', 'basic', 'Invalid character class name'],
    ['[:space:]', 'basic', 'character class syntax is [[:space:]], not [:space:]'],
  ] as const)('%s (%s) is refused: %s', (pattern, syntax, message) => {
    if (message === null) {
      expect(() => translatePosix(pattern, syntax)).not.toThrow();
      return;
    }
    expect(() => translatePosix(pattern, syntax)).toThrow(new RegexSyntaxError(message));
  });

  it('numbers backreferences after the groups of the patterns before', () => {
    const joined = compilePatterns(['\\(a\\)\\1', '\\(b\\)\\1'], { syntax: 'basic' });
    expect(joined.regex.source).toBe('(?:(a)\\1)|(?:(b)\\2)');
    expect(joined.regex.test('bb')).toBe(true);
    expect(joined.regex.test('ab')).toBe(false);
  });

  it('matches what GNU matches', () => {
    const re = (p: string, s: 'basic' | 'extended' = 'basic'): RegExp => compilePatterns([p], { syntax: s }).regex;
    expect(re('[[:upper:]][[:lower:]]*').exec('say Hello')?.[0]).toBe('Hello');
    expect(re('\\<is\\>').test('this is')).toBe(true);
    expect(re('\\<is\\>').test('this')).toBe(false);
    expect(re('colou\\?r').test('color')).toBe(true);
    expect(re('[.]').test('a.b')).toBe(true);
    expect(re('[.]').test('ab')).toBe(false);
    expect(re('^(a|b)+$', 'extended').test('abba')).toBe(true);
    expect(compilePatterns(['a.c'], { syntax: 'fixed' }).regex.test('abc')).toBe(false);
    expect(compilePatterns(['a.c'], { syntax: 'fixed' }).regex.test('xa.cx')).toBe(true);
    expect(compilePatterns(['HELLO'], { syntax: 'basic', ignoreCase: true }).regex.test('hello')).toBe(true);
  });
});

describe('guardRegex', () => {
  it.each([
    '(a+)+$',
    '(a*)*',
    '(.*)*',
    '(\\w+\\s?)*$',
    '((ab)*c)+',
    '(a|aa)+',
    '(a|a?)+',
    '(a|b+)*',
    '(.*a){20}',
    '(x+x+)+y',
    '(x+y){2,}',
    '(?:a+){2,}',
    '(a+){2}',
    '(a{1,9}){9}',
    '(x{1,100}){1,100}',
    '(a|ab|abc)*d',
  ])(
    'refuses %s',
    (source) => {
      expect(() => guardRegex(source, 'u')).toThrow(RegexRefused);
    },
  );

  // Small bounded counts inside a bounded repeat, as in an IP address, can split a text only a few
  // ways, so they pass: ([0-9]{1,3}\.){3} has 27.
  it.each([
    '(ab)+',
    '(foo|bar)+',
    '(a|b)*c',
    '^\\w+$',
    'a.*b',
    '(\\d{3})-(\\d{4})',
    '(ab?)?',
    '(.)\\1*',
    '(?:)*',
    'x{1,3}y',
    '([0-9]{1,3}\\.){3}[0-9]{1,3}',
    '(ab{1,2}){2,4}',
    '\\(a+\\)+',
    '[(a+)+]',
  ])(
    'allows %s',
    (source) => {
      expect(() => guardRegex(source, 'u')).not.toThrow();
    },
  );

  it('refuses (a+)+$ quickly, before it can run against a long line', () => {
    const line = `${'a'.repeat(5000)}!`;
    const started = performance.now();
    let refused: unknown = null;
    try {
      compilePatterns(['(a+)+$'], { syntax: 'extended' }).regex.test(line);
    } catch (error) {
      refused = error;
    }
    expect(refused).toBeInstanceOf(RegexRefused);
    expect(performance.now() - started).toBeLessThan(50);
  });

  it('caps the line length from the open-ended repetitions', () => {
    expect(subjectLimit(0)).toBe(MAX_SUBJECT);
    expect(subjectLimit(1)).toBe(14142);
    expect(subjectLimit(2)).toBe(843);
    expect(guardRegex('abc', 'u').limit).toBe(MAX_SUBJECT);
    expect(guardRegex('a.*b', 'u').limit).toBe(14142);
    expect(guardRegex('a{1,3}b', 'u').limit).toBe(MAX_SUBJECT);
    const safe = guardRegex('a.*b.*c', 'u');
    expect(() => safe.check('x'.repeat(843))).not.toThrow();
    expect(() => safe.check('x'.repeat(844))).toThrow(new SubjectTooLong(844, 843));
    // Nine open repetitions leave too short a line to be useful.
    expect(() => guardRegex('a*'.repeat(9), 'u')).toThrow(RegexRefused);
  });

  it('caps the pattern length', () => {
    expect(() => guardRegex('a'.repeat(MAX_PATTERN + 1), 'u')).toThrow(/pattern too long/);
    expect(() => compilePatterns(['a'.repeat(MAX_PATTERN), 'b'], { syntax: 'basic' })).toThrow(/pattern too long/);
  });

  it('reports what JavaScript cannot read as a syntax error', () => {
    expect(() => guardRegex('(', 'u')).toThrow(RegexSyntaxError);
  });
});
