// The app's shell over a fresh seed, for completion tests: every spec file, the real theme and
// CRT lists, no storage. The engine is imported directly, so tests need not wait for its chunk.

import { createAppShell, type AppShell } from '../app/shell';
import { createClock } from '../services/clock';
import type { CompletionEnv, EditState } from '../shell/complete/types';
import { createScreen } from '../stores/screen';

export interface CompletionHarness {
  readonly app: AppShell;
  readonly env: CompletionEnv;
  /** Runs a line in the session, as typed: cd, alias and export change what completes. */
  run(line: string): Promise<number>;
  stop(): void;
}

export async function completionHarness(): Promise<CompletionHarness> {
  const app = createAppShell({
    banner: () => [],
    screen: createScreen(),
    version: '0.0.0-test',
    clock: createClock({ now: () => Date.UTC(2026, 9, 6, 9, 0, 0), random: () => 0.5, timeZone: 'Australia/Sydney' }),
    terminal: { size: () => ({ cols: 80, rows: 24 }), touch: false, inApp: null },
    yieldToHost: () => Promise.resolve(),
  });
  await app.boot();
  return {
    app,
    env: app.shell.completionEnv,
    run: async (line) => (await app.shell.run(line)).status,
    stop: () => app.stop(),
  };
}

/** A line with the cursor at `‸`, or at the end when there is none. */
export function at(line: string): EditState {
  const caret = line.indexOf('‸');
  if (caret !== -1) return { text: line.slice(0, caret) + line.slice(caret + 1), cursor: caret };
  return { text: line, cursor: line.length };
}
