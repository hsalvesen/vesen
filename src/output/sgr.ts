// A streaming reader for the SGR subset vesen draws (docs/plan/designs/shell-architecture.md,
// section 3). Text written to the screen may carry:
//
//   ESC[0m and ESC[m       reset
//   1 2 3 4 7 9            bold, dim, italic, underline, inverse, strike (21 is underline too)
//   22 23 24 27 29         turn them off (22 ends bold and dim)
//   30-37 90-97 39         foreground: the 16 palette colours, or the default
//   40-47 100-107 49       background: the same
//   ESC[2J ESC[3J ESC c    clear the screen
//   OSC 8 ; ; URI ST       a link, for http, https and mailto URIs only
//
// Everything else (256-colour and true-colour SGR, cursor movement, other OSC and string
// sequences, C0 and C1 controls other than tab and newline) is dropped, so the theme stays
// coherent. Escapes may be split across chunks: the unfinished part waits for the next one.
//
// The parser never makes an Action. A span from here has text, a style and at most a checked
// href, so text from cat, curl or echo can never plant something a visitor might tap.

import { PALETTE, safeHref, type Line, type Palette, type SafeHref, type Span, type SpanStyle } from './model';

export type SgrEvent = { readonly kind: 'line'; readonly line: Line } | { readonly kind: 'clear' };

/** The longest escape sequence kept while waiting for its end; longer ones are dropped. */
export const MAX_SEQUENCE = 4096;

/** The 16 terminal colours in SGR order: 30-37 are the first eight, 90-97 the bright ones. */
const SGR_COLOURS: readonly Palette[] = PALETTE.slice(0, 16);

const ESC = '\u001b';
const BEL = '\u0007';

type MutableStyle = { -readonly [K in keyof SpanStyle]: SpanStyle[K] };

function cleanStyle(style: MutableStyle): SpanStyle | undefined {
  const kept: MutableStyle = {};
  let any = false;
  for (const key of Object.keys(style) as (keyof SpanStyle)[]) {
    const value = style[key];
    if (value === undefined || value === false) continue;
    (kept as Record<string, unknown>)[key] = value;
    any = true;
  }
  return any ? kept : undefined;
}

/** What one sequence read from the input amounts to. */
type Sequence =
  | { readonly t: 'sgr'; readonly params: string }
  | { readonly t: 'clear' }
  | { readonly t: 'link'; readonly uri: string }
  | { readonly t: 'drop' };

/** Reads one escape sequence at `i` (s[i] is ESC). Returns null when the input ends inside it. */
function readEscape(s: string, i: number): { seq: Sequence; next: number } | null {
  if (i + 1 >= s.length) return null;
  const kind = s.charAt(i + 1);

  if (kind === '[') {
    // CSI: parameter bytes, intermediate bytes, then one final byte.
    let j = i + 2;
    while (j < s.length) {
      const c = s.charCodeAt(j);
      if (c >= 0x40 && c <= 0x7e) {
        const params = s.slice(i + 2, j);
        const final = s.charAt(j);
        if (final === 'm' && /^[0-9;:]*$/.test(params)) return { seq: { t: 'sgr', params }, next: j + 1 };
        if (final === 'J' && (params === '2' || params === '3')) return { seq: { t: 'clear' }, next: j + 1 };
        return { seq: { t: 'drop' }, next: j + 1 };
      }
      if (c < 0x20 || c > 0x3f) {
        // Not a CSI byte: the sequence is malformed. Drop what was read and go on from here.
        return { seq: { t: 'drop' }, next: j };
      }
      j += 1;
    }
    return null;
  }

  if (kind === ']' || kind === 'P' || kind === '_' || kind === '^' || kind === 'X') {
    // OSC ends with BEL or ST (ESC \); DCS, APC, PM and SOS with ST.
    let j = i + 2;
    while (j < s.length) {
      const c = s.charAt(j);
      if (c === BEL && kind === ']') return { seq: osc(s.slice(i + 2, j)), next: j + 1 };
      if (c === ESC) {
        if (j + 1 >= s.length) return null;
        if (s.charAt(j + 1) === '\\') return { seq: kind === ']' ? osc(s.slice(i + 2, j)) : { t: 'drop' }, next: j + 2 };
        // Another escape starts: this one was never finished.
        return { seq: { t: 'drop' }, next: j };
      }
      if (c === '\n') return { seq: { t: 'drop' }, next: j };
      j += 1;
    }
    return null;
  }

  if (kind === 'c') return { seq: { t: 'clear' }, next: i + 2 };

  // ESC with intermediate bytes, then a final byte: charset designations and the like.
  let j = i + 1;
  while (j < s.length && s.charCodeAt(j) >= 0x20 && s.charCodeAt(j) <= 0x2f) j += 1;
  if (j >= s.length) return null;
  return { seq: { t: 'drop' }, next: j + 1 };
}

function osc(body: string): Sequence {
  // OSC 8 ; params ; URI
  if (!body.startsWith('8;')) return { t: 'drop' };
  const rest = body.slice(2);
  const split = rest.indexOf(';');
  if (split === -1) return { t: 'drop' };
  return { t: 'link', uri: rest.slice(split + 1) };
}

/** Text characters: everything but C0 controls (tab and newline aside), DEL and C1 controls. */
function isText(c: number): boolean {
  if (c === 0x09) return true;
  if (c < 0x20 || c === 0x7f) return false;
  return c < 0x80 || c > 0x9f;
}

/**
 * Reads text with escapes into lines of spans. Feed it chunks as they arrive; each call returns
 * the lines completed by a newline and any screen clears, in order. `end()` returns the last,
 * unterminated line.
 */
