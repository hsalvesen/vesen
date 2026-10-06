// The prompt, as a Line (docs/plan/designs/shell-architecture.md, section 6): the live prompt
// under the transcript, and the snapshot each entry keeps of the prompt it was typed at, so
// earlier prompts keep their folder after `cd` (F023).
//
//   guest@vesen:~/documents$
//
// The user, host and path take the prompt roles, the punctuation the strong text role, and the
// `$` the error role after a non-zero status. On a narrow terminal the path is shortened to its
// first and last folder: ~/.../src.

import type { Line, SpanStyle } from '../output/model';
import { GUEST, HOST, tildePath } from '../vfs/identity';

/** Below this many columns the path is shortened. */
export const NARROW_PROMPT_COLUMNS = 50;

export interface PromptState {
  readonly cwd: string;
  /** The last status; non-zero turns the `$` red. */
  readonly status: number;
  readonly columns: number;
  readonly user?: string;
  readonly host?: string;
  readonly home?: string;
}

/** The prompt's path: `~` for home, `~/...` inside it, and on a narrow terminal `~/.../last`. */
export function promptPath(cwd: string, columns: number, home: string = GUEST.home): string {
  const path = tildePath(cwd, home);
  if (columns >= NARROW_PROMPT_COLUMNS) return path;
  const head = path.startsWith('~') ? '~' : '';
  const parts = (head === '~' ? path.slice(1) : path).split('/').filter(Boolean);
  if (parts.length < 2) return path;
  const short = `${head}/.../${parts[parts.length - 1] ?? ''}`;
  return short.length < path.length ? short : path;
}

const style = (fg: SpanStyle['fg']): SpanStyle => ({ fg, bold: true });

export function promptLine(state: PromptState): Line {
  return [
    { text: state.user ?? GUEST.name, style: style('prompt-user') },
    { text: '@', style: style('fg-strong') },
    { text: state.host ?? HOST, style: style('prompt-host') },
    { text: ':', style: style('fg-strong') },
    { text: promptPath(state.cwd, state.columns, state.home), style: style('prompt-path') },
    { text: '$', style: style(state.status === 0 ? 'fg-strong' : 'error') },
  ];
}

/** The prompt as text: `guest@vesen:~$`. */
export function promptText(line: Line): string {
  return line.map((span) => span.text).join('');
}
