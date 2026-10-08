// expr and bc against their Linux behaviour: expr's operators, string functions, regular
// expression matches and exit statuses; bc's scale rules, bases, the math library, its control
// statements and its error messages.
import { describe, expect, it } from 'vitest';
import { runLine } from '../../../../tests/harness';
import { div, format, isqrt, mod, power, readNumber, sqrt, type Num } from './bc.run';
import { isNull } from './expr.run';

const pipe = { tty: false } as const;

describe('expr', () => {
  it.each([
    ['expr 6 \\* 7', '42', 0],
    ['expr 7 / 2 + 7 % 2', '4', 0],
    ['expr -7 / 2', '-3', 0],
    ['expr -5 + 2', '-3', 0],
    ['expr 99999999999999999999 + 1', '100000000000000000000', 0],
    ['expr \\( 1 + 2 \\) \\* 3', '9', 0],
    ['expr 3 \\< 10', '1', 0],
    ['expr a \\< b', '1', 0],
    ['expr 10 = 10', '1', 0],
    ['expr abc != abc', '0', 1],
    ['expr 5 \\| 0', '5', 0],
    ['expr 0 \\| 0', '0', 1],
    ["expr '' \\| x", 'x', 0],
    ['expr 0 \\& 5', '0', 1],
    ['expr 3 \\& 5', '3', 0],
    ['expr length vesen', '5', 0],
    ['expr substr terminal 1 4', 'term', 0],
    ['expr substr terminal 5 100', 'inal', 0],
    ['expr substr abc 0 1', '', 1],
    ['expr index hello l', '3', 0],
    ['expr index hello z', '0', 1],
    ["expr hello.txt : '.*\\.\\(.*\\)'", 'txt', 0],
    ["expr abc : 'a.'", '2', 0],
    ["expr abc : 'b'", '0', 1],
    ['expr match abc ab', '2', 0],
    ['expr + length', 'length', 0],
    ['expr 0', '0', 1],
    ["expr ''", '', 1],
  ])('%s prints %s and exits %i', async (line, output, status) => {
    expect(await runLine(line, pipe)).toMatchObject({ status, stdoutPlain: output, stderrPlain: '' });
  });

  it.each([
    ['expr', "expr: missing operand\nTry 'expr --help' for more information."],
    ['expr 1 / 0', 'expr: division by zero'],
    ['expr a + 1', 'expr: non-integer argument'],
    ['expr 1 +', "expr: syntax error: missing argument after '+'"],
    ['expr 1 2', "expr: syntax error: unexpected argument '2'"],
    ['expr \\( 1', "expr: syntax error: expecting ')' after '1'"],
    ["expr a : '\\('", 'expr: Unmatched ( or \\('],
  ])('%s fails with status 2', async (line, message) => {
    expect(await runLine(line, pipe)).toMatchObject({ status: 2, stderrPlain: message });
  });

  it('knows what is null', () => {
    expect(isNull('')).toBe(true);
    expect(isNull('00')).toBe(true);
    expect(isNull('-0')).toBe(true);
    expect(isNull(0n)).toBe(true);
    expect(isNull('a')).toBe(false);
  });
});

