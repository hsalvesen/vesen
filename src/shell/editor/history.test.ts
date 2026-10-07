import { describe, expect, it } from 'vitest';
import type { EditState } from '../complete/types';
import { NAV_IDLE, searchHistory, searchLabel, searchResult, startSearch, stepHistory, stepSearch, updateSearch, type HistoryNav } from './history';

const LINES = ['ls', 'cat notes.txt', 'cd docs', 'cat notes.txt', 'echo hi', 'cat readme.md'];

function walk(lines: readonly string[], start: EditState, dirs: (-1 | 1)[]): string[] {
  let nav: HistoryNav = NAV_IDLE;
  let state = start;
  const seen: string[] = [];
  for (const dir of dirs) {
    const step = stepHistory(lines, nav, state, dir);
    if (step === null) {
      seen.push('(none)');
      continue;
    }
    ({ nav, state } = step);
    seen.push(state.text);
  }
  return seen;
}

describe('Up and Down', () => {
  it('step through every line from an empty prompt, each line once, where it was last run', () => {
    expect(walk(LINES, { text: '', cursor: 0 }, [-1, -1, -1, -1, -1, -1])).toEqual([
      'cat readme.md',
      'echo hi',
      'cat notes.txt',
      'cd docs',
      'ls',
      '(none)',
    ]);
  });

  it('never offer a line twice, however often it recurs, in either direction', () => {
    const lines = ['echo a', 'echo b', 'echo a', 'echo b', 'echo a', 'echo c'];
    const draft = { text: 'echo', cursor: 4 };
    expect(walk(lines, draft, [-1, -1, -1, -1, 1, 1, 1])).toEqual(['echo c', 'echo a', 'echo b', '(none)', 'echo a', 'echo c', 'echo']);
  });

  it('offer only lines starting with what was typed, and Down past the newest restores the draft', () => {
    const draft = { text: 'cat', cursor: 3 };
    expect(walk(LINES, draft, [-1, -1, -1, 1, 1, 1])).toEqual(['cat readme.md', 'cat notes.txt', '(none)', 'cat readme.md', 'cat', '(none)']);
  });

  it('keep the cursor of the draft when it comes back', () => {
    const draft = { text: 'cat', cursor: 1 };
    const up = stepHistory(LINES, NAV_IDLE, draft, -1);
    expect(up?.state).toEqual({ text: 'cat readme.md', cursor: 13 });
    const down = up && stepHistory(LINES, up.nav, up.state, 1);
    expect(down).toEqual({ nav: NAV_IDLE, state: draft });
  });

  it('Down at the draft does nothing', () => {
    expect(stepHistory(LINES, NAV_IDLE, { text: 'x', cursor: 1 }, 1)).toBeNull();
  });

  it('Up with no history does nothing', () => {
    expect(stepHistory([], NAV_IDLE, { text: '', cursor: 0 }, -1)).toBeNull();
  });
});

describe('reverse-i-search', () => {
  it('finds the newest line containing the query, then older ones with Ctrl+R, newer with Ctrl+S', () => {
    let search = updateSearch(LINES, startSearch({ text: 'draft', cursor: 5 }), 'cat');
    expect(search.hit).toMatchObject({ index: 5, line: 'cat readme.md', at: 0 });
    search = stepSearch(LINES, search, -1);
    expect(search.hit).toMatchObject({ index: 3, line: 'cat notes.txt' });
    // The same line again is skipped.
    search = stepSearch(LINES, search, -1);
    expect(search).toMatchObject({ failed: true, hit: { index: 3 } });
    search = stepSearch(LINES, { ...search, failed: false }, 1);
    expect(search.hit).toMatchObject({ index: 5 });
  });

  it('fails when nothing matches, keeping the last line found and saying so', () => {
    const found = updateSearch(LINES, startSearch({ text: '', cursor: 0 }), 'ec');
    expect(found.hit?.line).toBe('echo hi');
    const failed = updateSearch(LINES, found, 'ecz');
    expect(failed).toMatchObject({ failed: true, hit: { line: 'echo hi' } });
    expect(searchLabel(failed)).toBe('(failed reverse-i-search)');
    expect(searchLabel(found)).toBe('(reverse-i-search)');
  });

  it('a longer query keeps looking from the line found; a shorter one starts again', () => {
    let search = updateSearch(LINES, startSearch({ text: '', cursor: 0 }), 'c');
    expect(search.hit?.line).toBe('cat readme.md');
    search = stepSearch(LINES, search, -1);
    expect(search.hit?.line).toBe('echo hi');
    search = updateSearch(LINES, search, 'cd');
    expect(search.hit?.line).toBe('cd docs');
    search = updateSearch(LINES, search, 'c');
    expect(search.hit?.line).toBe('cat readme.md');
  });

  it('ends on the line found with the cursor where it matched, or puts back the saved line', () => {
    const saved = { text: 'draft', cursor: 2 };
    expect(searchResult(startSearch(saved))).toEqual(saved);
    expect(searchResult(updateSearch(LINES, startSearch(saved), 'notes'))).toEqual({ text: 'cat notes.txt', cursor: 4 });
  });

  it('matches nothing for an empty query', () => {
    expect(searchHistory(LINES, '', 5, -1)).toBeNull();
  });
});
