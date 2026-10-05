// ISO/IEC 18004 section 7.8.3 mask evaluation. N3 treats the area outside the symbol as light (quiet zone), as the spec intends.
const N1 = 3, N2 = 3, N3 = 40, N4 = 10;
export interface PenaltyBreakdown { n1: number; n2: number; n3: number; n4: number; total: number; }
export function penalty(m: Uint8Array, size: number): PenaltyBreakdown {
  let n1 = 0, n3 = 0, n2 = 0;
  const line = (get: (i: number) => number) => {
    let runColor = 0, run = 0; const hist = [0, 0, 0, 0, 0, 0, 0];
    const add = (len: number) => { if (hist[0] === 0) len += size; hist.pop(); hist.unshift(len); };
    const count = () => { const n = hist[1]; const core = n > 0 && hist[2] === n && hist[3] === n * 3 && hist[4] === n && hist[5] === n; return (core && hist[0] >= n * 4 && hist[6] >= n ? 1 : 0) + (core && hist[6] >= n * 4 && hist[0] >= n ? 1 : 0); };
    for (let i = 0; i < size; i++) {
      const c = get(i);
      if (c === runColor) { run++; if (run === 5) n1 += N1; else if (run > 5) n1++; }
      else { add(run); if (!runColor) n3 += count() * N3; runColor = c; run = 1; }
    }
    if (runColor) { add(run); run = 0; } run += size; add(run); n3 += count() * N3;
  };
  for (let y = 0; y < size; y++) line((x) => m[y * size + x]);
  for (let x = 0; x < size; x++) line((y) => m[y * size + x]);
  let dark = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const c = m[y * size + x]; dark += c;
    if (x < size - 1 && y < size - 1 && c === m[y * size + x + 1] && c === m[(y + 1) * size + x] && c === m[(y + 1) * size + x + 1]) n2 += N2;
  }
  const total = size * size; const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1; const n4 = k * N4;
  return { n1, n2, n3, n4, total: n1 + n2 + n3 + n4 };
}
