// The output model: what commands write, what the UI renders and what a pipe receives.
// See docs/plan/02-architecture-and-contracts.md, sections 2, 6 and 10.
//
// Commands never build HTML. They build Spans and Blocks with the `out` builders below, and
// every Block has a plain-text form for pipes and files (`plain`). Tap actions (run, insert,
// open, copy, share) can be made only by these builders: an Action carries a compile-time brand
// that an object literal cannot forge, and a runtime mark that JSON, SGR, OSC 8 or HTML parsing
// cannot recreate. Text that came from cat, curl or echo therefore never plants a command a
// visitor might tap.

import { htmlToText } from './html-to-text';

// ── Colours ────────────────────────────────────────────────────────────────────────────────

/** Theme palette entries: the colour keys of a theme in themes.json, rendered as `var(--theme-*)`. */
export const PALETTE = [
  'black', 'red', 'green', 'yellow', 'blue', 'purple', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow',
  'brightBlue', 'brightPurple', 'brightCyan', 'brightWhite',
  'foreground', 'background',
] as const;
export type Palette = (typeof PALETTE)[number];

/** What text is for, rendered as `var(--role-*)`. Each theme may set these; the rest are computed. */
export const ROLES = [
  'fg', 'fg-strong', 'muted', 'accent', 'ok', 'warn', 'error', 'link',
  'chip-bg', 'chip-fg', 'ghost', 'selection', 'cursor',
  'prompt-user', 'prompt-host', 'prompt-path',
  'sun', 'rain', 'cold', 'hot', 'qr-ink', 'qr-paper',
] as const;
export type Role = (typeof ROLES)[number];

/** A colour is always a token, never a hex value, so old output re-themes without DOM patching. */
export type Colour = Palette | Role;

const PALETTE_SET: ReadonlySet<string> = new Set(PALETTE);
const ROLE_SET: ReadonlySet<string> = new Set(ROLES);

export function isPalette(name: string): name is Palette {
  return PALETTE_SET.has(name);
}

export function isRole(name: string): name is Role {
  return ROLE_SET.has(name);
}

/** The CSS custom property a colour token renders as: `brightBlack` → `var(--theme-bright-black)`. */
export function colourVar(colour: Colour): string {
  if (isRole(colour)) return `var(--role-${colour})`;
  return `var(--theme-${colour.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)})`;
}

// ── Spans and lines ────────────────────────────────────────────────────────────────────────

export interface SpanStyle {
  readonly fg?: Colour;
  readonly bg?: Colour;
  readonly bold?: boolean;
  readonly dim?: boolean;
  readonly italic?: boolean;
  readonly underline?: boolean;
  readonly inverse?: boolean;
  readonly strike?: boolean;
}

declare const checkedHref: unique symbol;
declare const trustedAction: unique symbol;

/** An absolute http, https or mailto URL. Made only by `safeHref`, which checks the scheme. */
export type SafeHref = string & { readonly [checkedHref]: true };

type ActionData =
  | { readonly kind: 'run'; readonly line: string }
  | { readonly kind: 'insert'; readonly text: string }
  | { readonly kind: 'open'; readonly href: SafeHref }
  | { readonly kind: 'copy'; readonly text: string; readonly label?: string }
  | { readonly kind: 'share'; readonly url: SafeHref; readonly title?: string };

/** What a tap does. Made only by the `out` builders; see the note at the top of this file. */
export type Action = ActionData & { readonly [trustedAction]: true };
export type ActionKind = Action['kind'];

/**
 * A value the renderer reads from the stores when it draws the span, so old output stays true
 * after the theme or CRT mode changes. `plain()` uses the span's own text.
 */
export type LiveBinding =
  | { readonly kind: 'isCurrentTheme'; readonly theme: string }
  | { readonly kind: 'isCurrentCathode'; readonly mode: string }
  | { readonly kind: 'currentThemeName' };

export interface Span {
  readonly text: string;
  readonly style?: SpanStyle;
  /** An ordinary link. */
  readonly href?: SafeHref;
  readonly action?: Action;
  readonly live?: LiveBinding;
}

export type Line = readonly Span[];

// ── Blocks ─────────────────────────────────────────────────────────────────────────────────

