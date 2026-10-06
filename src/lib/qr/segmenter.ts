// Optimal mixed-mode segmentation: the shortest split of a text into numeric, alphanumeric
// and byte segments at a given version (in the style of ISO 18004 Annex J). Costs are kept in
// sixths of a bit, so a digit costs 20 (10 bits per 3) and an alphanumeric character 33
// (11 bits per 2); rounding up to whole bits at each segment end makes the totals exact.
import { makeSegment, ALPHANUMERIC_CHARSET } from './segments';
import { charCountBits } from './tables';
import type { Segment, SegmentMode, Version } from './types';

const MODES: readonly SegmentMode[] = ['byte', 'alphanumeric', 'numeric'];

function utf8Length(cp: number): number {
  return cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
}

/**
 * Splits `text` into segments that need the fewest bits at version `v`. Iterates by code point.
 * Empty text needs no segment at all.
 */
export function segmentOptimally(text: string, v: Version): Segment[] {
  const chars = Array.from(text);
  if (chars.length === 0) return [];

  const head = MODES.map((m) => (4 + charCountBits(m, v)) * 6);
  // prev[j]: least cost of the prefix so far, ending in a segment of MODES[j].
  let prev = head.slice();
  // from[i][j]: mode of character i on the cheapest path whose segment at i ends in MODES[j].
  const from: (SegmentMode | null)[][] = [];

  for (const ch of chars) {
    const cp = ch.codePointAt(0) ?? 0;
    const cur = [Infinity, Infinity, Infinity];
    const mode: (SegmentMode | null)[] = [null, null, null];

    cur[0] = prev[0]! + utf8Length(cp) * 48;
    mode[0] = 'byte';
    if (ALPHANUMERIC_CHARSET.indexOf(ch) !== -1) {
      cur[1] = prev[1]! + 33;
      mode[1] = 'alphanumeric';
    }
    if (cp >= 0x30 && cp <= 0x39) {
      cur[2] = prev[2]! + 20;
      mode[2] = 'numeric';
    }

    // Close the segment here and open one of another mode, when that is cheaper.
    for (let to = 0; to < 3; to++) {
      for (let fromMode = 0; fromMode < 3; fromMode++) {
        if (mode[fromMode] === null) continue;
        const cost = Math.ceil(cur[fromMode]! / 6) * 6 + head[to]!;
        if (mode[to] === null || cost < cur[to]!) {
          cur[to] = cost;
          mode[to] = MODES[fromMode]!;
        }
      }
    }
    prev = cur;
    from.push(mode);
  }

  let best = 0;
  for (let j = 1; j < 3; j++) if (prev[j]! < prev[best]!) best = j;

  const modes: SegmentMode[] = new Array<SegmentMode>(chars.length);
  let state: SegmentMode = MODES[best]!;
  for (let i = chars.length - 1; i >= 0; i--) {
    state = from[i]![MODES.indexOf(state)] ?? 'byte';
    modes[i] = state;
  }

  const segs: Segment[] = [];
  let start = 0;
  for (let i = 1; i <= chars.length; i++) {
    if (i === chars.length || modes[i] !== modes[start]) {
      segs.push(makeSegment(chars.slice(start, i).join(''), modes[start]!));
      start = i;
    }
  }
  return segs;
}
