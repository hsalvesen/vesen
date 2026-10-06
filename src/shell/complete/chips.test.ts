// The chips (designs/terminal-input.md, chips.ts): completions while typing, the list after Tab,
// starters on an empty touch line, did-you-mean after 127, Stop and Cancel. A chip edits the line
// exactly as choosing the same candidate in the Tab menu and pressing Enter does.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { at, completionHarness, type CompletionHarness } from '../../testing/completion-env';
import { applyChip, chipsFor } from './chips';
import { complete } from './engine';
import { menuKey, pressTab } from './tab';
import { TAB_IDLE, type ChipInput, type CompletionEnv, type EditState, type TabState } from './types';

let h: CompletionHarness;
let env: CompletionEnv;

beforeAll(async () => {
  h = await completionHarness();
  env = h.env;
  h.app.vfs.writeFile('/home/guest/documents/my notes.txt', 'notes');
});
afterAll(() => h.stop());

function input(line: string, extra: Partial<ChipInput> = {}): ChipInput {
  const state = at(line);
  return { mode: 'edit', state, result: complete(state, env), tab: TAB_IDLE, touch: false, registry: env.registry, history: [], max: 12, ...extra };
}

describe('chipsFor', () => {
  it('offers the completions while typing, with the typed part marked and a count of the rest', () => {
    const { chips, more } = chipsFor(input('c', { max: 3 }));
    expect(chips.map((c) => c.label)).toEqual(['cat', 'cathode', 'cd']);
    expect(chips.map((c) => c.matchLen)).toEqual([1, 1, 1]);
    expect(more).toBe(4);
    expect(chips.every((c) => c.action.kind === 'apply')).toBe(true);
  });

  it('marks the typed part of a path by its last name, and carries swatches', () => {
    expect(chipsFor(input('cat documents/li')).chips.map((c) => [c.label, c.matchLen])).toEqual([['linux.txt', 2]]);
    const themes = chipsFor(input('theme set k')).chips;
    expect(themes.map((c) => [c.label, c.swatch])).toEqual([
      ['kangaroo', '#262626'],
      ['kookaburra', '#222222'],
    ]);
  });

  it("offers what comes next after a word typed in full: 'theme' gives ls and set", () => {
    const { chips } = chipsFor(input('theme'));
    expect(chips.map((c) => c.label)).toEqual(['ls', 'set']);
    expect(applyChip(chips[1] ?? chips[0]!)?.text).toBe('theme set ');
  });

  it('shows the whole list after Tab, and marks the menu choice', () => {
    const state = at('c');
    const listed = pressTab(TAB_IDLE, state, env);
    const all = chipsFor(input('c', { tab: listed.tab, max: 2 }));
    expect(all.chips).toHaveLength(7);
    expect(all.more).toBe(0);
    const menu = pressTab(listed.tab, state, env);
    const marked = chipsFor(input('cat', { tab: menu.tab }));
    expect(marked.chips.map((c) => c.selected === true)).toEqual([true, false, false, false, false, false, false]);
  });

  it('offers the starters, in the owner order, on an empty line on a touch screen only', () => {
    const starters = chipsFor(input('', { touch: true }));
    expect(starters.chips.map((c) => c.label)).toEqual(['help', 'cat README.md', 'fastfetch', 'ls', 'theme ls', 'cathode ls']);
    expect(starters.chips.every((c) => c.kind === 'starter' && c.action.kind === 'run')).toBe(true);
    expect(starters.chips[1]?.action).toEqual({ kind: 'run', line: 'cat README.md' });
    expect(chipsFor(input('', { touch: false })).chips).toEqual([]);
  });

  it('offers the command a line that was not found probably meant, as the shell does', () => {
    const after = chipsFor(input('', { lastStatus: 127, history: ['ls', 'pwdd -L'] }));
    expect(after.chips.map((c) => [c.label, c.kind, c.action])).toEqual([['pwd -L', 'didyoumean', { kind: 'run', line: 'pwd -L' }]]);
    // Only after a 127, and never for a guess that would open a page or end the session.
    expect(chipsFor(input('', { lastStatus: 1, history: ['pwdd'] })).chips).toEqual([]);
    expect(chipsFor(input('', { lastStatus: 127, history: ['rest'] })).chips.map((c) => c.label)).not.toContain('reset');
  });

  it('offers a near command for an unknown word while typing, which only edits the line', () => {
    const { chips } = chipsFor(input('fastfecth'));
    expect(chips.map((c) => [c.label, c.kind])).toEqual([['fastfetch', 'didyoumean']]);
    expect(applyChip(chips[0]!)).toEqual({ text: 'fastfetch ', cursor: 10 });
  });

  it('shows Stop while a command runs, and Cancel at a secret prompt', () => {
    expect(chipsFor(input('', { mode: 'busy' })).chips.map((c) => [c.label, c.action.kind])).toEqual([['Stop', 'interrupt']]);
    expect(chipsFor(input('', { mode: 'secret' })).chips.map((c) => [c.label, c.action.kind])).toEqual([['Cancel', 'cancel']]);
    expect(chipsFor(input('', { mode: 'search' })).chips).toEqual([]);
  });

  it('offers nothing for a word typed in full with nothing after it', () => {
    expect(chipsFor(input('pwd')).chips).toEqual([]);
    expect(chipsFor(input('pw')).chips.map((c) => c.label)).toEqual(['pwd']);
  });

  it('has nothing to say before the engine has a result', () => {
    expect(chipsFor({ ...input('ca'), result: null }).chips).toEqual([]);
  });
});

describe('a chip and the Tab menu make the same line', () => {
  /** Menu-selects candidate i of `line` and presses Enter. */
  function menuSelect(state: EditState, index: number): EditState | undefined {
    let tab: TabState = TAB_IDLE;
    let current = state;
    // Into the list first (extending if it can), then into the menu, then along it.
    for (let guard = 0; guard < 10 && tab.phase !== 'listed'; guard += 1) {
      const step = pressTab(tab, current, env);
      tab = step.tab;
      if (step.effect.edit) current = step.effect.edit;
    }
    for (let i = 0; i <= index; i += 1) {
      const step = pressTab(tab, current, env);
      tab = step.tab;
      if (step.effect.edit) current = step.effect.edit;
    }
    return menuKey(tab, 'enter').effect.edit;
  }

  it.each(['c', 'theme ', 'theme set k', 'cd ', 'ls --al', 'cat "documents/', 'cat documents/m', 'echo $HO', 'cathode quality ', 'weather '])(
    'for %j',
    (line) => {
      // The line the list is shown for: after any extension Tab makes first.
      let state = at(line);
      let tab: TabState = TAB_IDLE;
      while (tab.phase !== 'listed') {
        const step = pressTab(tab, state, env);
        tab = step.tab;
        if (step.effect.edit) state = step.effect.edit;
        if (step.tab.phase === 'idle') return;
      }
      const { chips } = chipsFor(input('', { state, result: complete(state, env), tab, max: 200 }));
      expect(chips.length).toBeGreaterThan(1);
      chips.forEach((chip, i) => {
        expect(applyChip(chip), `${line} #${i}`).toEqual(menuSelect(state, i));
      });
    },
  );
});
