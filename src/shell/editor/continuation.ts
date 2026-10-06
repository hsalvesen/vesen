// The `> ` continuation prompt (PS2; designs/shell-architecture.md, section 7). When the shell
// says a line is not finished (an open quote or $(, a trailing |, && or ||, or a backslash at
// the end), Enter does not run it: the prompt shows `> ` and the next line is joined on, until
// the whole is complete. This joins them as bash does.

import type { IncompleteReason } from '../ast';

/** Why a line is not finished, as the parser reports it. */
export type ContinuationReason = IncompleteReason;

/** The continuation prompt. */
export const PS2 = '> ';

/**
 * `previous` and the next line typed, as one line: a backslash and its line break vanish; inside
 * quotes or $( ) the line break is kept as part of the text; after |, && or || it is a space.
 */
export function joinContinuation(previous: string, next: string, reason: ContinuationReason): string {
  switch (reason) {
    case 'backslash':
      return previous.endsWith('\\') ? previous.slice(0, -1) + next : previous + next;
    case 'quote':
    case 'subst':
      return `${previous}\n${next}`;
    case 'pipe':
    case 'andor':
      return `${previous} ${next}`;
  }
}

