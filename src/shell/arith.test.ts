import { describe, expect, it } from 'vitest';
import { ArithError, MAX_ARITH_READS, evaluateArith, type ArithVars } from './arith';

function vars(initial: Record<string, string> = {}): ArithVars & { store: Map<string, string> } {
  const store = new Map(Object.entries(initial));
  return { store, get: (name) => store.get(name), set: (name, value) => void store.set(name, value) };
}

const calc = (expr: string, initial?: Record<string, string>): string => evaluateArith(expr, vars(initial)).toString();

describe('evaluateArith: values', () => {
  const cases: [string, string, Record<string, string>?][] = [
    ['', '0'],
    ['   ', '0'],
    ['42', '42'],
    ['1+2', '3'],
    [' 2 * 3 + 4 ', '10'],
    ['2+3*4', '14'],
    ['(2+3)*4', '20'],
    ['((1))', '1'],
    ['7/2', '3'],
    ['-7/2', '-3'],
    ['7%3', '1'],
    ['-7%3', '-1'],
    ['2**10', '1024'],
    ['2**3**2', '512'],
    ['-2**2', '4'],
    ['2**0', '1'],
    ['1<2', '1'],
    ['2<=1', '0'],
    ['3>2', '1'],
    ['3>=4', '0'],
    ['3==3', '1'],
    ['3!=3', '0'],
    ['1&&0', '0'],
    ['1||0', '1'],
    ['0||0', '0'],
    ['!0', '1'],
    ['!5', '0'],
    ['~0', '-1'],
    ['-(-3)', '3'],
    ['+3', '3'],
    ['--1', '1'],
    ['1--1', '2'],
    ['1+-1', '0'],
    ['5&3', '1'],
    ['5|3', '7'],
    ['5^3', '6'],
    ['1<<4', '16'],
    ['256>>4', '16'],
    ['-16>>2', '-4'],
    ['1?2:3', '2'],
    ['0?2:3', '3'],
    ['1?0?5:6:7', '6'],
    ['1,2', '2'],
    ['0x1F', '31'],
    ['0X10', '16'],
    ['017', '15'],
    ['0', '0'],
    ['2#101', '5'],
    ['16#ff', '255'],
    ['36#z', '35'],
    ['64#_', '63'],
    ['64#@', '62'],
    ['64#Z', '61'],
    ['9223372036854775807+1', '-9223372036854775808'],
    ['2**63', '-9223372036854775808'],
    ['2**64', '0'],
    ['-9223372036854775807-1', '-9223372036854775808'],
    ['1<<64', '1'],
    ['0 && 1/0', '0'],
    ['1 || 1/0', '1'],
    ['1 ? 2 : 1/0', '2'],
    ['x', '5', { x: '5' }],
    ['x*2', '10', { x: '5' }],
    ['unset + 1', '1'],
    ['empty + 1', '1', { empty: '' }],
    ['x * 2', '6', { x: '1+2' }],
    ['y', '6', { x: '3', y: 'x*2' }],
    ['x', '-4', { x: '-4' }],
  ];
  it.each(cases)('%j is %s', (expr, expected, initial) => {
    expect(calc(expr, initial)).toBe(expected);
  });

  it('assigns, with every compound operator', () => {
    const v = vars({ x: '10' });
    const run = (expr: string): string => evaluateArith(expr, v).toString();
    expect(run('y = 7')).toBe('7');
    expect(v.store.get('y')).toBe('7');
    expect(run('x += 5')).toBe('15');
    expect(run('x -= 3')).toBe('12');
    expect(run('x *= 2')).toBe('24');
    expect(run('x /= 5')).toBe('4');
    expect(run('x %= 3')).toBe('1');
    expect(run('x <<= 3')).toBe('8');
    expect(run('x >>= 1')).toBe('4');
    expect(run('x |= 3')).toBe('7');
    expect(run('x &= 5')).toBe('5');
    expect(run('x ^= 1')).toBe('4');
    expect(run('a = b = 2')).toBe('2');
    expect([v.store.get('a'), v.store.get('b')]).toEqual(['2', '2']);
    expect(run('a=1, b=a+1, a+b')).toBe('3');
  });

  it('steps variables before and after reading them', () => {
    const v = vars({ i: '5' });
    expect(evaluateArith('i++', v)).toBe(5n);
    expect(v.store.get('i')).toBe('6');
    expect(evaluateArith('++i', v)).toBe(7n);
    expect(evaluateArith('i--', v)).toBe(7n);
    expect(evaluateArith('--i', v)).toBe(5n);
    expect(evaluateArith('n++', v)).toBe(0n);
    expect(v.store.get('n')).toBe('1');
    expect(evaluateArith('i+++1', v)).toBe(6n);
    expect(v.store.get('i')).toBe('6');
  });

  it('skips the side effects of a branch it does not take', () => {
    const v = vars();
    expect(evaluateArith('0 && (x = 1)', v)).toBe(0n);
    expect(evaluateArith('1 ? (y = 2) : (z = 3)', v)).toBe(2n);
    expect([...v.store.keys()]).toEqual(['y']);
  });
});

describe('evaluateArith: errors in bash wording', () => {
  const cases: [string, string, Record<string, string>?][] = [
    ['1/0', '1/0: division by 0 (error token is "0")'],
    [' 5 % 0 ', '5 % 0: division by 0 (error token is "0")'],
    ['2**-1', '2**-1: exponent less than 0 (error token is "1")'],
    ['1+', '1+: syntax error: operand expected (error token is "+")'],
    ['*2', '*2: syntax error: operand expected (error token is "*2")'],
    ['(1', '(1: missing \')\' (error token is "")'],
    ['1 2', '1 2: syntax error in expression (error token is "2")'],
    ['5=3', '5=3: attempted assignment to non-variable (error token is "=3")'],
    ['09', '09: value too great for base (error token is "09")'],
    ['12abc', '12abc: value too great for base (error token is "12abc")'],
    ['1#1', '1#1: invalid arithmetic base (error token is "1#1")'],
    ['65#1', '65#1: invalid arithmetic base (error token is "65#1")'],
    ['0x', '0x: invalid number (error token is "0x")'],
    ['1 @ 2', '1 @ 2: syntax error: invalid arithmetic operator (error token is "@ 2")'],
    ['1 ? 2', "1 ? 2: syntax error: ':' expected for conditional expression (error token is \"\")"],
    ['x', 'x: expression recursion level exceeded (error token is "x")', { x: 'x' }],
    ['x', '08: value too great for base (error token is "08")', { x: '08' }],
  ];
  it.each(cases)('%j', (expr, message, initial) => {
    expect(() => evaluateArith(expr, vars(initial))).toThrow(new ArithError(message));
  });
});

describe('evaluateArith: bounded work', () => {
  it('stops variables that double the work at every level', () => {
    const initial: Record<string, string> = {};
    for (let k = 0; k < 40; k += 1) initial[`v${k}`] = `v${k + 1} + v${k + 1}`;
    const started = Date.now();
    expect(() => evaluateArith('v0', vars(initial))).toThrow(/expression too complex/);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('still allows a long chain within the budget', () => {
    const initial: Record<string, string> = {};
    for (let k = 0; k < 50; k += 1) initial[`v${k}`] = `v${k + 1} + 1`;
    expect(evaluateArith('v0', vars(initial))).toBe(50n);
    expect(MAX_ARITH_READS).toBeGreaterThan(1000);
  });
});
