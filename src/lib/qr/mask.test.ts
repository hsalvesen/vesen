import { describe, expect, it } from 'vitest';
import { encodeText } from './encode';
import { applyMask, maskBit, penaltyIso } from './mask';
import type { EccLevel, MaskId } from './types';

function matrix(size: number, dark: (x: number, y: number) => boolean): Uint8Array {
  const m = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) m[y * size + x] = dark(x, y) ? 1 : 0;
  return m;
}

describe('penaltyIso', () => {
  it('scores an all-light square', () => {
    // 10 lines with a run of 5 (N1 3 each), 16 uniform 2×2 blocks (N2 3 each), 0% dark (k = 9).
    expect(penaltyIso(matrix(5, () => false), 5)).toEqual({ n1: 30, n2: 48, n3: 0, n4: 90, total: 168 });
  });

  it('gives a checkerboard no penalty at all', () => {
    expect(penaltyIso(matrix(5, (x, y) => (x + y) % 2 === 0), 5)).toEqual({ n1: 0, n2: 0, n3: 0, n4: 0, total: 0 });
  });

  it('counts a finder-like row once for each light side', () => {
    const row = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
    const p = penaltyIso(matrix(11, (x, y) => y === 5 && row[x] === 1), 11);
    // Rows: ten all-light rows score 9 each. Columns: five with one dark module score 6 each,
    // six all-light ones 9 each. The pattern has the quiet zone on its left and four light
    // modules on its right, so it counts twice.
    expect(p.n1).toBe(90 + 30 + 54);
    expect(p.n2).toBe((80 + 6) * 3);
    expect(p.n3).toBe(80);
    expect(p.n4).toBe(90);
    expect(p.total).toBe(602);
  });

  it('counts the pattern when the quiet zone supplies the light run', () => {
    // 1:1:3:1:1 flush against the right edge: the quiet zone is the four light modules.
    const row = [0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
    const p = penaltyIso(matrix(13, (x, y) => y === 0 && row[x] === 1), 13);
    expect(p.n3).toBe(80);
  });

  it('ignores a 1:1:3:1:1 run without four light modules on either side', () => {
    const row = [1, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 1, 1];
    expect(penaltyIso(matrix(13, (x, y) => y === 6 && row[x] === 1), 13).n3).toBe(0);
  });

  it('steps N4 by 10 for every full 5% away from half dark', () => {
    // 11×11 = 121 modules; 55% dark or less (with 45% or more) scores 0.
    const share = (dark: number): number => penaltyIso(matrix(11, (x, y) => y * 11 + x < dark), 11).n4;
    expect(share(60)).toBe(0);
    expect(share(66)).toBe(0);
    expect(share(67)).toBe(10);
    expect(share(121)).toBe(90);
  });
});

describe('masks', () => {
  it('follows the conditions of ISO 18004 Table 10 (i = row, j = column)', () => {
    const table: ((i: number, j: number) => boolean)[] = [
      (i, j) => (i + j) % 2 === 0,
      (i) => i % 2 === 0,
      (_i, j) => j % 3 === 0,
      (i, j) => (i + j) % 3 === 0,
      (i, j) => (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0,
      (i, j) => ((i * j) % 2) + ((i * j) % 3) === 0,
      (i, j) => (((i * j) % 2) + ((i * j) % 3)) % 2 === 0,
      (i, j) => (((i * j) % 3) + ((i + j) % 2)) % 2 === 0,
    ];
    for (let m = 0; m < 8; m++) {
      for (let i = 0; i < 30; i++) for (let j = 0; j < 30; j++) expect(maskBit(m as MaskId, j, i)).toBe(table[m]!(i, j));
    }
  });

  it('undoes itself and leaves function modules alone', () => {
    const size = 9;
    const original = matrix(size, (x, y) => (x * 7 + y * 3) % 5 === 0);
    const fn = matrix(size, (x) => x < 2);
    for (let m = 0; m < 8; m++) {
      const work = original.slice();
      applyMask(work, fn, size, m as MaskId);
      for (let y = 0; y < size; y++) for (let x = 0; x < 2; x++) expect(work[y * size + x]).toBe(original[y * size + x]);
      applyMask(work, fn, size, m as MaskId);
      expect(work).toEqual(original);
    }
  });

  it('picks the mask with the lowest ISO penalty, the lowest id on a tie', { timeout: 60_000 }, () => {
    const payloads: [string, EccLevel][] = [
      ['https://www.vesen.app', 'M'],
      ['HELLO WORLD', 'Q'],
      ['01234567', 'M'],
      ['Kia ora, Aotearoa', 'H'],
      ['https://github.com/hsalvesen/vesen', 'L'],
      ['x'.repeat(200), 'M'],
      ['BEGIN:VCARD\nVERSION:3.0\nFN:Has Salvesen\nEND:VCARD', 'Q'],
    ];
    for (const [text, ecc] of payloads) {
      const auto = encodeText(text, { ecc });
      const scores = Array.from({ length: 8 }, (_, m) => penaltyIso(encodeText(text, { ecc, mask: m as MaskId }).modules, auto.size).total);
      const best = Math.min(...scores);
      expect(auto.mask, text).toBe(scores.indexOf(best));
      expect(penaltyIso(auto.modules, auto.size).total).toBe(best);
    }
  });

  it('uses an injected penalty to choose the mask', () => {
    const flat = (): number => 0;
    expect(encodeText('vesen', { penalty: flat }).mask).toBe(0);
    let call = 0;
    const lastWins = (): number => 8 - call++;
    expect(encodeText('vesen', { penalty: lastWins }).mask).toBe(7);
  });
});
