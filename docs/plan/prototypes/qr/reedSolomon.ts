import { gfMul, gfExp } from './gf256';
const cache = new Map<number, Uint8Array>();
/** Generator polynomial prod_{i<degree}(x - alpha^i), monic leading term dropped, highest power first. */
export function rsGenerator(degree: number): Uint8Array {
  let g = cache.get(degree); if (g) return g;
  g = new Uint8Array(degree); g[degree - 1] = 1;
  for (let i = 0; i < degree; i++) { const root = gfExp(i); for (let j = 0; j < degree; j++) { g[j] = gfMul(g[j], root); if (j + 1 < degree) g[j] ^= g[j + 1]; } }
  cache.set(degree, g); return g;
}
/** Remainder of data(x)*x^degree divided by the generator: the EC codewords. */
export function rsRemainder(data: ArrayLike<number>, degree: number): Uint8Array {
  const gen = rsGenerator(degree); const r = new Uint8Array(degree);
  for (let k = 0; k < data.length; k++) { const factor = data[k] ^ r[0]; r.copyWithin(0, 1); r[degree - 1] = 0; for (let i = 0; i < degree; i++) r[i] ^= gfMul(gen[i], factor); }
  return r;
}
