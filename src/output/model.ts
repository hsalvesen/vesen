// The output model: what commands write, what the UI renders and what a pipe receives.
// See docs/plan/02-architecture-and-contracts.md, sections 2, 6 and 10.
//
// Commands never build HTML. They build Spans and Blocks with the `out` builders below, and
// every Block has a plain-text form for pipes and files (`plain`, in ./plain.ts, which only the
// kernel loads). Tap actions (run, insert, open, copy, share) can be made only by these builders:
// an Action carries a compile-time brand that an object literal cannot forge, and a runtime mark
// that JSON, SGR, OSC 8 or HTML parsing cannot recreate. Text that came from cat, curl or echo
// therefore never plants a command a visitor might tap.

import { safeInLine } from '../lib/unsafe-text';

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
declare const checkedHex: unique symbol;

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
 *
 * The two `isCurrent` bindings draw their span in the accent while it names the current theme or
 * CRT mode. With a `marker`, the span is a marker instead: it reads `marker` while its theme or
 * mode is current, and as many spaces otherwise, so the mark moves in every earlier listing.
 */
export type LiveBinding =
  | { readonly kind: 'isCurrentTheme'; readonly theme: string; readonly marker?: string }
  | { readonly kind: 'isCurrentCathode'; readonly mode: string; readonly marker?: string }
  | { readonly kind: 'currentThemeName' };

/** A `#rrggbb` colour. Made only by `hexColour`, which checks it. */
export type HexColour = string & { readonly [checkedHex]: true };

/**
 * A strip of swatches in fixed colours: a theme's own palette on its own background, in
 * `theme ls`. It is the one place output carries hex rather than tokens, because it previews a
 * theme other than the one showing; it is drawn for the eye only (hidden from screen readers),
 * and a pipe receives the span's text.
 */
export interface Swatches {
  readonly background: HexColour;
  readonly colours: readonly HexColour[];
}

