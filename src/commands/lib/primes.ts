// Prime factors for factor: trial division by the small primes, then Miller-Rabin to know a prime
// when it sees one and Pollard's rho (Brent's variant) to split what is left. Numbers are capped
// at 2^64 - 1, where every step finishes in milliseconds: a JavaScript loop cannot be
// interrupted, so a number that could take minutes is refused instead of freezing the page.

/** The largest number factor takes. */
export const FACTOR_MAX = (1n << 64n) - 1n;

const SMALL_LIMIT = 1000;

/** The primes below SMALL_LIMIT, for trial division. */
const SMALL_PRIMES: readonly bigint[] = (() => {
  const sieve = new Uint8Array(SMALL_LIMIT);
  const primes: bigint[] = [];
  for (let n = 2; n < SMALL_LIMIT; n += 1) {
    if (sieve[n] === 1) continue;
    primes.push(BigInt(n));
    for (let m = n * n; m < SMALL_LIMIT; m += n) sieve[m] = 1;
  }
  return primes;
})();

/** Bases that decide Miller-Rabin exactly for every number below 2^64. */
const WITNESSES: readonly bigint[] = [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n];

function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  let result = 1n;
  let b = base % modulus;
  let e = exponent;
  while (e > 0n) {
    if ((e & 1n) === 1n) result = (result * b) % modulus;
    b = (b * b) % modulus;
    e >>= 1n;
  }
  return result;
}

/** True when `n` is prime; exact for every n up to FACTOR_MAX. */
export function isPrime(n: bigint): boolean {
  if (n < 2n) return false;
  for (const p of WITNESSES) {
    if (n === p) return true;
    if (n % p === 0n) return false;
  }
  let d = n - 1n;
  let s = 0;
  while ((d & 1n) === 0n) {
    d >>= 1n;
    s += 1;
  }
  for (const a of WITNESSES) {
    let x = modPow(a, d, n);
    if (x === 1n || x === n - 1n) continue;
    let composite = true;
    for (let i = 1; i < s; i += 1) {
      x = (x * x) % n;
      if (x === n - 1n) {
        composite = false;
        break;
      }
    }
    if (composite) return false;
  }
  return true;
}

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) [x, y] = [y, x % y];
  return x;
}

/** A factor of the odd composite `n` other than 1 and n, by Brent's rho. */
function rho(n: bigint): bigint {
  for (let c = 1n; ; c += 1n) {
    const f = (x: bigint): bigint => (x * x + c) % n;
    let y = 2n;
    let r = 1;
    let q = 1n;
    let g = 1n;
    let x = y;
    let ys = y;
    const m = 128;
    while (g === 1n) {
      x = y;
      for (let i = 0; i < r; i += 1) y = f(y);
      for (let k = 0; k < r && g === 1n; k += m) {
        ys = y;
        for (let i = 0; i < Math.min(m, r - k); i += 1) {
          y = f(y);
          q = (q * (x > y ? x - y : y - x)) % n;
        }
        g = gcd(q, n);
      }
      r *= 2;
    }
    if (g === n) {
      // The batch overshot: step one at a time from where it started.
      do {
        ys = f(ys);
        g = gcd(x > ys ? x - ys : ys - x, n);
      } while (g === 1n);
    }
    if (g !== n) return g;
  }
}

/** The prime factors of `n` (1 < n <= FACTOR_MAX), smallest first, with repeats; none for 0 and 1. */
export function primeFactors(n: bigint): bigint[] {
  const factors: bigint[] = [];
  let rest = n;
  if (rest < 2n) return factors;
  for (const p of SMALL_PRIMES) {
    if (p * p > rest) break;
    while (rest % p === 0n) {
      factors.push(p);
      rest /= p;
    }
  }
  const pending = rest > 1n ? [rest] : [];
  while (pending.length > 0) {
    const m = pending.pop() ?? 1n;
    if (m === 1n) continue;
    if (isPrime(m)) {
      factors.push(m);
      continue;
    }
    const d = rho(m);
    pending.push(d, m / d);
  }
  return factors.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** A whole number as factor reads one: decimal digits, an optional leading +, spaces around. */
export function parseWhole(word: string): bigint | null {
  const trimmed = word.trim();
  if (!/^\+?\d+$/.test(trimmed)) return null;
  return BigInt(trimmed.replace(/^\+/, ''));
}
