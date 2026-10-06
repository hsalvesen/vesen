// Cleans what reaches the prompt (docs/plan/designs/terminal-input.md, normalize.ts).
//
// Typed: iOS and macOS "smart punctuation" turns ' and " into curly quotes, -- into an em dash
// and ... into an ellipsis as they are typed, none of which a shell understands. They are put
// back the way a keyboard without the feature types them.
//
// Pasted: a line copied from a web page often starts with the `$ ` of a prompt, and several
// lines arrive at once. The prompt is removed, the lines are joined with `; ` so they run in
// order, and nothing runs until Enter: a paste never submits.

const TYPED: ReadonlyArray<readonly [RegExp, string]> = [
  [/[‘’‚‛′]/g, "'"],
  [/[“”„‟″]/g, '"'],
  // An em dash is what -- becomes; an en dash comes from the same feature on some keyboards.
  [/[–—]/g, '--'],
  [/…/g, '...'],
  // A no-break space (Option+Space on a Mac) splits words like any space in a shell.
  [/[  ]/g, ' '],
];

/** Typed text with curly quotes, dashes, ellipses and no-break spaces made plain. */
export function normalizeTyped(text: string): string {
  let out = text;
  for (const [pattern, plain] of TYPED) out = out.replace(pattern, plain);
  return out;
}

/** A leading shell prompt on a pasted line: `$ ls`, or `% ls` from zsh. */
const PASTED_PROMPT = /^\s*[$%]\s+/;

/** A line that ends in an operator waiting for another command: `ls |`, `make &&`, `cd;`. */
const OPEN_OPERATOR = /(?:\|\|?|&&?|;)\s*$/;

/** True when `line` ends in a backslash that escapes the line break, not one that is escaped. */
function endsInEscape(line: string): boolean {
  return /(?:^|[^\\])(?:\\\\)*\\$/.test(line);
}

/**
 * Pasted text as one line: CRLF and CR become line breaks, tabs spaces, a leading `$ ` goes from
 * each line and blank lines are dropped. A line ending in a backslash goes on with the next, as
 * in a shell; one ending in `|`, `&&`, `||` or `;` is followed by the next after a space; any
 * other line break becomes `; `, so the lines run one after another.
 */
export function normalizePaste(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\t/g, ' ').split('\n');
  let out = '';
  let continuing = false;
  for (const raw of lines) {
    // A continued line keeps its start: it may be `  --flag`, never a prompt.
    const line = continuing ? raw : raw.replace(PASTED_PROMPT, '');
    if (!continuing && line.trim() === '') continue;
    if (continuing) out += line;
    else if (out === '') out = line.trimStart();
    else out += OPEN_OPERATOR.test(out) ? ` ${line.trimStart()}` : `; ${line.trimStart()}`;
    continuing = endsInEscape(out);
    out = continuing ? out.slice(0, -1) : out.trimEnd();
  }
  return out.trimEnd();
}