export type Stream = 'stdout' | 'stderr';
export type Align = 'l' | 'r';
export type ArtFit = 'scale' | 'scroll';

export interface ChipItem {
  readonly label: string;
  readonly action: Action;
}

/** The trusted Svelte components a `component` block may name, registered by the UI. */
export const COMPONENT_NAMES = ['weather-card', 'quote-card', 'quote-table', 'qr-card', 'link-card'] as const;
export type ComponentName = (typeof COMPONENT_NAMES)[number];

export interface LinesBlock {
  readonly type: 'lines';
  readonly lines: readonly Line[];
  readonly stream: Stream;
}

/** Items laid out in as many columns as fit: ls, help, theme ls. */
export interface GridBlock {
  readonly type: 'grid';
  readonly items: readonly Span[];
  /** The narrowest a column may be, in characters. */
  readonly minCh?: number;
}

/** Rows of cells; each cell is a Line. */
export interface TableBlock {
  readonly type: 'table';
  readonly head?: readonly Line[];
  readonly rows: readonly (readonly Line[])[];
  /** Per column; columns without an entry align left. */
  readonly align?: readonly Align[];
  /** Below this many terminal columns, each row is shown as a stack of cells. */
  readonly stackBelowCols?: number;
}

/** Preformatted text that must keep its shape: the banner, logos, text-mode QR codes. */
export interface ArtBlock {
  readonly type: 'art';
  readonly text: string;
  /** What a screen reader announces instead of the characters. */
  readonly alt: string;
  readonly style?: SpanStyle;
  readonly fit: ArtFit;
}

/** A titled, toned box: --help output and notices. */
export interface PanelBlock {
  readonly type: 'panel';
  readonly tone: Colour;
  readonly title?: string;
  readonly body: readonly Line[];
}

/** Tappable follow-ups. Interactive only, so a pipe receives nothing. */
export interface ChipsBlock {
  readonly type: 'chips';
  readonly label?: string;
  readonly items: readonly ChipItem[];
}

/** A link card with Copy, printed by every opener. */
export interface CardBlock {
  readonly type: 'card';
  readonly title: string;
  readonly href: SafeHref;
  readonly detail?: string;
  /** What Copy puts on the clipboard; defaults to the href. */
  readonly copy?: string;
}

/** Two stacks side by side, stacked vertically on narrow terminals: fastfetch, stock. */
export interface ColumnsBlock {
  readonly type: 'columns';
  readonly left: readonly Block[];
  readonly right: readonly Block[];
  readonly stackBelowCols: number;
}

/** A rich card drawn by a registered Svelte component from a typed view model. */
export interface ComponentBlock {
  readonly type: 'component';
  readonly name: ComponentName;
  /** The component's view model: WeatherView, QuoteEnvelope, QrView or LinkView. */
  readonly props: unknown;
  /** What a pipe or a file receives. */
  readonly plain: string;
  /** A screen-reader summary. */
  readonly alt: string;
}

/** Migration only: a legacy command's HTML, sanitised when rendered. Removed with DOMPurify. */
export interface LegacyHtmlBlock {
  readonly type: 'legacyHtml';
  readonly html: string;
}

export type Block =
  | LinesBlock
  | GridBlock
  | TableBlock
  | ArtBlock
  | PanelBlock
  | ChipsBlock
  | CardBlock
  | ColumnsBlock
  | ComponentBlock
  | LegacyHtmlBlock;
export type BlockType = Block['type'];

// ── Trust ──────────────────────────────────────────────────────────────────────────────────

const HREF_SCHEMES: ReadonlySet<string> = new Set(['http:', 'https:', 'mailto:']);

/** Returns the normalised URL when it is absolute and http, https or mailto; otherwise null. */
export function safeHref(url: string): SafeHref | null {
  if (url === '' || /[\s\u0000-\u001f\u007f-\u009f]/.test(url)) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  return HREF_SCHEMES.has(parsed.protocol) ? (parsed.href as SafeHref) : null;
}

