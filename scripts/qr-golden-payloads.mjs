// Seeded payloads for the QR golden fixture. Shared by scripts/gen-qr-golden.mjs, which writes
// tests/fixtures/qr-golden.json, and src/lib/qr/golden.test.ts, which rebuilds each payload from
// its seed, so the fixture stores a seed instead of thousands of characters.

/** Characters each generated payload draws from. */
export const ALPHABETS = {
  digits: '0123456789',
  alnum: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:',
  url: 'abcdefghijklmnopqrstuvwxyz0123456789/:.?=&-_',
  utf8: 'aZ09 :/.ĀāĒēĪīŌōŪū€☕🦉🦘中文',
};

/** @typedef {keyof typeof ALPHABETS} AlphabetName */
/** @typedef {{ seed: number, length: number, alphabet: AlphabetName }} GeneratedPayload */
/** @typedef {string | GeneratedPayload} PayloadSpec */

/**
 * mulberry32: a small 32-bit generator that behaves the same in every JavaScript engine.
 * @param {number} seed
 * @returns {() => number} uniform in [0, 1)
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The payload text: a literal string, or `length` code points drawn from an alphabet.
 * @param {PayloadSpec} spec
 * @returns {string}
 */
export function makePayload(spec) {
  if (typeof spec === 'string') return spec;
  const chars = Array.from(ALPHABETS[spec.alphabet]);
  const next = mulberry32(spec.seed);
  let text = '';
  for (let i = 0; i < spec.length; i++) text += chars[Math.floor(next() * chars.length)] ?? '';
  return text;
}