export interface Span {
  readonly text: string;
  readonly style?: SpanStyle;
  /** An ordinary link. */
  readonly href?: SafeHref;
  readonly action?: Action;
  readonly live?: LiveBinding;
  /** Made only by `out.swatches`. */
  readonly swatches?: Swatches;
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

/**
 * The trusted Svelte components a `component` block may name, registered by the UI. A link card
 * is the `card` block, not a component (docs/adr/0001-architecture.md, amendments).
 */
export const COMPONENT_NAMES = ['weather-card', 'quote-card', 'quote-table', 'qr-card'] as const;
export type ComponentName = (typeof COMPONENT_NAMES)[number];

export interface LinesBlock {
  readonly type: 'lines';
  readonly lines: readonly Line[];
  readonly stream: Stream;
}

/** Items laid out in as many columns as fit: ls, help. */
export interface GridBlock {
  readonly type: 'grid';
  readonly items: readonly Span[];
  /** The narrowest a column may be, in characters. */
  readonly minCh?: number;
  /**
   * Text after each item in its cell, by index, such as help's summaries. The items line up in
   * a column of their own, and a note wraps beside its item.
   */
  readonly notes?: readonly Line[];
  /**
   * 'columns' fills each column top to bottom before the next, as `ls -C` orders names, so a
   * column reads in order; 'rows', the default, fills each row left to right. Either way the
   * number of columns follows the width.
   */
  readonly order?: 'rows' | 'columns';
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

/**
 * A link card, printed by every opener (02, section 7): the title, the link as a real anchor, and
 * Copy. In an in-app browser the anchor opens in the same view, so Back returns to the terminal.
 */
export interface CardBlock {
  readonly type: 'card';
  readonly title: string;
  readonly href: SafeHref;
  /** The link's text: the URL as people read it (`linkedin.com/in/…`) unless given. */
  readonly label?: string;
  readonly detail?: string;
  /** What Copy puts on the clipboard; defaults to the href. */
  readonly copy?: string;
  /** Copy's label: 'Copy' unless given, such as 'Copy address'. */
  readonly copyLabel?: string;
  /**
   * The link as a button-like anchor with this label, such as '✉ Open mail app', and the label
   * shown as text beside it; without it the label itself is the anchor.
   */
  readonly openLabel?: string;
  /**
   * Inside an in-app browser: a dim `hint`, then the manual '••• → Open in browser' and a tap
   * that opens `url` in the real browser where the device has a way to. Ignored elsewhere.
   */
  readonly escape?: { readonly url: SafeHref; readonly hint?: string };
}

/** Two stacks side by side, stacked vertically on narrow terminals: fastfetch, stock. */
export interface ColumnsBlock {
  readonly type: 'columns';
  readonly left: readonly Block[];
  readonly right: readonly Block[];
  readonly stackBelowCols: number;
  /**
   * Side by side, the left stack's width in cells, such as fastfetch's logo, and the right one
   * takes the rest; without it the two share the width.
   */
  readonly leftCh?: number;
}

/** A rich card drawn by a registered Svelte component from a typed view model. */
export interface ComponentBlock {
  readonly type: 'component';
  readonly name: ComponentName;
  /** The component's view model: WeatherView, QuoteEnvelope or QrView. */
  readonly props: unknown;
  /** What a pipe or a file receives. */
  readonly plain: string;
  /** A screen-reader summary. */
  readonly alt: string;
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
  | ComponentBlock;
export type BlockType = Block['type'];

// ── Trust ──────────────────────────────────────────────────────────────────────────────────

const HREF_SCHEMES: ReadonlySet<string> = new Set(['http:', 'https:', 'mailto:']);

const HEX = /^#[0-9a-f]{6}$/i;

/** The colour in lower case when it is `#rrggbb`; otherwise null. */
export function hexColour(value: string): HexColour | null {
  return HEX.test(value) ? (value.toLowerCase() as HexColour) : null;
}

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

/** A URL as people read it: `linkedin.com/in/harrysalvesen`, `has@salvesen.app`. */
export function readableUrl(url: string): string {
  if (/^mailto:/i.test(url)) {
    const address = url.slice('mailto:'.length).split('?', 1)[0] ?? url;
    try {
      return decodeURIComponent(address);
    } catch {
      return address;
    }
  }
  return url.replace(/^https?:\/\/(?:www\.)?/i, '').replace(/\/$/, '');
}

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
  // Controls, line breaks and bidirectional overrides: a line to run or insert must read exactly
  // as it will execute (lib/unsafe-text.ts).
  if (!safeInLine(value)) {
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

  /** A grid; `notes`, by index, put text after each item in its cell; `order` as GridBlock says. */
  grid: (items: readonly Span[], minCh?: number, notes?: readonly Line[], order?: GridBlock['order']): GridBlock => ({
    type: 'grid',
    items,
    ...(minCh === undefined ? {} : { minCh }),
    ...(notes === undefined ? {} : { notes }),
    ...(order === undefined ? {} : { order }),
  }),

  /** A span whose text or colour the renderer reads from the stores; see LiveBinding. */
  live: (text: string, live: LiveBinding, style?: SpanStyle): Span => ({ ...span(text, style), live }),

  /**
   * A strip of colour swatches, two cells each, in `colours` on `background` (each `#rrggbb`),
   * with a space either side; see Swatches.
   */
  swatches: (background: string, colours: readonly string[]): Span => {
    const fixed = (value: string): HexColour => {
      const hex = hexColour(value);
      if (hex === null) throw new TypeError(`out.swatches: not a #rrggbb colour: ${value}`);
      return hex;
    };
    return {
      text: ` ${'██'.repeat(colours.length)} `,
      swatches: { background: fixed(background), colours: colours.map(fixed) },
    };
  },

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

  card: (card: {
    title: string;
    href: string;
    label?: string;
    detail?: string;
    copy?: string;
    copyLabel?: string;
    openLabel?: string;
    escape?: { url: string; hint?: string };
  }): CardBlock => {
    const { escape, ...rest } = card;
    const block: CardBlock = { type: 'card', ...rest, href: requireHref('card', card.href) };
    if (escape === undefined) return block;
    const url = requireHref('card', escape.url);
    return { ...block, escape: escape.hint === undefined ? { url } : { url, hint: escape.hint } };
  },

  columns: (left: readonly Block[], right: readonly Block[], stackBelowCols: number, leftCh?: number): ColumnsBlock => ({
    type: 'columns',
    left,
    right,
    stackBelowCols,
    ...(leftCh === undefined ? {} : { leftCh }),
  }),

  component: (name: ComponentName, props: unknown, plain: string, alt: string): ComponentBlock => ({
    type: 'component',
    name,
    props,
    plain,
    alt,
  }),
} as const;

// ── Text width ─────────────────────────────────────────────────────────────────────────────

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
