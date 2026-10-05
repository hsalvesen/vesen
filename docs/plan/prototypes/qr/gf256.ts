// GF(2^8) with primitive polynomial x^8+x^4+x^3+x^2+1 (0x11D), generator alpha = 2.
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => { let x = 1; for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; } for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]; })();
export function gfMul(a: number, b: number): number { return a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]; }
export function gfExp(i: number): number { return EXP[i % 255]; }
