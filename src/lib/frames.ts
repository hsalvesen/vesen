// A frames file: text animation frames the owner supplies for sudo's show, read defensively.
// DOM-free; services/frames.ts fetches the file and the Rick app (ui/apps/Rick.svelte) plays what
// parses. scripts/ascii-frames.mjs writes one from a folder of PNG frames.
//
// The format, line by line:
//
//   vesen-frames fps=12 cols=60 rows=17     the header: frames a second, and every frame's size
//   <row 1 of the first frame>              rows lines of cols characters each
//   ...
//   <row 17 of the first frame>
//   ===                                     a line of three equals signs between frames
//   <row 1 of the second frame>
//   ...
//
// Any character may appear in a row (it is the owner's file); a row shorter than cols is padded
// with spaces and a longer one is cut, so an editor trimming trailing spaces does no harm. A
// frame with the wrong number of rows, a header that does not parse, or a file over FRAMES_MAX_CHARS
// is malformed: parseFramesFile returns null and the drawn dancer plays. Only the first
// FRAMES_MAX_FRAMES frames are kept.

/** The most characters a frames file may hold: about 4 MB of ASCII. */
export const FRAMES_MAX_CHARS = 4 * 1024 * 1024;
/** The most frames read from a file. */
export const FRAMES_MAX_FRAMES = 10_000;
/** The bounds of a frame's size and pace. */
export const FRAMES_MAX_COLS = 400;
export const FRAMES_MAX_ROWS = 200;
export const FRAMES_MAX_FPS = 120;

/** The header's first word. */
export const FRAMES_MAGIC = 'vesen-frames';
/** The line between frames. */
export const FRAMES_SEPARATOR = '===';

/** One frame: its text, and each row as one span in the foreground colour, as the Rick app draws rows. */
export interface AsciiFrame {
  readonly text: string;
  readonly rows: readonly (readonly { readonly text: string; readonly role: 'fg' }[])[];
}

export interface FramesFile {
  readonly fps: number;
  readonly cols: number;
  readonly rows: number;
  readonly frames: readonly AsciiFrame[];
}

/** The header's numbers, or null when it is not a header of this format. */
export function parseFramesHeader(line: string): { fps: number; cols: number; rows: number } | null {
  const words = line.trim().split(/\s+/);
  if (words[0] !== FRAMES_MAGIC) return null;
  const values = new Map<string, string>();
  for (const word of words.slice(1)) {
    const eq = word.indexOf('=');
    if (eq <= 0) return null;
    values.set(word.slice(0, eq).toLowerCase(), word.slice(eq + 1));
  }
  const number = (key: string, max: number, integer: boolean): number | null => {
    const raw = values.get(key);
    if (raw === undefined || !/^\d+(?:\.\d+)?$/.test(raw)) return null;
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0 || value > max) return null;
    if (integer && !Number.isInteger(value)) return null;
    return value;
  };
  const fps = number('fps', FRAMES_MAX_FPS, false);
  const cols = number('cols', FRAMES_MAX_COLS, true);
  const rows = number('rows', FRAMES_MAX_ROWS, true);
  if (fps === null || cols === null || rows === null) return null;
  return { fps, cols, rows };
}

/** A row of exactly `cols` characters (code points): padded with spaces, or cut. */
function fitRow(line: string, cols: number): string {
  const chars = Array.from(line);
  if (chars.length === cols) return line;
  if (chars.length > cols) return chars.slice(0, cols).join('');
  return line + ' '.repeat(cols - chars.length);
}

function frameOf(lines: readonly string[]): AsciiFrame {
  return { text: lines.join('\n'), rows: lines.map((text) => [{ text, role: 'fg' as const }]) };
}

/**
 * Reads a frames file. Null when it is malformed, over the size cap, or has no frames; otherwise
 * the header's numbers and up to FRAMES_MAX_FRAMES frames of rows × cols characters.
 */
export function parseFramesFile(text: string): FramesFile | null {
  if (typeof text !== 'string' || text.length > FRAMES_MAX_CHARS) return null;
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  // A final newline leaves an empty last element, which is no row.
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  const header = parseFramesHeader(lines[0] ?? '');
  if (header === null) return null;
  const { cols, rows } = header;
  const frames: AsciiFrame[] = [];
  let current: string[] = [];
  const finish = (last: boolean): boolean => {
    // Empty lines after the last frame are no frame (a blank frame is rows of spaces).
    if (last) {
      while (current.length > rows && current[current.length - 1] === '') current.pop();
      if (current.every((line) => line === '')) return true;
    }
    if (current.length !== rows) return false;
    frames.push(frameOf(current.map((line) => fitRow(line, cols))));
    return true;
  };
  for (let i = 1; i < lines.length && frames.length < FRAMES_MAX_FRAMES; i += 1) {
    const line = lines[i] ?? '';
    if (line.trimEnd() === FRAMES_SEPARATOR) {
      if (!finish(false)) return null;
      current = [];
      continue;
    }
    current.push(line);
  }
  if (frames.length < FRAMES_MAX_FRAMES && !finish(true)) return null;
  if (frames.length === 0) return null;
  return { ...header, frames };
}
