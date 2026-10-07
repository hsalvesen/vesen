// Saving the session snapshot (session-snapshot.ts): what goes into it, within its size, and
// writing it to sessionStorage. App loads this just after the first paint, as it does the status
// line; before then nothing on the screen is worth putting back after Back.

import { out, type Block, type Line, type Span } from '../output/model';
import { SNAPSHOT_KEY, SNAPSHOT_MAX_CHARS, type SnapshotEntry, type SnapshotSource } from './session-snapshot';
import { STORAGE_LIMITS } from './storage-keys';
import type { KV } from './types';

/**
 * What never goes into a snapshot: tap actions, live bindings, swatches and a rich card's view
 * model. Chips are only actions, so they go whole. The restore checks everything again.
 */
const DROPPED = new Set(['action', 'live', 'swatches', 'props']);

function strip(key: string, value: unknown): unknown {
  if (DROPPED.has(key)) return undefined;
  if (key === 'blocks' && Array.isArray(value)) return value.filter((block: { type?: unknown }) => block?.type !== 'chips');
  return value;
}

/** Put first in an entry whose output was too long to keep whole. */
export const NOT_KEPT_NOTE = '(earlier output not kept)';

type KeptEntry = Pick<SnapshotEntry, 'prompt' | 'line' | 'blocks' | 'status' | 'state'>;

/** A stringified piece of the snapshot, or null when it cannot be (a cycle, a BigInt). */
function stringify(value: unknown): string | null {
  try {
    return JSON.stringify(value, strip) ?? null;
  } catch {
    return null;
  }
}

/** What a kept block costs besides its lines: `{"type":"lines","lines":[],"stream":"stdout"}`. */
const BLOCK_OVERHEAD = 64;

/** `line`, cut from its start to about `room` characters of JSON; null if nothing fits. */
function lineTail(line: Line, room: number): Line | null {
  const kept: Span[] = [];
  let left = room;
  for (let i = line.length - 1; i >= 0; i -= 1) {
    const span = line[i];
    if (span === undefined) continue;
    const cost = (stringify(span) ?? '').length + 1;
    if (cost <= left) {
      kept.unshift(span);
      left -= cost;
      continue;
    }
    // Part of this span: as many of its last characters as fit, however JSON escapes them.
    const perChar = Math.max(1, cost / Math.max(1, span.text.length));
    const take = Math.floor((left - 32) / perChar);
    if (take > 0) kept.unshift({ ...span, text: span.text.slice(-take) });
    break;
  }
  return kept.length === 0 ? null : kept;
}

/**
 * The end of an entry too long to keep whole, within `room` characters: its echo line, a dim
 * note that earlier output was not kept, then as many of its last lines as fit.
 */
function entryTail(entry: KeptEntry, room: number): string | null {
  const note = out.lines([[out.span(NOT_KEPT_NOTE, { dim: true })]]);
  const bare = stringify({ ...entry, blocks: [note] });
  if (bare === null || bare.length > room) return null;
  let left = room - bare.length;
  const kept: Block[] = [];
  for (let b = entry.blocks.length - 1; b >= 0 && left > 0; b -= 1) {
    const block = entry.blocks[b];
    if (block === undefined) continue;
    if (block.type !== 'lines') {
      const cost = (stringify(block) ?? '').length + 1;
      if (cost > left) break;
      kept.unshift(block);
      left -= cost;
      continue;
    }
    left -= BLOCK_OVERHEAD;
    const lines: Line[] = [];
    let full = true;
    for (let i = block.lines.length - 1; i >= 0; i -= 1) {
      const line = block.lines[i] ?? [];
      const cost = (stringify(line) ?? '').length + 1;
      if (cost <= left) {
        lines.unshift(line);
        left -= cost;
        continue;
      }
      // Not even the last line fits whole: its end does.
      const cut = lines.length === 0 && kept.length === 0 ? lineTail(line, left) : null;
      if (cut !== null) lines.unshift(cut);
      full = false;
      break;
    }
    if (lines.length > 0) kept.unshift({ ...block, lines });
    if (!full) break;
  }
  const piece = stringify({ ...entry, blocks: [note, ...kept] });
  if (piece !== null && piece.length <= room) return piece;
  return bare;
}

/**
 * The snapshot as JSON: the last 50 finished entries, stripped, and the rest of the page's state,
 * within SNAPSHOT_MAX_CHARS. One pass, newest entry first, each stringified once (it runs inside
 * pagehide and before a link tap leaves the page): entries are kept while they fit, and the
 * newest, if it alone is too long, keeps its end.
 */
export function snapshotJson(source: SnapshotSource, now: number): string | null {
  const entries: KeptEntry[] = source.entries
    .filter((entry) => entry.state !== 'running')
    .slice(-STORAGE_LIMITS.sessionEntries)
    .map(({ prompt, line, blocks, status, state }) => ({ prompt, line, blocks, status, state: state as SnapshotEntry['state'] }));
  const head = stringify({
    v: 1,
    savedAt: now,
    line: source.line ?? '',
    cwd: source.cwd,
    scroll: { top: Math.max(0, Math.round(source.scroll.top)), atBottom: source.scroll.atBottom },
  });
  if (head === null) return null;
  const open = `${head.slice(0, -1)},"entries":[`;
  const room = SNAPSHOT_MAX_CHARS - open.length - 2;
  if (room < 0) return null;
  const pieces: string[] = [];
  let used = 0;
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (entry === undefined) continue;
    const comma = pieces.length > 0 ? 1 : 0;
    const piece = stringify(entry);
    if (piece !== null && used + comma + piece.length <= room) {
      pieces.push(piece);
      used += comma + piece.length;
      continue;
    }
    if (pieces.length === 0) {
      const tail = entryTail(entry, room);
      if (tail !== null) pieces.push(tail);
    }
    break;
  }
  return `${open}${pieces.reverse().join(',')}]}`;
}

/** Saves the snapshot; false when it could not be. */
export function saveSnapshot(storage: KV<'session'>, source: SnapshotSource, now: number): boolean {
  const text = snapshotJson(source, now);
  return text !== null && storage.set(SNAPSHOT_KEY, text);
}
