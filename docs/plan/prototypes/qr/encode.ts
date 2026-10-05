import { BitBuffer } from './bitBuffer';
import { applyMask } from './mask';
import { penalty } from './penalty';
import { rsRemainder } from './reedSolomon';
import { detectMode, makeSegment, segmentBits, writeSegments } from './segment';
import { dataCodewords, EC_BLOCKS, EC_CODEWORDS_PER_BLOCK, ECC_ORDER, totalCodewords } from './tables';
import { WorkGrid } from './matrix';
import { QrCapacityError, type EccLevel, type EncodeOptions, type MaskId, type QrSymbol, type Segment, type Version } from './types';

/** Split data into blocks, append RS EC to each, interleave (ISO 7.6). */
export function addEccAndInterleave(data: Uint8Array, v: Version, e: EccLevel): Uint8Array {
  const numBlocks = EC_BLOCKS[e][v], eccLen = EC_CODEWORDS_PER_BLOCK[e][v], raw = totalCodewords(v);
  const numShort = numBlocks - (raw % numBlocks), shortLen = Math.floor(raw / numBlocks);
  const blocks: number[][] = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const len = shortLen - eccLen + (i < numShort ? 0 : 1); const dat = Array.from(data.subarray(k, k + len)); k += len;
    const ecc = rsRemainder(dat, eccLen); if (i < numShort) dat.push(0); blocks.push(dat.concat(Array.from(ecc)));
  }
  const out: number[] = [];
  for (let i = 0; i < blocks[0].length; i++) blocks.forEach((b, j) => { if (i !== shortLen - eccLen || j >= numShort) out.push(b[i]); });
  return Uint8Array.from(out);
}
export function encodeSegments(segs: readonly Segment[], opts: EncodeOptions = {}): QrSymbol {
  let ecc: EccLevel = opts.ecc ?? 'M'; const minV = opts.minVersion ?? 1, maxV = opts.maxVersion ?? 40;
  let v = minV, used = Infinity;
  for (; v <= maxV; v++) { used = segmentBits(segs, v); if (used <= dataCodewords(v, ecc) * 8) break; }
  if (v > maxV) throw new QrCapacityError(segmentBits(segs, maxV), dataCodewords(maxV, ecc) * 8, ecc);
  if (opts.boostEcc) for (const e of ECC_ORDER.slice(ECC_ORDER.indexOf(ecc) + 1)) if (used <= dataCodewords(v, e) * 8) ecc = e;
  const cap = dataCodewords(v, ecc) * 8; const bb = new BitBuffer(); writeSegments(bb, segs, v);
  bb.push(0, Math.min(4, cap - bb.length)); bb.push(0, (8 - (bb.length % 8)) % 8);
  for (let pad = 0xec; bb.length < cap; pad ^= 0xec ^ 0x11) bb.push(pad, 8);
  const grid = new WorkGrid(v); grid.drawFunctionPatterns(); grid.placeCodewords(addEccAndInterleave(bb.toBytes(), v, ecc));
  let mask: MaskId;
  if (opts.mask !== undefined && opts.mask !== 'auto') mask = opts.mask;
  else { let best = Infinity; mask = 0; for (let m = 0 as MaskId; m < 8; m = (m + 1) as MaskId) { applyMask(grid.modules, grid.fn, grid.size, m); grid.drawFormat(ecc, m); const p = penalty(grid.modules, grid.size).total; if (p < best) { best = p; mask = m; } applyMask(grid.modules, grid.fn, grid.size, m); } }
  applyMask(grid.modules, grid.fn, grid.size, mask); grid.drawFormat(ecc, mask);
  return { version: v, ecc, mask, size: grid.size, modules: grid.modules, mode: segs[0]?.mode ?? 'byte', dataBytes: Math.ceil(used / 8), capacityBytes: cap / 8 };
}
export function encodeText(text: string, opts: EncodeOptions = {}): QrSymbol {
  const mode = !opts.mode || opts.mode === 'auto' ? detectMode(text) : opts.mode;
  return encodeSegments([makeSegment(text, mode)], opts);
}
