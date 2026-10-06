// Data masks (ISO 18004 section 7.8.2) and the mask penalty of section 7.8.3.
import type { MaskId } from './types';

/** True where mask `mask` inverts the module at column x, row y (ISO 18004 Table 10). */
export function maskBit(mask: MaskId, x: number, y: number): boolean {
  switch (mask) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
}

/** XORs the mask over every module that is not a function module. Applying it twice undoes it. */
export function applyMask(modules: Uint8Array, fn: Uint8Array, size: number, mask: MaskId): void {
  for (let y = 0, i = 0; y < size; y++) {
    for (let x = 0; x < size; x++, i++) {
      if (fn[i] === 0 && maskBit(mask, x, y)) modules[i] = modules[i]! ^ 1;
    }
  }
}

export const PENALTY_N1 = 3;
export const PENALTY_N2 = 3;
export const PENALTY_N3 = 40;
export const PENALTY_N4 = 10;

export interface PenaltyBreakdown {
  /** Runs of five or more same-coloured modules in a row or column: 3 + (length - 5) each. */
  n1: number;
  /** 2×2 blocks of one colour: 3 each. */
  n2: number;
  /** 1:1:3:1:1 finder-like patterns with four light modules on one side: 40 each. */
  n3: number;
  /** 10 for each full 5% the dark share strays from 50%. */
  n4: number;
  total: number;
}

/**
 * Run lengths of one line, newest first: history[0] is the latest finished run. Runs alternate
 * in colour, and the run before history[0] is light whenever patterns are counted.
 */
const history = new Int32Array(7);

function pushRun(len: number, size: number): void {
  // The first run touches the edge, so the quiet zone extends it.
  if (history[0] === 0) len += size;
  history.copyWithin(1, 0, 6);
  history[0] = len;
}

/** Finder-like 1:1:3:1:1 patterns ending at the latest light run: 0, 1 or 2 (one per light side). */
function countPatterns(): number {
  const n = history[1]!;
  const core = n > 0 && history[2] === n && history[3] === n * 3 && history[4] === n && history[5] === n;
  if (!core) return 0;
  return (history[0]! >= n * 4 && history[6]! >= n ? 1 : 0) + (history[6]! >= n * 4 && history[0]! >= n ? 1 : 0);
}

/**
 * Scores one line (a row or a column) for N1 and N3. The area outside the symbol counts as
 * light, because a real symbol sits in a light quiet zone, so a finder-like pattern at the edge
 * still counts.
 */
function scoreLine(m: Uint8Array, start: number, stride: number, size: number, acc: { n1: number; n3: number }): void {
  history.fill(0);
  let colour = 0;
  let run = 0;
  for (let k = 0, i = start; k < size; k++, i += stride) {
    const c = m[i]!;
    if (c === colour) {
      run++;
      if (run === 5) acc.n1 += PENALTY_N1;
      else if (run > 5) acc.n1 += 1;
    } else {
      pushRun(run, size);
      if (colour === 0) acc.n3 += countPatterns() * PENALTY_N3;
      colour = c;
      run = 1;
    }
  }
  // Close the line: finish a dark run, then let the quiet zone extend the final light run.
  if (colour === 1) {
    pushRun(run, size);
    run = 0;
  }
  pushRun(run + size, size);
  acc.n3 += countPatterns() * PENALTY_N3;
}

/** The ISO 18004 section 7.8.3 penalty of a masked symbol with its format information drawn. */
export function penaltyIso(m: Uint8Array, size: number): PenaltyBreakdown {
  const acc = { n1: 0, n3: 0 };
  for (let y = 0; y < size; y++) scoreLine(m, y * size, 1, size, acc);
  for (let x = 0; x < size; x++) scoreLine(m, x, size, size, acc);

  let n2 = 0;
  let dark = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const c = m[i]!;
      dark += c;
      if (x < size - 1 && y < size - 1 && c === m[i + 1] && c === m[i + size] && c === m[i + size + 1]) n2 += PENALTY_N2;
    }
  }

  const total = size * size;
  // The smallest k ≥ 0 with (45 - 5k)% ≤ dark share ≤ (55 + 5k)%. size is odd, so the share is never exactly 50%.
  const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
  const n4 = k * PENALTY_N4;
  return { n1: acc.n1, n2, n3: acc.n3, n4, total: acc.n1 + n2 + acc.n3 + n4 };
}

/** The total ISO penalty, in the shape the encoder's penalty option takes. */
export function penaltyScore(m: Uint8Array, size: number): number {
  return penaltyIso(m, size).total;
}
