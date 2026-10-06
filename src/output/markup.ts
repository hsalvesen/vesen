// The owner's colour markup (docs/plan/designs/shell-architecture.md, "Content"). The styled
// documents in src/content are written as plain text with tags such as `{yellow,bold}` and `{/}`:
//
//   {cyan}help{/} to see all available commands
//
// - A tag is a comma-separated list of palette or role names (`brightBlue`, `accent`) and
//   attributes (bold, dim, italic, underline, strike, inverse). It adds to the style in force.
// - `{/}` closes the most recent tag.
// - `{{` is a literal `{`. Any other `{` that does not start a valid tag is literal too.
//
// parseMarkup gives the plain text, which the VFS stores so grep and wc see prose, and the styled
// lines that cat shows on a terminal. Parsing never produces an Action or a link: text in a file
// can only ever be coloured.

import { isPalette, isRole, type Colour, type Line, type Span, type SpanStyle } from './model';

const ATTRIBUTES = ['bold', 'dim', 'italic', 'underline', 'strike', 'inverse'] as const;
type Attribute = (typeof ATTRIBUTES)[number];

function isAttribute(name: string): name is Attribute {
  return (ATTRIBUTES as readonly string[]).includes(name);
}

export interface Markup {
  /** The document without its tags. */
  readonly text: string;
  /** One Line per line of `text`; a final newline ends the last line rather than starting another. */
  readonly lines: readonly Line[];
}

/** Reads one tag's names into a style on top of `base`; null when it is not a valid tag. */
function readTag(body: string, base: SpanStyle): SpanStyle | null {
  const names = body.split(',').map((name) => name.trim());
  if (names.length === 0 || names.some((name) => name === '')) return null;
  let style: { -readonly [K in keyof SpanStyle]: SpanStyle[K] } = { ...base };
  let colours = 0;
  for (const name of names) {
    if (isAttribute(name)) {
      style = { ...style, [name]: true };
    } else if (isPalette(name) || isRole(name)) {
      colours += 1;
      style = { ...style, fg: name satisfies Colour };
    } else {
      return null;
    }
  }
  return colours > 1 ? null : style;
}

function sameStyle(a: SpanStyle | undefined, b: SpanStyle | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof SpanStyle>;
  for (const key of keys) if (a[key] !== b[key]) return false;
  return true;
}

function isEmptyStyle(style: SpanStyle): boolean {
  return Object.keys(style).length === 0;
}

/** Parses `{colour}` markup into plain text and styled lines. */
export function parseMarkup(source: string): Markup {
  if (source === '') return { text: '', lines: [] };
  const runs: { text: string; style: SpanStyle }[] = [];
  const stack: SpanStyle[] = [];
  let style: SpanStyle = {};
  let text = '';
  let pending = '';

  const flush = (): void => {
    if (pending === '') return;
    runs.push({ text: pending, style });
    text += pending;
    pending = '';
  };

  let i = 0;
  while (i < source.length) {
    const c = source[i] ?? '';
    if (c !== '{') {
      pending += c;
      i += 1;
      continue;
    }
    if (source[i + 1] === '{') {
      pending += '{';
      i += 2;
      continue;
    }
    const close = source.indexOf('}', i + 1);
    const body = close === -1 ? null : source.slice(i + 1, close);
    if (body === '/') {
      flush();
      style = stack.pop() ?? {};
      i = (close as number) + 1;
      continue;
    }
    const next = body === null || body.includes('\n') || body.includes('{') ? null : readTag(body, style);
    if (next === null) {
      pending += c;
      i += 1;
      continue;
    }
    flush();
    stack.push(style);
    style = next;
    i = (close as number) + 1;
  }
  flush();

  // Split the runs into lines, merging neighbours of the same style.
  const lines: Span[][] = [[]];
  for (const run of runs) {
    const parts = run.text.split('\n');
    parts.forEach((part, index) => {
      if (index > 0) lines.push([]);
      if (part === '') return;
      const line = lines[lines.length - 1] as Span[];
      const last = line[line.length - 1];
      const runStyle = isEmptyStyle(run.style) ? undefined : run.style;
      if (last !== undefined && sameStyle(last.style, runStyle)) {
        line[line.length - 1] = runStyle === undefined ? { text: last.text + part } : { text: last.text + part, style: runStyle };
      } else {
        line.push(runStyle === undefined ? { text: part } : { text: part, style: runStyle });
      }
    });
  }
  // A final newline ends the last line rather than starting another.
  if (text.endsWith('\n')) lines.pop();
  return { text, lines };
}

/** Writes plain text as markup: every `{` doubled, so the text reads back unchanged. */
export function escapeMarkup(text: string): string {
  return text.replace(/\{/g, '{{');
}
