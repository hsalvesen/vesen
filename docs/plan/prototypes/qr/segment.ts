import { BitBuffer } from './bitBuffer';
import { charCountBits, MODE_INDICATOR } from './tables';
import type { Segment, SegmentMode, Version } from './types';
const NUMERIC = /^[0-9]*$/;
const ALNUM_CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
const ALNUM = /^[0-9A-Z $%*+\-./:]*$/;
export function detectMode(text: string): SegmentMode { return NUMERIC.test(text) ? 'numeric' : ALNUM.test(text) ? 'alphanumeric' : 'byte'; }
export function makeSegment(text: string, mode: SegmentMode): Segment {
  const bb = new BitBuffer();
  if (mode === 'numeric') {
    if (!NUMERIC.test(text)) throw new TypeError('not numeric');
    for (let i = 0; i < text.length; i += 3) { const chunk = text.slice(i, i + 3); bb.push(parseInt(chunk, 10), chunk.length * 3 + 1); }
    return { text, mode, charCount: text.length, bits: bb.bits };
  }
  if (mode === 'alphanumeric') {
    if (!ALNUM.test(text)) throw new TypeError('not alphanumeric');
    let i = 0; for (; i + 2 <= text.length; i += 2) bb.push(ALNUM_CHARSET.indexOf(text[i]) * 45 + ALNUM_CHARSET.indexOf(text[i + 1]), 11);
    if (i < text.length) bb.push(ALNUM_CHARSET.indexOf(text[i]), 6);
    return { text, mode, charCount: text.length, bits: bb.bits };
  }
  const bytes = new TextEncoder().encode(text); for (const b of bytes) bb.push(b, 8);
  return { text, mode, charCount: bytes.length, bits: bb.bits };
}
/** Total bits for the segment list at this version, or Infinity if a count field overflows. */
export function segmentBits(segs: readonly Segment[], v: Version): number {
  let n = 0; for (const s of segs) { const cc = charCountBits(s.mode, v); if (s.charCount >= 1 << cc) return Infinity; n += 4 + cc + s.bits.length; } return n;
}
export function writeSegments(bb: BitBuffer, segs: readonly Segment[], v: Version): void {
  for (const s of segs) { bb.push(MODE_INDICATOR[s.mode], 4); bb.push(s.charCount, charCountBits(s.mode, v)); bb.append(s.bits); }
}
