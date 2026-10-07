// Characters that make a command line read differently from how it runs: C0 and C1 controls,
// line and paragraph separators, and the bidirectional embeddings, overrides and isolates
// (U+202A-U+202E, U+2066-U+2069), which can draw `rm -r ~/x` as something harmless. Tab is not
// one: it is whitespace to the shell. A line a tap may run or insert (output/model.ts) must have
// none, and text pasted or typed at the prompt (shell/editor/normalize.ts) has them replaced.

/** One such character. */
export const UNSAFE_IN_LINE = /[\u0000-\u0008\u000a-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/;

const UNSAFE_ALL = new RegExp(UNSAFE_IN_LINE.source, 'g');

/** What stands in for a character that was taken out: shown, so nothing is hidden. */
export const REPLACEMENT_CHARACTER = '\ufffd';

/** True when `text` has none of them. */
export function safeInLine(text: string): boolean {
  return !UNSAFE_IN_LINE.test(text);
}

/** `text` with each of them replaced by U+FFFD, so what is shown is what runs. */
export function replaceUnsafe(text: string): string {
  return text.replace(UNSAFE_ALL, REPLACEMENT_CHARACTER);
}
