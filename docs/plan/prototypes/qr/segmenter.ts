import { charCountBits } from './tables';
import { makeSegment } from './segment';
import type { Segment, SegmentMode, Version } from './types';
const MODES: readonly SegmentMode[] = ['byte', 'alphanumeric', 'numeric'];
const ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
const utf8Len = (cp: number) => (cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4);
/** Minimal-bit segmentation (ISO 18004 Annex J style DP, costs in sixths of a bit). Kanji omitted. */
export function segmentOptimally(text: string, v: Version): Segment[] {
  const cps = Array.from(text, (ch) => ch.codePointAt(0)!); if (cps.length === 0) return [makeSegment('', 'byte')];
  const head = MODES.map((m) => (4 + charCountBits(m, v)) * 6);
  let prev = head.slice(); const from: (SegmentMode | null)[][] = [];
  for (const c of cps) {
    const cur = [Infinity, Infinity, Infinity]; const fm: (SegmentMode | null)[] = [null, null, null];
    cur[0] = prev[0] + utf8Len(c) * 48; fm[0] = 'byte';
    const ch = String.fromCodePoint(c);
    if (ALNUM.includes(ch)) { cur[1] = prev[1] + 33; fm[1] = 'alphanumeric'; }
    if (c >= 48 && c <= 57) { cur[2] = prev[2] + 20; fm[2] = 'numeric'; }
    for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) { const nc = Math.ceil(cur[k] / 6) * 6 + head[j]; if (fm[k] !== null && (fm[j] === null || nc < cur[j])) { cur[j] = nc; fm[j] = MODES[k]; } }
    prev = cur; from.push(fm);
  }
  let state = MODES[prev.indexOf(Math.min(...prev))]; const modes: SegmentMode[] = new Array(cps.length);
  for (let i = cps.length - 1; i >= 0; i--) { state = from[i][MODES.indexOf(state)]!; modes[i] = state; }
  const segs: Segment[] = []; let start = 0;
  for (let i = 1; i <= cps.length; i++) if (i === cps.length || modes[i] !== modes[start]) { segs.push(makeSegment(String.fromCodePoint(...cps.slice(start, i)), modes[start])); start = i; }
  return segs;
}
