import { describe, expect, it } from 'vitest';
import { gfExp, gfLog, gfMul, rsGenerator, rsRemainder } from './gf256';
import { EC_CODEWORDS_PER_BLOCK, ECC_ORDER } from './tables';

/** Carry-less multiplication reduced by 0x11D, the slow way, as an independent reference. */
function slowMul(a: number, b: number): number {
  let r = 0;
  for (let i = 0; i < 8; i++) if (b & (1 << i)) r ^= a << i;
  for (let bit = 15; bit >= 8; bit--) if (r & (1 << bit)) r ^= 0x11d << (bit - 8);
  return r;
}

/** Evaluates a polynomial (highest power first) at x. */
function evaluate(poly: ArrayLike<number>, x: number): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) s = gfMul(s, x) ^ (poly[i] ?? 0);
  return s;
}

/** A small deterministic generator for test data. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s >>> 24;
  };
}

describe('GF(256)', () => {
  it('multiplies like carry-less multiplication modulo 0x11D for all 65,536 pairs', () => {
    const wrong: string[] = [];
    for (let a = 0; a < 256; a++) {
      for (let b = 0; b < 256; b++) if (gfMul(a, b) !== slowMul(a, b)) wrong.push(`${a} * ${b}`);
    }
    expect(wrong).toEqual([]);
  });

  it('is a field: commutative, with identity and inverses, and distributive', { timeout: 60_000 }, () => {
    const wrong: string[] = [];
    for (let a = 0; a < 256; a++) {
      if (gfMul(a, 1) !== a) wrong.push(`${a} * 1`);
      if (a > 0 && gfMul(a, gfExp(255 - gfLog(a))) !== 1) wrong.push(`inverse of ${a}`);
      for (let b = 0; b < 256; b++) {
        if (gfMul(a, b) !== gfMul(b, a)) wrong.push(`${a} * ${b} commutes`);
        for (const c of [0, 1, 2, 29, 142, 255]) {
          if (gfMul(a, b ^ c) !== (gfMul(a, b) ^ gfMul(a, c))) wrong.push(`${a} * (${b} + ${c})`);
          if (gfMul(gfMul(a, b), c) !== gfMul(a, gfMul(b, c))) wrong.push(`(${a} * ${b}) * ${c}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it('has α = 2 as a generator of the 255 non-zero elements', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 255; i++) seen.add(gfExp(i));
    expect(seen.size).toBe(255);
    expect(seen.has(0)).toBe(false);
    expect(gfExp(255)).toBe(1);
    expect(() => gfLog(0)).toThrow(RangeError);
  });
});

describe('Reed-Solomon', () => {
  const degrees = [...new Set(ECC_ORDER.flatMap((e) => EC_CODEWORDS_PER_BLOCK[e].slice(1)))].sort((a, b) => a - b);

  it('builds generators whose roots are α^0 .. α^(n-1)', () => {
    for (const n of degrees) {
      const g = [1, ...rsGenerator(n)];
      for (let i = 0; i < n; i++) expect(evaluate(g, gfExp(i)), `degree ${n}, root ${i}`).toBe(0);
      expect(evaluate(g, gfExp(n))).not.toBe(0);
    }
  });

  it('matches the published generator for 10 error-correction codewords', () => {
    // Exponents of α for x^10 + α^251 x^9 + α^67 x^8 + ... (ISO 18004 Annex A).
    const exponents = [251, 67, 46, 61, 118, 70, 64, 94, 32, 45];
    expect(Array.from(rsGenerator(10))).toEqual(exponents.map(gfExp));
  });

  it('gives zero syndromes for random blocks at every length Table 9 uses', () => {
    const next = lcg(2026);
    for (const n of degrees) {
      for (const dataLength of [1, 15, 60, 123]) {
        const data = Array.from({ length: dataLength }, next);
        const codeword = [...data, ...rsRemainder(data, n)];
        for (let i = 0; i < n; i++) expect(evaluate(codeword, gfExp(i))).toBe(0);
      }
    }
  });
});