// Controls, line breaks and bidirectional overrides: a line to run or insert must read exactly
// as it will execute. Tab is allowed; it is whitespace to the shell.
const UNSAFE_IN_LINE = /[\u0000-\u0008\u000a-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/;

const trusted = new WeakSet<object>();

/** True only for an Action made by the `out` builders in this page. */
export function isTrustedAction(value: unknown): value is Action {
  return typeof value === 'object' && value !== null && trusted.has(value);
}

function seal(data: ActionData): Action {
  const action = Object.freeze({ ...data }) as Action;
  trusted.add(action);
  return action;
}

function singleLine(builder: string, field: string, value: string): string {
  if (UNSAFE_IN_LINE.test(value)) {
    throw new TypeError(`out.${builder}: ${field} must be one line without control characters`);
  }
  return value;
}

function requireHref(builder: string, url: string): SafeHref {
  const href = safeHref(url);
  if (href === null) throw new TypeError(`out.${builder}: not an http, https or mailto URL: ${url}`);
  return href;
}

// ── Builders ───────────────────────────────────────────────────────────────────────────────

function span(text: string, style?: SpanStyle): Span {
  return style === undefined ? { text } : { text, style };
}

function withAction(label: string, action: Action, style: SpanStyle | undefined): Span {
  return { ...span(label, style), action };
}

const action = {
  run: (line: string): Action => seal({ kind: 'run', line: singleLine('action.run', 'line', line) }),
  insert: (text: string): Action => seal({ kind: 'insert', text: singleLine('action.insert', 'text', text) }),
  open: (href: string): Action => seal({ kind: 'open', href: requireHref('action.open', href) }),
  copy: (text: string, label?: string): Action =>
    seal(label === undefined ? { kind: 'copy', text } : { kind: 'copy', text, label }),
  share: (url: string, title?: string): Action => {
    const href = requireHref('action.share', url);
    return seal(title === undefined ? { kind: 'share', url: href } : { kind: 'share', url: href, title });
  },
} as const;

/** Splits text into lines the way a terminal prints it: a final newline ends the last line. */
function textLines(text: string, style?: SpanStyle): Line[] {
  if (text === '') return [];
  const pieces = text.split('\n');
  if (pieces[pieces.length - 1] === '') pieces.pop();
  return pieces.map((piece) => (piece === '' ? [] : [span(piece, style)]));
}

export const out = {
  /** Plain or styled text. */
  span,

  /** A tappable span that runs `line`. */
  run: (label: string, line: string, style?: SpanStyle): Span => withAction(label, action.run(line), style),

  /** A tappable span that inserts `text` at the prompt without running it. */
  insert: (label: string, text: string, style?: SpanStyle): Span => withAction(label, action.insert(text), style),

  /** A link, drawn in the link role; a URL that is not http, https or mailto leaves plain text. */
  link: (label: string, href: string, style?: SpanStyle): Span => {
    const checked = safeHref(href);
    const base = span(label, style);
    return checked === null ? base : { ...base, href: checked };
  },

  /** A tappable span that copies `text` to the clipboard. */
  copy: (label: string, text: string, style?: SpanStyle): Span => withAction(label, action.copy(text), style),

  /** A tappable span that opens `href` through the opener service and its in-app policy. */
  open: (label: string, href: string, style?: SpanStyle): Span => withAction(label, action.open(href), style),

  /** A tappable span that offers the system share sheet for `url`. */
  share: (label: string, url: string, title?: string, style?: SpanStyle): Span =>
    withAction(label, action.share(url, title), style),

  /** Bare actions, for chips and component view models. */
  action,

  /** Text as a lines block, split on newlines; every line gets `style`. */
  text: (text: string, style?: SpanStyle, stream: Stream = 'stdout'): LinesBlock => ({
    type: 'lines',
    lines: textLines(text, style),
    stream,
  }),

  lines: (lines: readonly Line[], stream: Stream = 'stdout'): LinesBlock => ({ type: 'lines', lines, stream }),

  grid: (items: readonly Span[], minCh?: number): GridBlock =>
    minCh === undefined ? { type: 'grid', items } : { type: 'grid', items, minCh },

  table: (
    rows: readonly (readonly Line[])[],
    options: { head?: readonly Line[]; align?: readonly Align[]; stackBelowCols?: number } = {},
  ): TableBlock => ({ type: 'table', rows, ...options }),

  art: (text: string, alt: string, fit: ArtFit = 'scale', style?: SpanStyle): ArtBlock =>
    style === undefined ? { type: 'art', text, alt, fit } : { type: 'art', text, alt, fit, style },

  panel: (tone: Colour, body: readonly Line[], title?: string): PanelBlock =>
    title === undefined ? { type: 'panel', tone, body } : { type: 'panel', tone, title, body },

  /** Chips; every action must come from `out.action` (or a builder's span). */
  chips: (items: readonly ChipItem[], label?: string): ChipsBlock => {
    for (const item of items) {
      if (!isTrustedAction(item.action)) throw new TypeError(`out.chips: untrusted action on chip "${item.label}"`);
    }
    return label === undefined ? { type: 'chips', items } : { type: 'chips', label, items };
  },

  card: (card: { title: string; href: string; detail?: string; copy?: string }): CardBlock => ({
    type: 'card',
    ...card,
    href: requireHref('card', card.href),
  }),

  columns: (left: readonly Block[], right: readonly Block[], stackBelowCols: number): ColumnsBlock => ({
    type: 'columns',
    left,
    right,
    stackBelowCols,
  }),

  component: (name: ComponentName, props: unknown, plain: string, alt: string): ComponentBlock => ({
    type: 'component',
    name,
    props,
    plain,
    alt,
  }),

  /** Migration only. */
  legacyHtml: (html: string): LegacyHtmlBlock => ({ type: 'legacyHtml', html }),
} as const;

// ── Plain text ─────────────────────────────────────────────────────────────────────────────

export function lineText(line: Line): string {
  return line.map((s) => s.text).join('');
}

/** East Asian wide characters and emoji, which a terminal draws two cells wide. */
function isWide(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0x303e) ||
    (cp >= 0x3041 && cp <= 0x33ff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xa000 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1f64f) ||
    (cp >= 0x1f900 && cp <= 0x1f9ff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  );
}

