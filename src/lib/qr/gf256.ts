// GF(2^8) over the primitive polynomial x^8 + x^4 + x^3 + x^2 + 1 (0x11D), generator α = 2,
// and the Reed-Solomon encoder QR codes use (ISO 18004 section 7.5.2).

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]!;
}

export function gfMul(a: number, b: number): number {
  return a === 0 || b === 0 ? 0 : EXP[LOG[a]! + LOG[b]!]!;
}

/** α^i for any integer i ≥ 0. */
export function gfExp(i: number): number {
  return EXP[i % 255]!;
}

/** Discrete log of a non-zero element. */
export function gfLog(a: number): number {
  if (a === 0) throw new RangeError('log(0) is undefined');
  return LOG[a]!;
}

const generators = new Map<number, Uint8Array>();

/**
 * Coefficients of ∏(x - α^i) for i < degree, highest power first, without the leading 1.
 * Cached, because a symbol uses one or two block lengths.
 */
export function rsGenerator(degree: number): Uint8Array {
  const cached = generators.get(degree);
  if (cached) return cached;
  const g = new Uint8Array(degree);
  g[degree - 1] = 1;
  for (let i = 0; i < degree; i++) {
    const root = gfExp(i);
    for (let j = 0; j < degree; j++) {
      g[j] = gfMul(g[j]!, root) ^ (j + 1 < degree ? g[j + 1]! : 0);
    }
  }
  generators.set(degree, g);
  return g;
}

/** The error-correction codewords for one block: data(x)·x^degree mod generator(x). */
export function rsRemainder(data: ArrayLike<number>, degree: number): Uint8Array {
  const gen = rsGenerator(degree);
  const r = new Uint8Array(degree);
  for (let k = 0; k < data.length; k++) {
    const factor = (data[k] ?? 0) ^ r[0]!;
    r.copyWithin(0, 1);
    r[degree - 1] = 0;
    if (factor === 0) continue;
    for (let i = 0; i < degree; i++) r[i] = r[i]! ^ gfMul(gen[i]!, factor);
  }
  return r;
}
