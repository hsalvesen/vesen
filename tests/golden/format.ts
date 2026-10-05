// The on-disk format of the golden files. README.md in this folder describes it for readers;
// parseHtmlTranscript is the reference parser for tests that compare against the goldens.

/** One line typed at the prompt and what the legacy terminal returned for it. */
export interface Step {
  line: string;
  /** The exact string processCommand resolved to, before History.svelte wraps it. */
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
