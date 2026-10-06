// The prompt, as a Line (docs/plan/designs/shell-architecture.md, section 6): the live prompt
// under the transcript, and the snapshot each entry keeps of the prompt it was typed at, so
// earlier prompts keep their folder after `cd` (F023).
//
//   guest@vesen:~/documents$
//
// The user, host and path take the prompt roles, the punctuation the strong text role, and the
// `$` the error role after a non-zero status. On a narrow terminal the path is shortened to its
// first and last folder, ~/.../src, and a path that would leave the input too little room keeps
// only its end: …site-2026.

import { textWidth, type Line, type SpanStyle } from '../output/model';
import { GUEST, HOST, tildePath } from '../vfs/identity';

/** Below this many columns the path is shortened. */
export const NARROW_PROMPT_COLUMNS = 50;

/**
 * The share of the terminal's width the whole prompt may take, so the input beside it always
 * keeps room to type; a longer path is shortened to fit.
 */
export const PROMPT_SHARE = 0.6;

/** The fewest cells a shortened path keeps. */
const MIN_PATH = 6;

export interface PromptState {
  readonly cwd: string;
  /** The last status; non-zero turns the `$` red. */
  readonly status: number;
  readonly columns: number;
  readonly user?: string;
  readonly host?: string;
  readonly home?: string;
}

/** The path's first and last folder: `~/.../src`, or the path when that is no shorter. */
function firstAndLast(path: string): string {
  const head = path.startsWith('~') ? '~' : '';
  const parts = (head === '~' ? path.slice(1) : path).split('/').filter(Boolean);
  if (parts.length < 2) return path;
  const short = `${head}/.../${parts[parts.length - 1] ?? ''}`;
  return short.length < path.length ? short : path;
}

/**
 * The prompt's path: `~` for home, `~/...` inside it, and on a narrow terminal `~/.../last`.
 * `fixed` is how many cells the rest of the prompt takes (`guest@vesen:` and `$`); with it the
 * whole prompt stays within PROMPT_SHARE of the columns, keeping the end of a long folder name,
 * `…site-2026`, when even `~/.../last` is too long.
 */
export function promptPath(cwd: string, columns: number, home: string = GUEST.home, fixed: number = defaultFixed()): string {
  const path = tildePath(cwd, home);
  const budget = Math.max(MIN_PATH, Math.floor(columns * PROMPT_SHARE) - fixed);
  let shown = columns < NARROW_PROMPT_COLUMNS || textWidth(path) > budget ? firstAndLast(path) : path;
  if (textWidth(shown) > budget) {
    const chars = Array.from(shown);
    shown = `…${chars.slice(chars.length - (budget - 1)).join('')}`;
  }
  return shown;
}

/** `guest@vesen:` and `$`. */
function defaultFixed(user: string = GUEST.name, host: string = HOST): number {
  return textWidth(user) + 1 + textWidth(host) + 2;
}

const style = (fg: SpanStyle['fg']): SpanStyle => ({ fg, bold: true });

export function promptLine(state: PromptState): Line {
  return [
    { text: state.user ?? GUEST.name, style: style('prompt-user') },
    { text: '@', style: style('fg-strong') },
    { text: state.host ?? HOST, style: style('prompt-host') },
    { text: ':', style: style('fg-strong') },
    { text: promptPath(state.cwd, state.columns, state.home, defaultFixed(state.user, state.host)), style: style('prompt-path') },
    { text: '$', style: style(state.status === 0 ? 'fg-strong' : 'error') },
  ];
}

/** The prompt as text: `guest@vesen:~$`. */
export function promptText(line: Line): string {
  return line.map((span) => span.text).join('');
}
