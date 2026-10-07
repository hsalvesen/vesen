import { get } from 'svelte/store';
import { describe, expect, it } from 'vitest';
import type { Line } from '../output/model';
import { MAX_ENTRIES, MAX_LINES, createScreen } from './screen';

const PROMPT: Line = [{ text: 'guest@vesen:~$' }];
const lines = (count: number) => [{ type: 'lines' as const, stream: 'stdout' as const, lines: Array.from({ length: count }, (): Line => [{ text: 'x' }]) }];

describe('the screen store', () => {
  it('numbers entries and fills in their defaults', () => {
    const screen = createScreen(() => 42);
    const id = screen.push({ prompt: PROMPT, line: 'ls', blocks: [] });
    expect(get(screen)).toEqual([{ id, prompt: PROMPT, line: 'ls', blocks: [], state: 'done', origin: 'keyboard', startedAt: 42 }]);
    expect(screen.push({ prompt: null, line: '', blocks: [] })).toBe(id + 1);
  });

  it('adds a notice to the newest entry, clears, and replaces', () => {
    const screen = createScreen();
    screen.push({ prompt: PROMPT, line: 'sudo ls', blocks: [] });
    screen.appendToLast(lines(1));
    expect(screen.entries()[0]?.blocks).toEqual(lines(1));
    screen.clear();
    expect(screen.entries()).toEqual([]);
    screen.appendToLast(lines(1));
    expect(screen.entries()).toEqual([]);
    screen.replace([{ prompt: PROMPT, line: 'banner', blocks: [] }]);
    expect(screen.entries().map((entry) => entry.line)).toEqual(['banner']);
  });

  it(`keeps the newest ${MAX_ENTRIES} entries`, () => {
    const screen = createScreen();
    for (let i = 0; i < MAX_ENTRIES + 5; i += 1) screen.push({ prompt: PROMPT, line: `echo ${i}`, blocks: [] });
    const entries = screen.entries();
    expect(entries).toHaveLength(MAX_ENTRIES);
    expect(entries[0]?.line).toBe('echo 5');
  });

  it(`keeps about ${MAX_LINES} lines, and always the newest entry`, () => {
    const screen = createScreen();
    screen.push({ prompt: PROMPT, line: 'first', blocks: lines(MAX_LINES / 2) });
    screen.push({ prompt: PROMPT, line: 'second', blocks: lines(MAX_LINES / 2) });
    screen.push({ prompt: PROMPT, line: 'third', blocks: lines(10) });
    expect(screen.entries().map((entry) => entry.line)).toEqual(['second', 'third']);
    screen.push({ prompt: PROMPT, line: 'huge', blocks: lines(MAX_LINES * 2) });
    expect(screen.entries().map((entry) => entry.line)).toEqual(['huge']);
  });

  it('changes an entry in place, takes one off, and adds one before another', () => {
    const screen = createScreen(() => 1);
    const first = screen.push({ prompt: PROMPT, line: 'echo a', blocks: [] });
    const running = screen.push({ prompt: PROMPT, line: 'sleep 5', blocks: [], state: 'running', job: 7 });
    screen.update(running, { blocks: lines(2) });
    expect(screen.entries()[1]).toMatchObject({ id: running, line: 'sleep 5', state: 'running', job: 7, blocks: lines(2) });
    screen.update(999, { line: 'nothing' });
    const banner = screen.push({ prompt: null, line: 'banner', blocks: [] }, { before: running });
    expect(screen.entries().map((entry) => entry.id)).toEqual([first, banner, running]);
    screen.remove(first);
    expect(screen.entries().map((entry) => entry.line)).toEqual(['banner', 'sleep 5']);
  });

  it('clears all but what it is told to keep: Ctrl+L keeps the line still running', () => {
    const screen = createScreen();
    screen.push({ prompt: PROMPT, line: 'echo a', blocks: lines(1) });
    screen.push({ prompt: PROMPT, line: 'sleep 5', blocks: [], state: 'running' });
    screen.clear((entry) => entry.state === 'running');
    expect(screen.entries().map((entry) => entry.line)).toEqual(['sleep 5']);
    screen.clear();
    expect(screen.entries()).toEqual([]);
  });
});
