// The pager's model: what less, more and man hand the Pager app (src/ui/apps/Pager.svelte)
// through ctx.tty.fullscreen, and what the app does with it. Lines are wrapped to the screen as
// less wraps them, at the last column rather than between words; the keys are less's; searches
// look for the text as typed, never a regular expression, so a pattern cannot freeze the page.
// Pure and DOM-free, so the commands and the app share it and node tests it.

import type { Line, SpanStyle } from '../output/model';

/** What the pager hands back when the visitor closes it. Anything else: it never showed. */
export const PAGER_CLOSED = 'pager-closed';

/** less pages until q; more also ends when a page forward goes past the end. */
export type PagerMode = 'less' | 'more';

/** The Pager app's view model. */
export interface PagerView {
  /** The status line's name for it: a file name, `(standard input)`, `Manual page ls(1)`. */
  readonly title: string;
  readonly lines: readonly Line[];
  readonly mode: PagerMode;
  /** A touch screen: a toolbar along the bottom, and swipes scroll. */
  readonly touch: boolean;
  /** The terminal's size, used until the pager has measured its own. */
  readonly columns: number;
  readonly rows: number;
  /** less -N: each line's number before it. */
  readonly numbers?: boolean;
  /** less -i: searches ignore case even when they have capitals in them. */
  readonly ignoreCase?: boolean;
  /** Said on the status line when the pager opens, such as that the input was cut short. */
  readonly note?: string;
}

const TEXT_LIMIT = 200;

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value.slice(0, TEXT_LIMIT) : fallback;
}

function count(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1 ? Math.floor(value) : fallback;
}

/** A view read defensively, as the Shutdown app reads its own: whatever is malformed is left out. */
export function asPagerView(value: unknown): PagerView {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Partial<Record<keyof PagerView, unknown>>;
  const lines: Line[] = [];
  if (Array.isArray(raw.lines)) {
    for (const line of raw.lines as unknown[]) {
      if (!Array.isArray(line)) continue;
      lines.push(
        (line as unknown[]).filter(
          (span): span is Line[number] => typeof span === 'object' && span !== null && typeof (span as { text?: unknown }).text === 'string',
        ),
      );
    }
  }
  const note = typeof raw.note === 'string' && raw.note !== '' ? { note: raw.note.slice(0, TEXT_LIMIT) } : {};
  return {
    title: text(raw.title, '(standard input)'),
    lines,
    mode: raw.mode === 'more' ? 'more' : 'less',
    touch: raw.touch === true,
    columns: count(raw.columns, 80),
    rows: count(raw.rows, 24),
    numbers: raw.numbers === true,
    ignoreCase: raw.ignoreCase === true,
    ...note,
  };
}

// ── Lines and rows ─────────────────────────────────────────────────────────────────────────

/** A piece of a line in one style. */
export interface Piece {
  readonly text: string;
  readonly style?: SpanStyle;
}

/** A line as the pager shows it: tabs expanded to spaces, control characters gone, no actions. */
export interface PagerLine {
  readonly pieces: readonly Piece[];
  readonly text: string;
}

/** One row of the screen: a whole line, or the part of a long one that fits. */
export interface Row {
  /** The line it belongs to, counting from 0. */
  readonly line: number;
  /** Where it starts and ends in that line's text, in UTF-16 units. */
  readonly start: number;
  readonly end: number;
  readonly pieces: readonly Piece[];
}

export const TAB_STOP = 8;

const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

/** How many characters wide `text` is: its code points, with each surrogate pair as one. */
function widthOf(text: string): number {
  let width = 0;
  for (let i = 0; i < text.length; i += 1) {
    const unit = text.charCodeAt(i);
    if (unit < 0xdc00 || unit > 0xdfff) width += 1;
  }
  return width;
}
const NEEDS_CARE = /[\t\u0000-\u001f\u007f-\u009f]/;

/**
 * The lines with tabs expanded to the next multiple of eight columns and other control
 * characters dropped, as less shows them. Styles stay; links and tap actions go, since a pager
 * only shows text.
 */
export function prepareLines(lines: readonly Line[]): PagerLine[] {
  return lines.map((line) => {
    const pieces: Piece[] = [];
    let column = 0;
    for (const span of line) {
      let shown: string;
      if (!NEEDS_CARE.test(span.text)) {
        shown = span.text;
        column += widthOf(shown);
      } else {
        shown = '';
        for (const ch of span.text) {
          if (ch === '\t') {
            const spaces = TAB_STOP - (column % TAB_STOP);
            shown += ' '.repeat(spaces);
            column += spaces;
          } else if (!CONTROL.test(ch)) {
            shown += ch;
            column += 1;
          }
        }
      }
      if (shown !== '') pieces.push(span.style === undefined ? { text: shown } : { text: shown, style: span.style });
    }
    return { pieces, text: pieces.map((piece) => piece.text).join('') };
  });
}

