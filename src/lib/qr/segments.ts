// Segment encoding (ISO 18004 sections 7.4.3 to 7.4.5): numeric, alphanumeric and UTF-8 byte mode.
import { BitBuffer } from './bits';
import { charCountBits, MODE_INDICATOR } from './tables';
import type { Segment, SegmentMode, Version } from './types';

/** The 45 characters of alphanumeric mode, in code order. */
export const ALPHANUMERIC_CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

const NUMERIC = /^[0-9]*$/;
const ALPHANUMERIC = /^[0-9A-Z $%*+\-./:]*$/;

const utf8 = new TextEncoder();

export function isNumeric(text: string): boolean {
  return NUMERIC.test(text);
}

export function isAlphanumeric(text: string): boolean {
  return ALPHANUMERIC.test(text);
}

/** The most compact single mode that can hold all of `text`. */
export function detectMode(text: string): SegmentMode {
  return isNumeric(text) ? 'numeric' : isAlphanumeric(text) ? 'alphanumeric' : 'byte';
}

export function utf8Bytes(text: string): Uint8Array {
  return utf8.encode(text);
}

/** Encodes `text` as one segment of `mode`; throws a TypeError when the text has characters the mode lacks. */
export function makeSegment(text: string, mode: SegmentMode): Segment {
  const bb = new BitBuffer();
  if (mode === 'numeric') {
    if (!isNumeric(text)) throw new TypeError('numeric mode takes only the digits 0-9');
    for (let i = 0; i < text.length; i += 3) {
      const group = text.slice(i, i + 3);
      bb.push(parseInt(group, 10), group.length * 3 + 1);
    }
    return { mode, text, charCount: text.length, bits: bb.bits };
  }
  if (mode === 'alphanumeric') {
    if (!isAlphanumeric(text)) throw new TypeError(`alphanumeric mode takes only ${ALPHANUMERIC_CHARSET}`);
    let i = 0;
    for (; i + 2 <= text.length; i += 2) {
      bb.push(ALPHANUMERIC_CHARSET.indexOf(text.charAt(i)) * 45 + ALPHANUMERIC_CHARSET.indexOf(text.charAt(i + 1)), 11);
    }
    if (i < text.length) bb.push(ALPHANUMERIC_CHARSET.indexOf(text.charAt(i)), 6);
    return { mode, text, charCount: text.length, bits: bb.bits };
  }
  const bytes = utf8Bytes(text);
  for (const b of bytes) bb.push(b, 8);
  return { mode, text, charCount: bytes.length, bits: bb.bits };
}

/** Bits the segments need at version `v`, headers included; Infinity when a character count overflows its field. */
export function segmentBits(segs: readonly Segment[], v: Version): number {
  let n = 0;
  for (const s of segs) {
    const cc = charCountBits(s.mode, v);
    if (s.charCount >= 1 << cc) return Infinity;
    n += 4 + cc + s.bits.length;
  }
  return n;
}

/** Appends each segment's mode indicator, character count and data. */
export function writeSegments(bb: BitBuffer, segs: readonly Segment[], v: Version): void {
  for (const s of segs) {
    bb.push(MODE_INDICATOR[s.mode], 4);
    bb.push(s.charCount, charCountBits(s.mode, v));
    bb.append(s.bits);
  }
}
