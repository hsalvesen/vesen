// Reads legacy command output (HTML strings) as plain text, without a DOM. Used only for what a
// pipe or a file receives from a `legacyHtml` block; it never decides what is rendered, so it
// does not need to be a full HTML parser, only a faithful reader of what the legacy commands emit.

/** Elements that start and end on their own line, as a reader sees them. */
const BLOCK_TAGS: ReadonlySet<string> = new Set([
  'div', 'p', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'table', 'tr',
]);

/** Elements whose text is never shown. */
const HIDDEN_TAGS: ReadonlySet<string> = new Set(['script', 'style', 'template']);

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  middot: '·',
  bull: '•',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  copy: '©',
  deg: '°',
  times: '×',
  larr: '←',
  rarr: '→',
  uarr: '↑',
  darr: '↓',
};

// One comment, one tag (attribute values may hold '>' inside quotes), a run of text, or a lone '<'.
const TOKEN =
  /<!--[\s\S]*?(?:-->|$)|<(\/?)([a-zA-Z][\w-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?|\s*\/)*)\s*>|[^<]+|</g;

/** Decodes character references; a reference the table does not know is left as typed. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, ref: string) => {
    if (ref.startsWith('#')) {
      const hex = ref[1] === 'x' || ref[1] === 'X';
      const code = Number.parseInt(ref.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
        return '\uFFFD';
      }
      return String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[ref] ?? whole;
  });
}

/**
 * Approximates what a reader sees in an HTML fragment: text in document order, `<br>` and block
 * boundaries as newlines, non-breaking spaces as spaces, trailing whitespace trimmed from each
 * line and trailing blank lines removed. Script and style contents are dropped.
 */
export function htmlToText(html: string): string {
  let out = '';
  let hiddenUntil: string | null = null;
  const breakLine = (): void => {
    if (out !== '' && !out.endsWith('\n')) out += '\n';
  };

  for (const match of html.matchAll(TOKEN)) {
    const [token, closing, rawName] = match;
    if (token.startsWith('<!--')) continue;
    const name = rawName?.toLowerCase();

    if (hiddenUntil !== null) {
      if (closing === '/' && name === hiddenUntil) hiddenUntil = null;
      continue;
    }
    if (name === undefined) {
      out += decodeEntities(token).replace(/\u00a0/g, ' ');
    } else if (name === 'br') {
      // HTML parsers read a stray `</br>` as `<br>` too.
      out += '\n';
    } else if (HIDDEN_TAGS.has(name)) {
      if (closing !== '/' && !/\/\s*>$/.test(token)) hiddenUntil = name;
    } else if (BLOCK_TAGS.has(name)) {
      breakLine();
    }
  }

  return out
    .split('\n')
    .map((row) => row.trimEnd())
    .join('\n')
    .replace(/\n+$/, '');
}