/** The lines cut into rows of at most `columns` characters; an empty line is one empty row. */
export function wrapRows(lines: readonly PagerLine[], columns: number): Row[] {
  const width = Math.max(1, Math.floor(columns));
  const rows: Row[] = [];
  lines.forEach((line, index) => {
    if (line.text === '') {
      rows.push({ line: index, start: 0, end: 0, pieces: [] });
      return;
    }
    let pieces: Piece[] = [];
    let start = 0;
    let offset = 0;
    let used = 0;
    const finish = (): void => {
      rows.push({ line: index, start, end: offset, pieces });
      pieces = [];
      start = offset;
      used = 0;
    };
    for (const piece of line.pieces) {
      let part = '';
      for (const ch of piece.text) {
        if (used === width) {
          if (part !== '') pieces.push(piece.style === undefined ? { text: part } : { text: part, style: piece.style });
          part = '';
          finish();
        }
        part += ch;
        offset += ch.length;
        used += 1;
      }
      if (part !== '') pieces.push(piece.style === undefined ? { text: part } : { text: part, style: piece.style });
    }
    finish();
  });
  return rows;
}

/** The first row of each line, so a line found by a search can be scrolled to. */
export function firstRowOf(rows: readonly Row[], line: number): number {
  let low = 0;
  let high = rows.length - 1;
  let found = rows.length === 0 ? 0 : rows.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const row = rows[mid];
    if (row === undefined) break;
    if (row.line >= line) {
      found = mid;
      high = mid - 1;
    } else low = mid + 1;
  }
  return found;
}

// ── Searching ──────────────────────────────────────────────────────────────────────────────

/**
 * Whether a search for `query` ignores case: always with -i, otherwise unless the query has a
 * capital in it, as less -i does, so `/theme` finds Theme and `/Theme` only Theme.
 */
export function ignoresCase(query: string, ignoreCase = false): boolean {
  return ignoreCase || query === query.toLowerCase();
}

/** Where `query` is in `text`, as [start, end) pairs that do not overlap; none for an empty query. */
export function matchRanges(text: string, query: string, ignoreCase = false): [number, number][] {
  if (query === '') return [];
  const fold = ignoresCase(query, ignoreCase);
  const haystack = fold ? text.toLowerCase() : text;
  const needle = fold ? query.toLowerCase() : query;
  // toLowerCase keeps the length of almost every string; where it does not, search as typed.
  const sameLength = haystack.length === text.length;
  const hay = sameLength ? haystack : text;
  const pin = sameLength ? needle : query;
  const ranges: [number, number][] = [];
  for (let at = hay.indexOf(pin); at !== -1; at = hay.indexOf(pin, at + pin.length)) ranges.push([at, at + pin.length]);
  return ranges;
}

/**
 * The next line holding `query`, from line `from` onwards (forwards, direction 1) or backwards
 * (-1), `from` included; null when there is none. The search does not wrap round, as in less.
 */
export function findLine(lines: readonly PagerLine[], query: string, from: number, direction: 1 | -1, ignoreCase = false): number | null {
  if (query === '') return null;
  const fold = ignoresCase(query, ignoreCase);
  const needle = fold ? query.toLowerCase() : query;
  for (let index = from; index >= 0 && index < lines.length; index += direction) {
    const line = lines[index];
    if (line === undefined) continue;
    if ((fold ? line.text.toLowerCase() : line.text).includes(needle)) return index;
  }
  return null;
}

/** A piece of a row, marked where a search matched. */
export interface Segment extends Piece {
  readonly hit: boolean;
}

/**
 * A row's pieces split where the matches in its line begin and end, so each match can be drawn
 * highlighted, even one that runs on from the row before. `ranges` are the line's, in its text.
 */
export function segments(row: Row, ranges: readonly (readonly [number, number])[]): Segment[] {
  const local = ranges
    .map(([start, end]) => [Math.max(start, row.start) - row.start, Math.min(end, row.end) - row.start] as const)
    .filter(([start, end]) => end > start);
  if (local.length === 0) return row.pieces.map((piece) => ({ ...piece, hit: false }));
  const result: Segment[] = [];
  let offset = 0;
  for (const piece of row.pieces) {
    const pieceEnd = offset + piece.text.length;
    let at = offset;
    while (at < pieceEnd) {
      const inside = local.find(([start, end]) => start <= at && at < end);
      const nextBoundary = inside
        ? Math.min(inside[1], pieceEnd)
        : Math.min(pieceEnd, ...local.filter(([start]) => start > at).map(([start]) => start));
      const part = piece.text.slice(at - offset, nextBoundary - offset);
      result.push(piece.style === undefined ? { text: part, hit: inside !== undefined } : { text: part, style: piece.style, hit: inside !== undefined });
      at = nextBoundary;
    }
    offset = pieceEnd;
  }
  return result;
}