export class SgrParser {
  private style: MutableStyle = {};
  private href: SafeHref | undefined;
  private pending = '';
  private spans: Span[] = [];
  private run = '';

  feed(chunk: string): SgrEvent[] {
    const events: SgrEvent[] = [];
    const s = this.pending + chunk;
    this.pending = '';
    let i = 0;
    while (i < s.length) {
      const ch = s.charAt(i);
      if (ch === ESC) {
        const read = readEscape(s, i);
        if (read === null) {
          const rest = s.slice(i);
          if (rest.length <= MAX_SEQUENCE) {
            this.pending = rest;
            break;
          }
          // Too long to be a sequence vesen draws: drop the escape and read on as text.
          i += 2;
          continue;
        }
        this.apply(read.seq, events);
        i = read.next;
        continue;
      }
      if (ch === '\n') {
        events.push({ kind: 'line', line: this.takeLine() });
        i += 1;
        continue;
      }
      // Collect a run of plain text in one step.
      let j = i;
      while (j < s.length) {
        const c = s.charCodeAt(j);
        if (c === 0x1b || c === 0x0a || !isText(c)) break;
        j += 1;
      }
      if (j > i) {
        this.run += s.slice(i, j);
        i = j;
      } else {
        // A control character: dropped.
        i += 1;
      }
    }
    return events;
  }

  /** Adds plain text to the unfinished line, outside any style or link: the terminal's echo of ^C. */
  echo(text: string): void {
    this.flushRun();
    this.spans.push({ text });
  }

  /** The unfinished line so far, without taking it. */
  partial(): Line {
    return this.run === '' ? [...this.spans] : [...this.spans, this.span(this.run)];
  }

  /** Ends the input: the unterminated last line, if it has any text. An unfinished escape is dropped. */
  end(): SgrEvent[] {
    this.pending = '';
    const line = this.takeLine();
    return line.length > 0 ? [{ kind: 'line', line }] : [];
  }

  private span(text: string): Span {
    const style = cleanStyle(this.style);
    const base: Span = style === undefined ? { text } : { text, style };
    return this.href === undefined ? base : { ...base, href: this.href };
  }

  private flushRun(): void {
    if (this.run === '') return;
    this.spans.push(this.span(this.run));
    this.run = '';
  }

  private takeLine(): Line {
    this.flushRun();
    const line = this.spans;
    this.spans = [];
    return line;
  }

  private apply(seq: Sequence, events: SgrEvent[]): void {
    switch (seq.t) {
      case 'drop':
        return;
      case 'clear':
        // Everything before the clear is gone, the unfinished line included.
        this.spans = [];
        this.run = '';
        events.push({ kind: 'clear' });
        return;
      case 'link': {
        this.flushRun();
        this.href = seq.uri === '' ? undefined : (safeHref(seq.uri) ?? undefined);
        return;
      }
      case 'sgr':
        this.flushRun();
        this.sgr(seq.params);
        return;
    }
  }

  private sgr(params: string): void {
    const list = params === '' ? ['0'] : params.split(';');
    for (let k = 0; k < list.length; k += 1) {
      const param = list[k] ?? '';
      // Colon sub-parameters (38:5:1, 4:3) belong to one parameter.
      const [head = '', ...sub] = param.split(':');
      const n = head === '' ? 0 : Number(head);
      if (!Number.isInteger(n)) continue;
      const style = this.style;
      if (n === 0) this.style = {};
      else if (n === 1) style.bold = true;
      else if (n === 2) style.dim = true;
      else if (n === 3) style.italic = true;
      else if (n === 4) style.underline = sub.length === 0 || sub[0] !== '0';
      else if (n === 7) style.inverse = true;
      else if (n === 9) style.strike = true;
      else if (n === 21) style.underline = true;
      else if (n === 22) {
        style.bold = false;
        style.dim = false;
      } else if (n === 23) style.italic = false;
      else if (n === 24) style.underline = false;
      else if (n === 27) style.inverse = false;
      else if (n === 29) style.strike = false;
      else if (n >= 30 && n <= 37) style.fg = SGR_COLOURS[n - 30];
      else if (n >= 90 && n <= 97) style.fg = SGR_COLOURS[n - 90 + 8];
      else if (n === 39) style.fg = undefined;
      else if (n >= 40 && n <= 47) style.bg = SGR_COLOURS[n - 40];
      else if (n >= 100 && n <= 107) style.bg = SGR_COLOURS[n - 100 + 8];
      else if (n === 49) style.bg = undefined;
      else if ((n === 38 || n === 48 || n === 58) && sub.length === 0) {
        // 256-colour and true colour are dropped; skip their arguments.
        const mode = list[k + 1];
        if (mode === '5') k += 2;
        else if (mode === '2') k += 4;
        else k += 1;
      }
    }
  }
}

/** Reads a whole text at once: its lines (the last one even without a newline) and whether it cleared the screen. */
export function parseSgr(text: string): { lines: Line[]; cleared: boolean } {
  const parser = new SgrParser();
  let lines: Line[] = [];
  let cleared = false;
  for (const event of [...parser.feed(text), ...parser.end()]) {
    if (event.kind === 'clear') {
      lines = [];
      cleared = true;
    } else {
      lines.push(event.line);
    }
  }
  return { lines, cleared };
}

const ESCAPES =
  // CSI, OSC (BEL or ST), string sequences ended by ST, then any other two-or-more-byte escape.
  /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?|\u001b[P^_X][^\u001b]*(?:\u001b\\)?|\u001b[ -/]*[0-~]?/g;

/** The text without escape sequences or control characters other than tab and newline. */
export function stripSgr(text: string): string {
  return text.replace(ESCAPES, '').replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '');
}
