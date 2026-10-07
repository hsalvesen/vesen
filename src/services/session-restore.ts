// Restoring the session snapshot (session-snapshot.ts), loaded only after Back or Forward. What
// was saved is rebuilt from scratch: only known blocks, spans with text and token colours, and
// links that pass safeHref. Nothing read back can carry an action: actions are made only by the
// out builders in this page (docs/plan/02-architecture-and-contracts.md, section 6).

import { isPalette, isRole, out, safeHref, type Block, type Colour, type Line, type Span, type SpanStyle } from '../output/model';
import type { SessionSnapshot, SnapshotEntry } from './session-snapshot';
import { STORAGE_LIMITS } from './storage-keys';

const STYLE_FLAGS = ['bold', 'dim', 'italic', 'underline', 'inverse', 'strike'] as const;

function cleanStyle(style: unknown): SpanStyle | undefined {
  if (typeof style !== 'object' || style === null) return undefined;
  const raw = style as Record<string, unknown>;
  const clean: { -readonly [K in keyof SpanStyle]: SpanStyle[K] } = {};
  const colour = (value: unknown): Colour | undefined =>
    typeof value === 'string' && (isPalette(value) || isRole(value)) ? value : undefined;
  const fg = colour(raw.fg);
  const bg = colour(raw.bg);
  if (fg !== undefined) clean.fg = fg;
  if (bg !== undefined) clean.bg = bg;
  for (const flag of STYLE_FLAGS) if (raw[flag] === true) clean[flag] = true;
  return Object.keys(clean).length === 0 ? undefined : clean;
}

/** Text and style only: no action, link, live binding or swatch. */
function cleanSpan(span: unknown): Span | null {
  if (typeof span !== 'object' || span === null) return null;
  const raw = span as { text?: unknown; style?: unknown };
  if (typeof raw.text !== 'string') return null;
  const style = cleanStyle(raw.style);
  return style === undefined ? { text: raw.text } : { text: raw.text, style };
}

function cleanLine(line: unknown): Line {
  if (!Array.isArray(line)) return [];
  return line.map(cleanSpan).filter((span): span is Span => span !== null);
}

function cleanLines(lines: unknown): Line[] {
  return Array.isArray(lines) ? lines.map(cleanLine) : [];
}

const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