// ── Moving ─────────────────────────────────────────────────────────────────────────────────

export type PagerCommand =
  | 'lineDown'
  | 'lineUp'
  | 'pageDown'
  | 'pageUp'
  | 'halfDown'
  | 'halfUp'
  | 'top'
  | 'bottom'
  | 'searchForward'
  | 'searchBackward'
  | 'next'
  | 'previous'
  | 'help'
  | 'quit';

export interface KeyPress {
  readonly key: string;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly altKey?: boolean;
}

const PLAIN_KEYS: Readonly<Record<string, PagerCommand>> = {
  q: 'quit',
  Q: 'quit',
  Escape: 'quit',
  ' ': 'pageDown',
  f: 'pageDown',
  z: 'pageDown',
  PageDown: 'pageDown',
  b: 'pageUp',
  w: 'pageUp',
  PageUp: 'pageUp',
  j: 'lineDown',
  e: 'lineDown',
  ArrowDown: 'lineDown',
  Enter: 'lineDown',
  k: 'lineUp',
  y: 'lineUp',
  ArrowUp: 'lineUp',
  d: 'halfDown',
  u: 'halfUp',
  g: 'top',
  '<': 'top',
  Home: 'top',
  G: 'bottom',
  '>': 'bottom',
  End: 'bottom',
  '/': 'searchForward',
  '?': 'searchBackward',
  n: 'next',
  N: 'previous',
  h: 'help',
  H: 'help',
};

const CTRL_KEYS: Readonly<Record<string, PagerCommand>> = {
  f: 'pageDown',
  v: 'pageDown',
  b: 'pageUp',
  n: 'lineDown',
  e: 'lineDown',
  j: 'lineDown',
  p: 'lineUp',
  y: 'lineUp',
  k: 'lineUp',
  d: 'halfDown',
  u: 'halfUp',
};

/** less's meaning for a key, or null for one it leaves alone (Cmd+C copies, say). */
export function pagerCommand(press: KeyPress): PagerCommand | null {
  if (press.metaKey === true) return null;
  if (press.ctrlKey === true) return press.altKey === true ? null : (CTRL_KEYS[press.key.toLowerCase()] ?? null);
  if (press.altKey === true) return press.key === 'v' ? 'pageUp' : null;
  return Object.prototype.hasOwnProperty.call(PLAIN_KEYS, press.key) ? (PLAIN_KEYS[press.key] ?? null) : null;
}

/** The furthest down the first row on the screen can be: the last page shows the end. */
export function maxTop(total: number, page: number): number {
  return Math.max(0, total - Math.max(1, page));
}

export function clampTop(top: number, total: number, page: number): number {
  return Math.min(Math.max(0, Math.round(top)), maxTop(total, page));
}

/** Where the first row on the screen goes for a moving command; others leave it where it is. */
export function moveTop(top: number, command: PagerCommand, page: number, total: number): number {
  const size = Math.max(1, page);
  const half = Math.max(1, Math.floor(size / 2));
  const steps: Partial<Record<PagerCommand, number>> = {
    lineDown: top + 1,
    lineUp: top - 1,
    pageDown: top + size,
    pageUp: top - size,
    halfDown: top + half,
    halfUp: top - half,
    top: 0,
    bottom: Number.MAX_SAFE_INTEGER,
  };
  const next = steps[command];
  return next === undefined ? top : clampTop(next, total, size);
}

/** How far through the text the bottom of the screen is, in whole per cent. */
export function percentThrough(top: number, page: number, total: number): number {
  if (total === 0) return 100;
  return Math.min(100, Math.floor((Math.min(total, top + Math.max(1, page)) / total) * 100));
}

/** The help that h shows, in the pager itself; q goes back to the text. It fits a phone. */
export const PAGER_HELP: readonly string[] = [
  '      SUMMARY OF PAGER COMMANDS',
  '',
  '  q Q Esc         Leave the pager.',
  '  Space f PgDn    Forward a screen.',
  '  b PgUp          Back a screen.',
  '  j e Enter Down  Forward a line.',
  '  k y Up          Back a line.',
  '  d ^D            Forward half a screen.',
  '  u ^U            Back half a screen.',
  '  g < Home        The first line.',
  '  G > End         The last line.',
  '  /text           Search forward.',
  '  ?text           Search back.',
  '  n               The next match.',
  '  N               The match the other way.',
  '  h H             This summary.',
  '',
  '  A search looks for the text as typed.',
  '  It ignores case unless the text has a',
  '  capital in it, or less ran with -i.',
  '',
  '  On a touch screen, swipe to scroll, or',
  '  use the buttons along the bottom.',
];
