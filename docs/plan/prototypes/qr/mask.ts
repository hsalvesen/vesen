import type { MaskId } from './types';
export const MASKS: readonly ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0, (_x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];
/** XOR the mask over non-function modules. Self-inverse. */
export function applyMask(modules: Uint8Array, fn: Uint8Array, size: number, mask: MaskId): void {
  const f = MASKS[mask]; for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { const i = y * size + x; if (!fn[i] && f(x, y)) modules[i] ^= 1; }
}
