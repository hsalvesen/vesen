// The shared regular expression guard and the POSIX translation that grep, sed and expr use.
import fc from 'fast-check';
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

  // Runs of bounded or optional parts, and unrepeated choices whose branches overlap, backtrack
  // exponentially without any group being repeated: refused once they multiply past the budget.
  it.each([
    ['.{0,9}'.repeat(10) + 'x$', 'BRE .\\{0,9\\} ten times froze the page for 95 s'],
    ['^' + '.?'.repeat(26) + 'x$', '2^26 ways'],
    ['(a|a)'.repeat(26) + 'b', 'overlapping choices, 2^26 ways'],
    ['(?:a|ab)'.repeat(30) + 'c', 'branches that begin one another'],
  ])('refuses %s (%s)', (source) => {
    expect(() => guardRegex(source, 'u')).toThrow(/too many optional parts, counts such as \{0,9\} or overlapping choices/);
  });

  it('refuses the same runs in basic syntax, and in expr', () => {
    expect(() => compilePatterns([`^${'.\\{0,9\\}'.repeat(10)}x$`], { syntax: 'basic' })).toThrow(RegexRefused);
    expect(() => compilePatterns([`${'.\\?'.repeat(27)}x`], { syntax: 'basic', start: true })).toThrow(RegexRefused);
  });

  it('counts a few choices, and plain words or exact counts not at all', () => {
    expect(guardRegex('colou?r', 'u').limit).toBe(MAX_SUBJECT);
    expect(guardRegex('^(root|guest|admin):', 'u').limit).toBe(MAX_SUBJECT);
    expect(guardRegex('[0-9]{20}', 'u').limit).toBe(MAX_SUBJECT);
    expect(guardRegex('([0-9]{1,3}\\.){3}[0-9]{1,3}', 'u').limit).toBeGreaterThan(100_000);
    // Each ? doubles the ways: twenty leave short lines, twenty-two none.
    expect(guardRegex(`^${'.?'.repeat(16)}x$`, 'u').limit).toBeGreaterThanOrEqual(32);
    expect(() => guardRegex(`^${'.?'.repeat(22)}x$`, 'u')).toThrow(RegexRefused);
  });

  // Choices are tried one after another, so the open repetitions of grep -e patterns joined into
  // one do not add up: eight of them leave lines as long as one pattern's, not none.
  it('takes the most open repetitions of any one choice, not their sum', () => {
    const one = compilePatterns(['error.*disk'], { syntax: 'basic' });
    const eight = compilePatterns(['error.*disk', 'warn.*net', 'fail.*io', 'x.*y', 'e.*z', 'w.*q', 'f.*r', 'g.*h'], { syntax: 'basic' });
    expect(one.limit).toBe(14142);
    expect(eight.limit).toBeGreaterThan(1000);
    expect(guardRegex('(?:a.*b)|(?:c.*d.*e)', 'u').limit).toBe(subjectLimit(2));
  });

  // Whatever the guard lets through must finish quickly on the worst lines it allows: long runs of
  // the characters the pattern repeats, with no match at the end. A pattern that backtracks
  // exponentially takes seconds to minutes there; one within the budget, a few hundred ms.
  it('lets through only patterns that finish quickly at their line limit', () => {
    const atom = fc.constantFrom('a', 'b', '.', '[ab]', '\\w');
    const quant = fc.constantFrom('', '', '?', '?', '{0,3}', '{1,4}', '{0,9}', '{2}', '{0,16}', '{1,2}');
    const piece = fc.tuple(atom, quant).map(([a, q]) => a + q);
    const sequence = fc.array(piece, { minLength: 1, maxLength: 4 }).map((parts) => parts.join(''));
    const group = fc.tuple(fc.array(sequence, { minLength: 1, maxLength: 3 }), quant).map(([branches, q]) => `(?:${branches.join('|')})${q}`);
    // `!` never appears in the lines, so every start position is tried in every way.
    const pattern = fc.array(fc.oneof(piece, piece, group), { minLength: 1, maxLength: 14 }).map((parts) => `${parts.join('')}!`);
    fc.assert(
      fc.property(pattern, (source) => {
        let safe;
        try {
          safe = guardRegex(source, 'u');
        } catch {
          return;
        }
        for (const line of ['a'.repeat(safe.limit), 'ab'.repeat(Math.floor(safe.limit / 2))]) {
          const started = performance.now();
          safe.regex.test(line);
          expect(performance.now() - started, `${source} on ${line.length} characters`).toBeLessThan(1000);
        }
      }),
      { numRuns: 120 },
    );
  }, 60_000);

  it('caps the pattern length', () => {
    expect(() => guardRegex('a'.repeat(MAX_PATTERN + 1), 'u')).toThrow(/pattern too long/);
    expect(() => compilePatterns(['a'.repeat(MAX_PATTERN), 'b'], { syntax: 'basic' })).toThrow(/pattern too long/);
  });

  it('reports what JavaScript cannot read as a syntax error', () => {
    expect(() => guardRegex('(', 'u')).toThrow(RegexSyntaxError);
  });
});
