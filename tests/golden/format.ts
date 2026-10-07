// The on-disk format of the golden files. README.md in this folder describes it for readers;
// parseHtmlTranscript is the reference parser for tests that compare against the goldens.

/** One line typed at the prompt and what the legacy terminal returned for it. */
export interface Step {
  line: string;
  /** The output: a legacy command's exact HTML, or the shell's own lines as spans (blocksToGoldenHtml). */
  html: string;
  /** How many times the terminal bell rang while the line ran. */
  bells: number;
}

const MARKER = /^<!-- \$ (.*) -->\n/gm;

/** Raw output of every step, each introduced by an `<!-- $ line -->` marker on its own line. */
export function formatHtmlTranscript(steps: readonly Step[]): string {
  return steps.map(({ line, html }) => `<!-- $ ${line} -->\n${html}\n`).join('');
}

/** Inverse of formatHtmlTranscript: recovers each line and its exact output. */
export function parseHtmlTranscript(text: string): { line: string; html: string }[] {
  const markers = [...text.matchAll(MARKER)];
  if (markers[0]?.index !== 0) throw new Error('golden transcript does not start with a marker');
  return markers.map((marker, i) => {
    const start = marker.index + marker[0].length;
    const end = markers[i + 1]?.index ?? text.length;
    // Every output is followed by exactly one newline before the next marker or the end.
    const chunk = text.slice(start, end);
    if (!chunk.endsWith('\n')) throw new Error(`output of "${marker[1]}" is not newline-terminated`);
    return { line: marker[1] ?? '', html: chunk.slice(0, -1) };
  });
}

const BLOCK_TAGS = new Set(['DIV', 'P', 'PRE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'TABLE', 'TR']);

/**
 * Approximates what a reader sees: text in document order, <br> and block boundaries as
 * newlines, non-breaking spaces as spaces, and trailing whitespace trimmed from each line.
 * Screen-reader-only text (.sr-only, the alternative to art) is not on screen, so it is left out.
 */
export function htmlToPlainText(html: string): string {
  const template = document.createElement('template');
  template.innerHTML = html;
  let out = '';
  const breakLine = () => {
    if (out !== '' && !out.endsWith('\n')) out += '\n';
  };
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += (node.textContent ?? '').replace(/ /g, ' ');
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const tag = (node as Element).tagName;
    if ((node as Element).classList.contains('sr-only')) return;
    if (tag === 'BR') {
      out += '\n';
      return;
    }
    const block = BLOCK_TAGS.has(tag);
    if (block) breakLine();
    node.childNodes.forEach(walk);
    if (block) breakLine();
  };
  template.content.childNodes.forEach(walk);
  return out
    .split('\n')
    .map((row) => row.trimEnd())
    .join('\n')
    .replace(/\n+$/, '');
}

/** A terminal-style transcript: `$ line`, the output as plain text, and `[bell]` when it rang. */
export function formatTextTranscript(steps: readonly Step[]): string {
  const blocks = steps.map(({ line, html, bells }) => {
    const rows = [`$ ${line}`];
    const text = htmlToPlainText(html);
    if (text !== '') rows.push(text);
    if (bells > 0) rows.push(bells === 1 ? '[bell]' : `[bell x${bells}]`);
    return rows.join('\n');
  });
  return `${blocks.join('\n')}\n`;
}

/**
 * Drops what Svelte adds to rendered markup but which is not behaviour: comment anchors and
 * the scoped `svelte-<hash>` classes, whose hash changes whenever a component's CSS does.
 */
export function normaliseSvelteMarkup(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, '').replace(/ class="([^"]*)"/g, (_match, classes: string) => {
    const kept = classes.split(/\s+/).filter((name) => name !== '' && !/^svelte-[a-z0-9]+$/.test(name));
    return kept.length > 0 ? ` class="${kept.join(' ')}"` : '';
  });
}

// ── What the shell put on the screen, as golden HTML ──────────────────────────────────────

