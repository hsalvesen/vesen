// factor: prime factors up to 2^64 - 1, in GNU factor's format and words.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { runLine } from '../../../../tests/harness';
import { FACTOR_MAX, isPrime, parseWhole, primeFactors } from '../../lib/primes';

const product = (factors: readonly bigint[]): bigint => factors.reduce((a, b) => a * b, 1n);

describe('prime factors', () => {
  it('knows the small cases', () => {
    expect(primeFactors(0n)).toEqual([]);
    expect(primeFactors(1n)).toEqual([]);
    expect(primeFactors(2n)).toEqual([2n]);
    expect(primeFactors(360n)).toEqual([2n, 2n, 2n, 3n, 3n, 5n]);
    expect(primeFactors(2026n)).toEqual([2n, 1013n]);
    expect(primeFactors(FACTOR_MAX)).toEqual([3n, 5n, 17n, 257n, 641n, 65537n, 6700417n]);
  });

  it('splits the hard cases quickly: two large primes, a prime power, the largest prime', () => {
    const started = Date.now();
    expect(primeFactors(4294967291n * 4294967279n)).toEqual([4294967279n, 4294967291n]);
    expect(primeFactors(4294967291n ** 2n)).toEqual([4294967291n, 4294967291n]);
    expect(primeFactors(18446744073709551557n)).toEqual([18446744073709551557n]);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('multiplies back to the number, every factor prime and in order', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 2n, max: FACTOR_MAX }), (n) => {
        const factors = primeFactors(n);
        expect(product(factors)).toBe(n);
        for (const p of factors) expect(isPrime(p)).toBe(true);
        expect([...factors].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))).toEqual(factors);
      }),
      { numRuns: 200 },
    );
  });

  it('reads whole numbers only', () => {
    expect(parseWhole('42')).toBe(42n);
    expect(parseWhole(' +7 ')).toBe(7n);
    for (const word of ['', '-3', '1.5', '1e3', '0x10', 'abc']) expect(parseWhole(word), word).toBeNull();
  });
});

describe('factor in the shell', () => {
  it("prints each number, a colon and its factors, as GNU factor does", async () => {
    expect(await runLine('factor 2026 1 12', { tty: false })).toMatchObject({ status: 0, stdoutPlain: '2026: 2 1013\n1:\n12: 2 2 3' });
  });

  it('reads numbers piped in, across lines and spaces', async () => {
    expect((await runLine("printf '4 6\\n  9\\n' | factor", { tty: false })).stdoutPlain).toBe('4: 2 2\n6: 2 3\n9: 3 3');
  });

  it('says which words it cannot take, carries on, and exits 1', async () => {
    const result = await runLine('factor 7 abc 18446744073709551616 8', { tty: false });
    expect(result.status).toBe(1);
    expect(result.stdoutPlain).toBe('7: 7\n8: 2 2 2');
    expect(result.stderrPlain).toBe("factor: 'abc' is not a valid positive integer\nfactor: '18446744073709551616' is too large");
  });
});
