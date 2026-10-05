import { BitBuffer } from './bitBuffer';
import { makeSegment, writeSegments } from './segment';
import { dataCodewords, rawDataModules, alignmentCentres, EC_CODEWORDS_PER_BLOCK } from './tables';
import { rsRemainder } from './reedSolomon';
import { gfMul, gfExp } from './gf256';
import { WorkGrid } from './matrix';
import { segmentOptimally } from './segmenter';
import { segmentBits } from './segment';
import type { EccLevel, SegmentMode } from './types';
function dataCw(text: string, mode: SegmentMode, v: number, e: EccLevel) {
  const cap = dataCodewords(v, e) * 8, bb = new BitBuffer(); writeSegments(bb, [makeSegment(text, mode)], v);
  bb.push(0, Math.min(4, cap - bb.length)); bb.push(0, (8 - (bb.length % 8)) % 8); for (let p = 0xec; bb.length < cap; p ^= 0xec ^ 0x11) bb.push(p, 8); return Array.from(bb.toBytes());
}
const hw = dataCw('HELLO WORLD', 'alphanumeric', 1, 'M'); console.log('HELLO WORLD 1-M data', hw.join(' ')); console.log('  ec', Array.from(rsRemainder(hw, 10)).join(' '));
const iso = dataCw('01234567', 'numeric', 1, 'M'); console.log('01234567 1-M data', iso.join(' ')); console.log('  ec', Array.from(rsRemainder(iso, 10)).join(' '));
// syndromes of a full codeword must be zero
const cw = [...hw, ...rsRemainder(hw, 10)]; const synd = [...Array(10).keys()].map((i) => cw.reduce((acc, c) => gfMul(acc, gfExp(i)) ^ c, 0)); console.log('syndromes', synd.join(','));
// format strings (read back from grid positions row 8, cols 0..5,7,8 + col 8 rows 7,5..0) via computing directly
function fmt(e: EccLevel, m: number) { const fb = { L: 1, M: 0, Q: 3, H: 2 }[e]; const d = (fb << 3) | m; let r = d; for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537); return (((d << 10) | r) ^ 0x5412).toString(2).padStart(15, '0'); }
console.log('format L0', fmt('L', 0), 'M0', fmt('M', 0), 'Q0', fmt('Q', 0), 'H0', fmt('H', 0), 'M5', fmt('M', 5));
let minDist = 99; const all: number[] = []; for (const e of ['L','M','Q','H'] as EccLevel[]) for (let m = 0; m < 8; m++) all.push(parseInt(fmt(e, m), 2));
for (let i = 0; i < 32; i++) for (let j = i + 1; j < 32; j++) { let x = all[i] ^ all[j], c = 0; while (x) { c += x & 1; x >>>= 1; } minDist = Math.min(minDist, c); } console.log('format min hamming distance', minDist);
function ver(v: number) { let r = v; for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25); return ((v << 12) | r); }
console.log('version7', ver(7).toString(2).padStart(18, '0'), '0x' + ver(7).toString(16), 'v40 0x' + ver(40).toString(16));
console.log('align v2', alignmentCentres(2), 'v7', alignmentCentres(7), 'v32', alignmentCentres(32), 'v40', alignmentCentres(40));
let rawOk = 0; for (let v = 1; v <= 40; v++) { const g = new WorkGrid(v); g.drawFunctionPatterns(); const free = g.fn.reduce((a, f) => a + (f ? 0 : 1), 0); if (free === rawDataModules(v)) rawOk++; } console.log('raw module formula matches brute-force count for', rawOk, '/40 versions');
// DP segmenter vs exhaustive optimum on short strings
const alpha = 'aB1 9:Z.é'; let dpOk = 0, n = 0;
for (let s = 0; s < 400; s++) { let x = s * 2654435761 >>> 0; const len = 1 + (s % 7); let t = ''; for (let i = 0; i < len; i++) { x = (x * 1103515245 + 12345) >>> 0; t += alpha[x % alpha.length]; }
  const cps = Array.from(t); let best = Infinity;
  const modes: SegmentMode[] = ['byte', 'alphanumeric', 'numeric'];
  const ok = (ch: string, m: SegmentMode) => m === 'byte' || (m === 'numeric' ? /[0-9]/.test(ch) : /[0-9A-Z $%*+\-./:]/.test(ch));
  const rec = (i: number, assign: SegmentMode[]) => { if (i === cps.length) { const segs = []; let st = 0; for (let k = 1; k <= cps.length; k++) if (k === cps.length || assign[k] !== assign[st]) { segs.push(makeSegment(cps.slice(st, k).join(''), assign[st])); st = k; } best = Math.min(best, segmentBits(segs, 1)); return; } for (const m of modes) if (ok(cps[i], m)) rec(i + 1, [...assign, m]); };
  rec(0, []); n++; if (segmentBits(segmentOptimally(t, 1), 1) === best) dpOk++; }
console.log('DP segmenter optimal on', dpOk, '/', n, 'exhaustive cases');
