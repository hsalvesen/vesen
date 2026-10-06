// The transcript (docs/plan/designs/shell-architecture.md, section 6): one ScreenEntry per line
// typed, with a snapshot of the prompt it was typed at, so earlier prompts keep their folder
// after `cd` (F023). Pure state: never persisted, and nothing here touches the page (F025).
// It replaces stores/history.ts. Scrollback is capped like a terminal's: past 1000 entries or
// 20,000 lines, the oldest entries go.

import { writable, type Readable } from 'svelte/store';
import type { Block, Line } from '../output/model';
import type { JobOrigin } from '../shell/index';
import type { ExitCode } from '../shell/types';

export const MAX_ENTRIES = 1000;
export const MAX_LINES = 20_000;

export interface ScreenEntry {
  readonly id: number;
  /** The prompt the line was typed at; null for output with no prompt line (after `clear;`, a notice). */
  readonly prompt: Line | null;
  readonly line: string;
  readonly blocks: readonly Block[];
  readonly state: 'running' | 'done' | 'interrupted';
  readonly status?: ExitCode;
  readonly origin: JobOrigin;
  readonly startedAt: number;
  readonly endedAt?: number;
}

export type NewEntry = Omit<ScreenEntry, 'id' | 'state' | 'origin' | 'startedAt'> &
  Partial<Pick<ScreenEntry, 'state' | 'origin' | 'startedAt'>>;

export interface ScreenStore extends Readable<readonly ScreenEntry[]> {
  /** Adds an entry at the end; returns its id. */
  push(entry: NewEntry): number;
  /** Adds blocks to the newest entry, as a notice under the line it belongs to. */
  appendToLast(blocks: readonly Block[]): void;
  /** Empties the screen, as `clear` and Ctrl+L do. */
  clear(): void;
  /** Replaces everything, as `reset` does with the banner. */
  replace(entries: readonly NewEntry[]): void;
  /** The entries now. */
  entries(): readonly ScreenEntry[];
}

/** Lines an entry takes on the screen, for the scrollback cap: its line plus its output's lines. */
function lineCount(entry: ScreenEntry): number {
  let count = entry.prompt === null ? 0 : 1;
  for (const block of entry.blocks) {
    if (block.type === 'lines') count += block.lines.length;
    else if (block.type === 'legacyHtml') count += block.html.split(/<br\s*\/?>|\n/).length;
    else count += 1;
  }
  return count;
}

/** Drops the oldest entries past the caps, keeping at least the newest. */
function capped(entries: readonly ScreenEntry[]): readonly ScreenEntry[] {
  let start = Math.max(0, entries.length - MAX_ENTRIES);
  let lines = 0;
  for (let i = entries.length - 1; i >= start; i -= 1) {
    lines += lineCount(entries[i] as ScreenEntry);
    if (lines > MAX_LINES && i < entries.length - 1) {
      start = i + 1;
      break;
    }
  }
  return start === 0 ? entries : entries.slice(start);
}

export function createScreen(now: () => number = Date.now): ScreenStore {
  let value: readonly ScreenEntry[] = [];
  let nextId = 1;
  const store = writable<readonly ScreenEntry[]>(value);

  const make = (entry: NewEntry): ScreenEntry => ({
    state: 'done',
    origin: 'keyboard',
    startedAt: now(),
    ...entry,
    id: nextId++,
  });

  const set = (next: readonly ScreenEntry[]): void => {
    value = capped(next);
    store.set(value);
  };

  return {
    subscribe: store.subscribe,
    push(entry) {
      const made = make(entry);
      set([...value, made]);
      return made.id;
    },
    appendToLast(blocks) {
      const last = value[value.length - 1];
      if (last === undefined) return;
      set([...value.slice(0, -1), { ...last, blocks: [...last.blocks, ...blocks] }]);
    },
    clear() {
      set([]);
    },
    replace(entries) {
      set(entries.map(make));
    },
    entries: () => value,
  };
}

/** The app's transcript. */
export const screen: ScreenStore = createScreen();