/** One block as it may be saved and restored; null drops it. Never throws. */
export function cleanBlock(block: unknown): Block | null {
  if (typeof block !== 'object' || block === null) return null;
  const raw = block as Record<string, unknown>;
  try {
    switch (raw.type) {
      case 'lines':
        return out.lines(cleanLines(raw.lines), raw.stream === 'stderr' ? 'stderr' : 'stdout');
      case 'grid': {
        const items = cleanLine(raw.items);
        const minCh = typeof raw.minCh === 'number' && Number.isFinite(raw.minCh) ? raw.minCh : undefined;
        const notes = raw.notes === undefined ? undefined : cleanLines(raw.notes);
        return out.grid(items, minCh, notes, raw.order === 'columns' ? 'columns' : undefined);
      }
      case 'table': {
        const rows = Array.isArray(raw.rows) ? raw.rows.map((row: unknown) => cleanLines(row)) : [];
        const head = raw.head === undefined ? undefined : cleanLines(raw.head);
        const align = Array.isArray(raw.align) ? raw.align.map((a: unknown) => (a === 'r' ? 'r' : 'l')) : undefined;
        const stack = typeof raw.stackBelowCols === 'number' ? raw.stackBelowCols : undefined;
        return out.table(rows, {
          ...(head === undefined ? {} : { head }),
          ...(align === undefined ? {} : { align }),
          ...(stack === undefined ? {} : { stackBelowCols: stack }),
        });
      }
      case 'art': {
        const text = str(raw.text);
        if (text === undefined) return null;
        return out.art(text, str(raw.alt) ?? '', raw.fit === 'scroll' ? 'scroll' : 'scale', cleanStyle(raw.style));
      }
      case 'panel': {
        const tone = str(raw.tone);
        const title = str(raw.title);
        return out.panel(tone !== undefined && (isPalette(tone) || isRole(tone)) ? tone : 'muted', cleanLines(raw.body), title);
      }
      case 'card': {
        // A link card is still the way to the link after Back; its href is checked again.
        const title = str(raw.title);
        const href = str(raw.href);
        if (title === undefined || href === undefined || safeHref(href) === null) return null;
        const card: Parameters<typeof out.card>[0] = { title, href };
        for (const key of ['label', 'detail', 'copy', 'copyLabel', 'openLabel'] as const) {
          const value = str(raw[key]);
          if (value !== undefined) card[key] = value;
        }
        const escape = (typeof raw.escape === 'object' && raw.escape !== null ? raw.escape : {}) as Record<string, unknown>;
        const escapeUrl = str(escape.url);
        const hint = str(escape.hint);
        if (escapeUrl !== undefined && safeHref(escapeUrl) !== null) card.escape = hint === undefined ? { url: escapeUrl } : { url: escapeUrl, hint };
        return out.card(card);
      }
      case 'columns': {
        const side = (blocks: unknown): Block[] => (Array.isArray(blocks) ? blocks.map(cleanBlock).filter((b): b is Block => b !== null) : []);
        const at = typeof raw.stackBelowCols === 'number' ? raw.stackBelowCols : 60;
        // A left side of its own width (fastfetch's logo) keeps it, so the layout comes back as it was.
        const leftCh = typeof raw.leftCh === 'number' && Number.isFinite(raw.leftCh) && raw.leftCh > 0 ? raw.leftCh : undefined;
        return out.columns(side(raw.left), side(raw.right), at, leftCh);
      }
      case 'legacyHtml': {
        // Sanitised again when it is drawn (ui/legacy-html.ts), as at first.
        const html = str(raw.html);
        return html === undefined ? null : out.legacyHtml(html);
      }
      case 'component': {
        // A rich card comes back as what a pipe would have received.
        const text = str(raw.plain);
        return text === undefined ? null : out.text(text);
      }
      default:
        // Chips are tap actions only, and go.
        return null;
    }
  } catch {
    return null;
  }
}

function cleanEntry(entry: unknown): SnapshotEntry | null {
  if (typeof entry !== 'object' || entry === null) return null;
  const raw = entry as Record<string, unknown>;
  const line = str(raw.line);
  if (line === undefined) return null;
  const blocks = Array.isArray(raw.blocks) ? raw.blocks.map(cleanBlock).filter((b): b is Block => b !== null) : [];
  const status = typeof raw.status === 'number' && Number.isInteger(raw.status) ? raw.status : undefined;
  return {
    prompt: raw.prompt === null || raw.prompt === undefined ? null : cleanLine(raw.prompt),
    line,
    blocks,
    ...(status === undefined ? {} : { status }),
    state: raw.state === 'interrupted' ? 'interrupted' : 'done',
  };
}

/** A saved snapshot rebuilt and checked; null when it is unreadable or over 30 minutes old. */
export function reviveSnapshot(json: string | null, now: number): SessionSnapshot | null {
  if (json === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const raw = parsed as Record<string, unknown>;
  if (raw.v !== 1 || typeof raw.savedAt !== 'number') return null;
  const age = now - raw.savedAt;
  if (!(age >= 0 && age <= STORAGE_LIMITS.sessionMaxAgeMs)) return null;
  const scroll = (raw.scroll ?? {}) as Record<string, unknown>;
  const entries = Array.isArray(raw.entries)
    ? raw.entries.slice(-STORAGE_LIMITS.sessionEntries).map(cleanEntry).filter((entry): entry is SnapshotEntry => entry !== null)
    : [];
  const cwd = str(raw.cwd);
  const line = str(raw.line) ?? '';
  return {
    v: 1,
    savedAt: raw.savedAt,
    entries,
    // One line: whatever was saved, nothing that could run as several.
    line: /[\n\r]/.test(line) ? '' : line,
    cwd: cwd !== undefined && cwd.startsWith('/') ? cwd : '',
    scroll: { top: typeof scroll.top === 'number' && scroll.top >= 0 ? scroll.top : 0, atBottom: scroll.atBottom !== false },
  };
}

