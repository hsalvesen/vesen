// The editor's model: what nano (and vi and vim, which open it) hands the Editor app
// (src/ui/apps/Editor.svelte) through ctx.tty.fullscreen, and the editing nano does that a
// textarea does not: cutting whole lines, pasting them back, finding text, saying where the
// caret is and counting lines as nano counts them. The buffer is written through `save`, which
// the command makes over its own view of the file system, so permissions and persistence apply.
// Pure and DOM-free, so the command and the app share it and node tests it.

/** What the editor hands back when the visitor leaves it. Anything else: it never showed. */
export const EDITOR_CLOSED = 'editor-closed';

export type SaveResult =
  /** Written: `name` is what the buffer is called from now on, `message` what the status line says. */
  | { readonly ok: true; readonly name: string; readonly message: string }
  | { readonly ok: false; readonly message: string };

/** The Editor app's view model. */
export interface EditorView {
  /** The file as the visitor named it (`notes.txt`, `~/x`), or null for a new buffer. */
  readonly name: string | null;
  readonly text: string;
  /** The status line when it opens: `[ Read 3 lines ]`, `[ New File ]`. */
  readonly message: string;
  /** A touch screen: a toolbar for the keys a phone keyboard lacks. */
  readonly touch: boolean;
  /** Where the caret starts, from nano +LINE,COLUMN; both count from 1. */
  readonly line?: number;
  readonly column?: number;
  /** Writes `text` to the file `name`, as the visitor; never throws. */
  readonly save: (name: string, text: string) => SaveResult;
}

/** A view read defensively; null when it has no way to save, which a command always gives. */
export function asEditorView(value: unknown): EditorView | null {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Partial<Record<keyof EditorView, unknown>>;
  if (typeof raw.save !== 'function') return null;
  const save = raw.save as EditorView['save'];
  const position = (n: unknown): number | undefined => (typeof n === 'number' && Number.isInteger(n) && n >= 1 ? n : undefined);
  const line = position(raw.line);
  const column = position(raw.column);
  return {
    name: typeof raw.name === 'string' && raw.name !== '' ? raw.name : null,
    text: typeof raw.text === 'string' ? raw.text : '',
    message: typeof raw.message === 'string' ? raw.message : '',
    touch: raw.touch === true,
    ...(line === undefined ? {} : { line }),
    ...(column === undefined ? {} : { column }),
    save,
  };
}

/** The lines of a text as nano counts them: a last line without a newline still counts. */
export function countLines(text: string): number {
  if (text === '') return 0;
  const breaks = text.split('\n').length - 1;
  return text.endsWith('\n') ? breaks : breaks + 1;
}

/** `[ Read 1 line ]`, `[ Wrote 12 lines ]`. */
export function linesMessage(verb: 'Read' | 'Wrote', lines: number): string {
  return `[ ${verb} ${lines} line${lines === 1 ? '' : 's'} ]`;
}

/** The text as nano writes it: with a newline at the end, unless it is empty. */
export function withFinalNewline(text: string): string {
  return text === '' || text.endsWith('\n') ? text : `${text}\n`;
}

/** The line the caret is on: where it starts, and where it ends before its newline. */
export function lineAt(text: string, caret: number): { start: number; end: number } {
  const at = Math.min(Math.max(0, caret), text.length);
  const start = text.lastIndexOf('\n', at - 1) + 1;
  const newline = text.indexOf('\n', at);
  return { start, end: newline === -1 ? text.length : newline };
}

/**
 * ^K: cuts the caret's line, newline and all, and leaves the caret at the start of the line that
 * moved up. The cut always ends in a newline, so pasting it back gives a whole line. Nothing is
 * cut on the empty last line, the one after the final newline.
 */
export function cutLine(text: string, caret: number): { text: string; caret: number; cut: string } {
  const { start, end } = lineAt(text, caret);
  const last = end === text.length;
  if (last && start === end) return { text, caret: start, cut: '' };
  const removedEnd = last ? end : end + 1;
  return { text: text.slice(0, start) + text.slice(removedEnd), caret: start, cut: `${text.slice(start, end)}\n` };
}

/** ^U: puts `clip` in at the caret and leaves the caret after it. */
export function pasteAt(text: string, caret: number, clip: string): { text: string; caret: number } {
  const at = Math.min(Math.max(0, caret), text.length);
  return { text: text.slice(0, at) + clip + text.slice(at), caret: at + clip.length };
}

export type FindResult =
  | { readonly kind: 'found'; readonly index: number; readonly wrapped: boolean }
  /** The only match is the one the caret is already on. */
  | { readonly kind: 'only'; readonly index: number }
  | { readonly kind: 'none' };

/**
 * ^W: the next place `query` is after the caret, ignoring case as nano does, and going round to
 * the top when it reaches the end. Text as typed, never a regular expression.
 */