/** The parts of the output model the goldens need; structural, so this file needs no app imports. */
interface GoldenSpan {
  readonly text: string;
  readonly swatches?: { readonly background: string; readonly colours: readonly string[] };
  readonly style?: {
    readonly fg?: string;
    readonly bg?: string;
    readonly bold?: boolean;
    readonly dim?: boolean;
    readonly italic?: boolean;
    readonly underline?: boolean;
    readonly strike?: boolean;
  };
}
type GoldenBlock =
  | { readonly type: 'legacyHtml'; readonly html: string }
  | { readonly type: 'lines'; readonly lines: readonly (readonly GoldenSpan[])[] }
  | { readonly type: 'grid'; readonly items: readonly GoldenSpan[]; readonly notes?: readonly (readonly GoldenSpan[])[] }
  | { readonly type: 'art'; readonly text: string; readonly alt: string }
  | { readonly type: 'component'; readonly name: string; readonly plain: string; readonly alt: string }
  | { readonly type: string };

const ROLES = new Set([
  'fg', 'fg-strong', 'muted', 'accent', 'ok', 'warn', 'error', 'link', 'chip-bg', 'chip-fg', 'ghost', 'selection',
  'cursor', 'prompt-user', 'prompt-host', 'prompt-path', 'sun', 'rain', 'cold', 'hot', 'qr-ink', 'qr-paper',
]);

function goldenColour(name: string): string {
  return ROLES.has(name) ? `var(--role-${name})` : `var(--theme-${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)})`;
}

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function spanHtml(span: GoldenSpan): string {
  if (span.swatches !== undefined) {
    const cells = span.swatches.colours.map((colour) => `<span style="color: ${colour};">██</span>`).join('');
    return `<span aria-hidden="true" style="background-color: ${span.swatches.background};"> ${cells} </span>`;
  }
  const style = span.style ?? {};
  const css = [
    style.fg === undefined ? '' : `color: ${goldenColour(style.fg)};`,
    style.bg === undefined ? '' : `background-color: ${goldenColour(style.bg)};`,
    style.bold ? 'font-weight: bold;' : '',
    style.italic ? 'font-style: italic;' : '',
    style.dim ? 'opacity: 0.65;' : '',
    style.underline || style.strike ? `text-decoration: ${[style.underline ? 'underline' : '', style.strike ? 'line-through' : ''].filter(Boolean).join(' ')};` : '',
  ].filter(Boolean);
  return css.length === 0 ? escapeText(span.text) : `<span style="${css.join(' ')}">${escapeText(span.text)}</span>`;
}

/**
 * A step's output for the golden: a legacy command's HTML exactly as it rendered, a ported
 * command's lines (and the shell's own, such as command not found) as the equivalent spans, a
 * grid (ls) as its items' spans two spaces apart on one line, since the page lays the columns
 * out to its width, a grid with notes (help) as one item and its note per line, art as its
 * hidden text with the alternative, and a rich card (qr) as its plain text with the
 * alternative. Tap actions and live bindings have no HTML form: a live span is recorded as it
 * read when it was written.
 */
export function blocksToGoldenHtml(blocks: readonly GoldenBlock[]): string {
  return blocks
    .map((block) => {
      if ('html' in block) return block.html;
      if ('lines' in block) return block.lines.map((line) => line.map(spanHtml).join('')).join('\n');
      if ('items' in block) {
        const notes = block.notes;
        if (notes === undefined) return block.items.map(spanHtml).join('  ');
        return block.items.map((item, i) => `${spanHtml(item)}  ${(notes[i] ?? []).map(spanHtml).join('')}`).join('\n');
      }
      if ('alt' in block && 'text' in block) {
        return `<div class="art" aria-hidden="true">${escapeText(block.text)}</div><span class="sr-only">${escapeText(block.alt)}</span>`;
      }
      if ('plain' in block && 'alt' in block) {
        // A rich card, as the art a pipe receives (qr's), in art's form, with its summary.
        return `<div class="art" aria-hidden="true">${escapeText(block.plain.replace(/\n$/, ''))}</div><span class="sr-only">${escapeText(block.alt)}</span>`;
      }
      throw new Error(`no golden form for a ${block.type} block`);
    })
    .join('\n');
}
