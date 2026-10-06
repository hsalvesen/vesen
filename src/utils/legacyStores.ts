// Migration only: the two stores the legacy code shared through src/stores/history.ts, which
// the screen store (src/stores/screen.ts) has replaced. Deleted with the legacy commands and
// Input.svelte.
import { writable } from 'svelte/store';

/** The shell's history as lines, for the arrow keys and the legacy `history`; kept in step by legacyShell.ts. */
export const commandHistory = writable<string[]>([]);

/** speedtest's phase, for the processing line, until the job's label carries it. */
export const speedtestPhase = writable<string>('');