const ZERO_WIDTH = /^[\p{M}\u200b-\u200f\u2060\ufeff]$/u;

/** Terminal cells one code point occupies: 0 for a combining mark, 2 for a wide character. */
export function charWidth(ch: string): number {
  if (ZERO_WIDTH.test(ch)) return 0;
  return isWide(ch.codePointAt(0) ?? 0) ? 2 : 1;
}

/**
 * Display width in terminal cells: combining marks and zero-width characters take none, East
 * Asian wide characters and emoji two, everything else one.
 */
export function textWidth(text: string): number {
  let width = 0;
  for (const ch of text) width += charWidth(ch);
  return width;
}

function terminated(text: string): string {
  return text === '' || text.endsWith('\n') ? text : `${text}\n`;
}

function asLines(rows: readonly string[]): string {
  return rows.map((row) => `${row}\n`).join('');
}

function tableRows(table: TableBlock): string[] {
  const rows = (table.head ? [table.head, ...table.rows] : table.rows).map((row) => row.map(lineText));
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, i) => {
      widths[i] = Math.max(widths[i] ?? 0, textWidth(cell));
    });
  }
  return rows.map((row) =>
    row
      .map((cell, i) => {
        const pad = ' '.repeat((widths[i] ?? 0) - textWidth(cell));
        return table.align?.[i] === 'r' ? pad + cell : cell + pad;
      })
      .join('  ')
      .trimEnd(),
  );
}

/**
 * What a pipe or a file receives for a block: '' or text ending in a newline, so blocks
 * concatenate the way a program's output does. Styles, links and actions are dropped.
 */
export function plain(block: Block): string {
  switch (block.type) {
    case 'lines':
      return asLines(block.lines.map(lineText));
    case 'grid':
      // Like `ls | cat`: one item per line.
      return asLines(block.items.map((item) => item.text));
    case 'table':
      return asLines(tableRows(block));
    case 'art':
      return terminated(block.text);
    case 'panel':
      return asLines([...(block.title === undefined ? [] : [block.title]), ...block.body.map(lineText)]);
    case 'chips':
      return '';
    case 'card':
      return asLines([block.title, block.href, ...(block.detail === undefined ? [] : [block.detail])]);
    case 'columns':
      return [...block.left, ...block.right].map(plain).join('');
    case 'component':
      return terminated(block.plain);
    case 'legacyHtml':
      return terminated(htmlToText(block.html));
  }
}
