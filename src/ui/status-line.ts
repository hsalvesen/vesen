// What the status line (StatusLine.svelte) shows, apart from the component: its spinner, its
// words for a command that says nothing about itself, and how it writes the time a command has run.

/** The spinner's frames, a tenth of a second each. */
export const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;

/** The spinner's one still frame under reduced motion. */
export const STILL = '…';

/** What the line says for a command that says nothing about itself, as legacy commands did. */
export const DEFAULT_LABEL = 'Processing…';

/** Elapsed time shows from this many seconds. */
export const ELAPSED_FROM_S = 3;

/** Seconds as the line shows them: 7s, 1m 05s. */
export function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`;
}