export function findNext(text: string, query: string, caret: number): FindResult {
  if (query === '') return { kind: 'none' };
  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();
  // Lower case changes the length of very few strings; for those, search as typed.
  const hay = haystack.length === text.length ? haystack : text;
  const pin = haystack.length === text.length ? needle : query;
  const from = Math.min(Math.max(0, caret), text.length);
  const after = hay.indexOf(pin, from + 1);
  if (after !== -1) return { kind: 'found', index: after, wrapped: false };
  const first = hay.indexOf(pin);
  if (first === -1) return { kind: 'none' };
  if (first === from) return { kind: 'only', index: first };
  return { kind: 'found', index: first, wrapped: true };
}

/** What the status line says after a search. */
export function findMessage(result: FindResult, query: string): string {
  if (result.kind === 'none') return `[ "${query}" not found ]`;
  if (result.kind === 'only') return '[ This is the only occurrence ]';
  return result.wrapped ? '[ Search Wrapped ]' : '';
}

function percent(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.floor((part / whole) * 100);
}

/** ^C: where the caret is, as nano says it. Lines and columns count from 1. */
export function location(text: string, caret: number): string {
  const at = Math.min(Math.max(0, caret), text.length);
  const lines = text.split('\n');
  const line = text.slice(0, at).split('\n').length;
  const { start, end } = lineAt(text, at);
  const column = at - start + 1;
  const columns = end - start + 1;
  return `[ line ${line}/${lines.length} (${percent(line, lines.length)}%), col ${column}/${columns} (${percent(column, columns)}%), char ${at}/${text.length} (${percent(at, text.length)}%) ]`;
}

/** Where line `line`, column `column` is in the text, both from 1, kept inside it. */
export function offsetOf(text: string, line: number, column = 1): number {
  let start = 0;
  for (let n = 1; n < line; n += 1) {
    const newline = text.indexOf('\n', start);
    if (newline === -1) break;
    start = newline + 1;
  }
  const { end } = lineAt(text, start);
  return Math.min(start + Math.max(0, column - 1), end);
}

export type Shortcuts = readonly (readonly (readonly [key: string, label: string])[])[];

/** The shortcuts along the bottom on a Mac's keyboard, two rows as nano draws them. */
export const SHORTCUTS: Shortcuts = [
  [
    ['^G', 'Help'],
    ['^O', 'Write Out'],
    ['^W', 'Where Is'],
    ['^K', 'Cut'],
    ['^C', 'Location'],
  ],
  [
    ['^X', 'Exit'],
    ['^S', 'Save'],
    ['^F', 'Find'],
    ['^U', 'Paste'],
  ],
];

/**
 * Elsewhere Ctrl+W closes the browser's tab before the page can stop it, taking the session with
 * it, so the bar offers ^F for Where Is, as nano 8 binds it, and leaves ^W out. ^W still finds
 * wherever the browser lets it through.
 */
export const SHORTCUTS_NOT_MAC: Shortcuts = [
  [
    ['^G', 'Help'],
    ['^O', 'Write Out'],
    ['^F', 'Where Is'],
    ['^K', 'Cut'],
    ['^C', 'Location'],
  ],
  [
    ['^X', 'Exit'],
    ['^S', 'Save'],
    ['^U', 'Paste'],
  ],
];

/** The bar for the keyboard's platform: 'mac' where Cmd, not Ctrl, does the browser's shortcuts. */
export function shortcutsFor(platform: 'mac' | 'other'): Shortcuts {
  return platform === 'mac' ? SHORTCUTS : SHORTCUTS_NOT_MAC;
}

/** What ^G shows in place of the text; ^X, Esc or q go back to it. It fits a phone. */
export const EDITOR_HELP: readonly string[] = [
  'nano: the keys',
  '',
  'Type as in any text box: the arrows, Home,',
  'End and the Page keys move the caret. A ^',
  'means Ctrl (Control on a Mac).',
  '',
  '^O  Write Out  save, asking the file name',
  '^S  Save       save under the same name',
  '^X  Exit       leave, asking to save any',
  '               changes first',
  '^F  Where Is   find text after the caret',
  '^W  Where Is   the same on a Mac; elsewhere',
  '               the browser closes the tab',
  '^K  Cut        cut the line the caret is on;',
  '               cuts in a row collect',
  '^U  Paste      put back what was cut',
  '^C  Location   say where the caret is',
  '^G  Help       these keys',
  '',
  'At a prompt, Enter answers and Esc or ^C',
  'cancels. Saving adds a newline at the end',
  'if there is none. Files are written with',
  'your permissions: one you cannot change',
  'says [ File is unwritable ].',
  '',
  'On a touch screen, the buttons along the',
  'bottom save, leave, find, cut and paste.',
  'Esc, q or ^X closes this help.',
];
