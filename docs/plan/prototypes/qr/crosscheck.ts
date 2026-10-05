import { createRequire } from 'node:module';
import { encodeText, encodeSegments } from './encode';
import { makeSegment } from './segment';
import { EC_BLOCKS, EC_CODEWORDS_PER_BLOCK } from './tables';
import type { EccLevel, MaskId, SegmentMode } from './types';
const require = createRequire(process.cwd() + '/package.json');
const QR = require('qrcode');
const ecTab = require('qrcode/lib/core/error-correction-code.js');
const ECL = require('qrcode/lib/core/error-correction-level.js');
let tableErr = 0;
for (const e of ['L','M','Q','H'] as EccLevel[]) for (let v = 1; v <= 40; v++) {
  if (ecTab.getBlocksCount(v, ECL[e]) !== EC_BLOCKS[e][v]) tableErr++;
  if (ecTab.getTotalCodewordsCount(v, ECL[e]) !== EC_BLOCKS[e][v] * EC_CODEWORDS_PER_BLOCK[e][v]) tableErr++;
}
console.log('table mismatches vs qrcode:', tableErr);
function rnd(n: number, alphabet: string, seed: number) { let s = seed; let o=''; for (let i=0;i<n;i++){ s = (s*1103515245+12345)&0x7fffffff; o += alphabet[s % alphabet.length]; } return o; }
const cases: { text: string; mode: SegmentMode }[] = [
  { text: 'https://www.vesen.app', mode: 'byte' }, { text: 'https://github.com/hsalvesen/vesen', mode: 'byte' },
  { text: 'héllo wörld ☕ 🦘', mode: 'byte' }, { text: '01234567', mode: 'numeric' }, { text: 'HELLO WORLD', mode: 'alphanumeric' },
  { text: '3141592653589793238462643383279', mode: 'numeric' }, { text: 'HTTPS://WWW.VESEN.APP/$%*+-./:', mode: 'alphanumeric' },
];
for (let i = 1; i <= 60; i++) { const len = Math.floor(2955 * i / 60 * 0.98); cases.push({ text: rnd(Math.max(1, Math.floor(len/ (i%3===0?1:1))), 'abcdefghijklmnopqrstuvwxyz/:.?=&-_0123456789', i), mode: 'byte' }); }
for (let i = 1; i <= 30; i++) cases.push({ text: rnd(i * 230, '0123456789', 100 + i), mode: 'numeric' });
for (let i = 1; i <= 30; i++) cases.push({ text: rnd(i * 140, '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:', 200 + i), mode: 'alphanumeric' });
let compared = 0, mismatched = 0, skipped = 0; const versions = new Set<number>();
for (const c of cases) for (const e of ['L','M','Q','H'] as EccLevel[]) {
  let mine; try { mine = encodeSegments([makeSegment(c.text, c.mode)], { ecc: e, mask: 0 }); } catch { skipped++; continue; }
  for (let m = 0; m < 8; m++) {
    const ours = encodeSegments([makeSegment(c.text, c.mode)], { ecc: e, mask: m as MaskId, minVersion: mine.version });
    const theirs = QR.create([{ data: c.text, mode: c.mode }], { errorCorrectionLevel: e, maskPattern: m, version: ours.version });
    compared++; versions.add(ours.version);
    const td: Uint8Array = theirs.modules.data; let same = td.length === ours.modules.length;
    if (same) for (let i = 0; i < td.length; i++) if (td[i] !== ours.modules[i]) { same = false; break; }
    if (!same) { mismatched++; if (mismatched < 4) console.log('MISMATCH', c.mode, c.text.length, e, m, ours.version); }
  }
}
console.log({ compared, mismatched, skipped, versionsCovered: versions.size, minV: Math.min(...versions), maxV: Math.max(...versions) });
// auto mask agreement and auto-version agreement with qrcode default (string input = optimal segmentation)
let maskAgree = 0, maskTotal = 0, vBigger = 0, vTotal = 0; const diffs: string[] = [];
for (const c of cases) for (const e of ['L','M','Q','H'] as EccLevel[]) {
  let ours; try { ours = encodeText(c.text, { ecc: e }); } catch { continue; }
  const theirsSameSeg = QR.create([{ data: c.text, mode: ours.mode }], { errorCorrectionLevel: e, version: ours.version });
  maskTotal++; if (theirsSameSeg.maskPattern === ours.mask) maskAgree++;
  const theirsOpt = QR.create(c.text, { errorCorrectionLevel: e }); vTotal++; if (ours.version > theirsOpt.version) { vBigger++; diffs.push(`${c.text.slice(0,20)} ${e} ours v${ours.version} lib v${theirsOpt.version}`); }
}
console.log({ maskAgree, maskTotal, oursLargerVersionThanLibOptimalSegmentation: vBigger, vTotal }, diffs.slice(0,5));