describe('bc', () => {
  it.each([
    ["echo '2+3*4' | bc", '14'],
    ["echo '(2+3)*4' | bc", '20'],
    ["echo '2^64' | bc", '18446744073709551616'],
    ["echo '2^3^2' | bc", '512'],
    ["echo '7/2' | bc", '3'],
    ["echo '-7/2' | bc", '-3'],
    ["echo '7%3; -7%3' | bc", '1\n-1'],
    ["echo 'scale=5; 22/7' | bc", '3.14285'],
    ["echo 'scale=2; 1/3*3' | bc", '.99'],
    ["echo '.5 + .5' | bc", '1.0'],
    ["echo '1.50 * 2' | bc", '3.00'],
    ["echo 'scale=3; 10 % 3.3' | bc", '.0010'],
    ["echo 'sqrt(2)' | bc", '1'],
    ["echo 'scale=10; sqrt(2)' | bc", '1.4142135623'],
    ["echo 'x=7; y=6; x*y' | bc", '42'],
    ["echo 'x=5; x+=2; x' | bc", '7'],
    // An increment is not an assignment, so it prints its value.
    ["echo 'i=1; i++; i; ++i' | bc", '1\n2\n3'],
    ["echo 'obase=2; 10' | bc", '1010'],
    ["echo 'obase=16; 255' | bc", 'FF'],
    ["echo 'ibase=16; FF' | bc", '255'],
    ["echo 'ibase=2; 1010' | bc", '10'],
    ["echo 'length(123.45); scale(123.45)' | bc", '5\n2'],
    ["echo '1 < 2; 2 == 3; !0' | bc", '1\n0\n1'],
    ["echo '3; last + 1' | bc", '3\n4'],
    ["echo 'for (i = 0; i < 3; i++) i' | bc", '0\n1\n2'],
    ["echo 'i = 0; while (i < 10) { i = i + 3; if (i > 5) break }; i' | bc", '6'],
    ["echo 'if (2 > 1) print \"yes\\n\" else print \"no\\n\"' | bc", 'yes'],
    ["printf 'print 1, \" and \", 2, \"\\\\n\"\\n' | bc", '1 and 2'],
    ["echo '/* comment */ 1 # and another' | bc", '1'],
    ["echo '1; quit; 2' | bc", '1'],
    ["echo 'sqrt(2)' | bc -l", '1.41421356237309504880'],
    ["echo '4*a(1)' | bc -l", '3.14159265358979323844'],
    ["echo 's(1); c(0)' | bc -l", '.84147098480789650665\n1.00000000000000000000'],
    ["echo 'l(10); e(1)' | bc -l", '2.30258509299404568401\n2.71828182845904523536'],
    ["echo '1/3' | bc -l", '.33333333333333333333'],
    ["echo 'scale=4; e(2)' | bc -l", '7.3890'],
    ['bc -e 2+2', '4'],
  ])('%s', async (line, expected) => {
    expect(await runLine(line, pipe)).toMatchObject({ status: 0, stdoutPlain: expected, stderrPlain: '' });
  });

  it('wraps long numbers at 70 characters with a backslash', async () => {
    const lines = (await runLine("echo '2^300' | bc", pipe)).stdoutPlain.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toHaveLength(70);
    expect(lines[0]?.endsWith('\\')).toBe(true);
    expect(`${lines[0]?.slice(0, -1)}${lines[1]}`).toBe((2n ** 300n).toString());
  });

  it('reports errors as bc does, carries on, and exits 1', async () => {
    expect(await runLine("echo '1 +' | bc", pipe)).toMatchObject({ status: 1, stderrPlain: '(standard_in) 1: syntax error' });
    expect(await runLine("printf '1/0\\n5\\n' | bc", pipe)).toMatchObject({ status: 1, stdoutPlain: '5', stderrPlain: 'Runtime error: Divide by zero' });
    expect(await runLine("echo 'sqrt(-1)' | bc", pipe)).toMatchObject({ status: 1, stderrPlain: 'Runtime error: Square root of a negative number' });
    expect(await runLine("echo 's(1)' | bc", pipe)).toMatchObject({ status: 1, stderrPlain: 'Runtime error: Function s not defined.' });
    expect(await runLine("echo 'define f(x) { return x }' | bc", pipe)).toMatchObject({ status: 1, stderrPlain: "(standard_in) 1: define is not supported in vesen's bc" });
    expect(await runLine('bc nope', pipe)).toMatchObject({ status: 1, stderrPlain: 'bc: File nope is unavailable: No such file or directory' });
  });

  // GNU bc writes runtime warnings to standard error, so a pipe or $( ) gets only the numbers.
  it('warns of a fractional exponent on standard error', async () => {
    expect(await runLine("echo '2^1.5' | bc", pipe)).toMatchObject({ status: 0, stdoutPlain: '2', stderrPlain: 'Runtime warning: non-zero scale in exponent' });
    expect((await runLine("echo '2^0.5' | bc | wc -l", pipe)).stdoutPlain).toBe('1');
    expect((await runLine('x=$(echo 2^1.5 | bc 2>/dev/null); echo "[$x]"', pipe)).stdoutPlain).toBe('[2]');
    // In order with what was printed before it.
    expect((await runLine("echo 'print 1, \"\\n\"; 2^0.5' | bc", pipe)).screen).toEqual(['1', '! Runtime warning: non-zero scale in exponent', '1']);
  });

  // The library's series cannot be interrupted, so their precision is held where they end quickly.
  it('refuses a math library scale that would hold the page still', async () => {
    const started = performance.now();
    expect(await runLine("bc -l <<< 'scale=100000; l(2)'", pipe)).toMatchObject({ status: 1, stderrPlain: 'Runtime error: scale too large for the math library (at most 5000)' });
    expect((await runLine("bc -l <<< 'l(10^6000)'", pipe)).stderrPlain).toMatch(/^Runtime error: number too large for the math library/);
    expect(performance.now() - started).toBeLessThan(1000);
    expect((await runLine("bc -l <<< 'scale=50; 4*a(1)'", pipe)).stdoutPlain).toBe('3.14159265358979323846264338327950288419716939937508');
  });

  it('refuses a number too long to be useful', async () => {
    const result = await runLine("echo '10^200000' | bc", pipe);
    expect(result.status).toBe(1);
    expect(result.stderrPlain).toBe('Runtime error: number too long (over 100000 digits)');
  });

  it('computes with exact decimals', () => {
    const n = (v: bigint, s = 0): Num => ({ v, s });
    expect(format(div(n(1n), n(3n), 5))).toBe('.33333');
    expect(format(mod(n(7n), n(3n), 0))).toBe('1');
    // A power keeps min(scale(a) * b, max(scale, scale(a))) digits: 1.5^2 is 2.2 at scale 0.
    expect(format(power(n(15n, 1), n(2n), 0))).toBe('2.2');
    expect(format(power(n(15n, 1), n(2n), 2))).toBe('2.25');
    expect(format(sqrt(n(16n), 0))).toBe('4');
    expect(isqrt(10n ** 40n)).toBe(10n ** 20n);
    expect(format(readNumber('1.5', 10))).toBe('1.5');
    expect(format(readNumber('A', 10))).toBe('10');
    expect(format(n(-5n, 1))).toBe('-.5');
    expect(format(n(10n), 16)).toBe('A');
  });
});
