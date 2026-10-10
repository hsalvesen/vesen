// The Tab state machine (02, section 5): extend, list, menu; Shift+Tab, Escape, Enter; the
// question over 100 candidates; the bell for none.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { at, completionHarness, type CompletionHarness } from '../../testing/completion-env';
import { answer, menuKey, NO_COMPLETIONS, pressTab, tabView } from './tab';
import { TAB_IDLE, type CompletionEnv, type EditState, type TabState, type TabStep } from './types';

let h: CompletionHarness;
let env: CompletionEnv;

beforeAll(async () => {
  h = await completionHarness();
  env = h.env;
  h.app.vfs.writeFile('/home/guest/documents/my notes.txt', 'notes');
});
afterAll(() => h.stop());

/** Presses Tab (or Shift+Tab) from a state, applying each edit, as the editor does. */
function presses(start: EditState, keys: readonly ('tab' | 'shift')[]): { state: EditState; tab: TabState; steps: TabStep[] } {
  let state = start;
  let tab: TabState = TAB_IDLE;
  const steps: TabStep[] = [];
  for (const key of keys) {
    const step = pressTab(tab, state, env, key === 'shift');
    steps.push(step);
    tab = step.tab;
    if (step.effect.edit) state = step.effect.edit;
  }
  return { state, tab, steps };
}

describe('pressTab', () => {
  it('extends, then lists, then cycles through a menu that wraps, and Shift+Tab goes back', () => {
    const run = presses(at('ca'), ['tab', 'tab', 'tab', 'tab', 'tab', 'shift']);
    const [extend, list, first, second, wrapped, back] = run.steps;
    expect(extend?.effect.edit?.text).toBe('cat');
    expect(extend?.tab.phase).toBe('extended');
    expect(list?.effect).toMatchObject({ list: 'show' });
    expect(list?.effect.edit).toBeUndefined();
    expect(list?.tab.phase).toBe('listed');
    // The menu puts each candidate on the line with nothing after it.
    expect(first?.effect).toMatchObject({ edit: { text: 'cat', cursor: 3 }, highlight: 0 });
    expect(second?.effect).toMatchObject({ edit: { text: 'cathode', cursor: 7 }, highlight: 1 });
    expect(wrapped?.effect).toMatchObject({ edit: { text: 'cat' }, highlight: 0 });
    expect(back?.effect).toMatchObject({ edit: { text: 'cathode' }, highlight: 1 });
    expect(run.tab.phase).toBe('menu');
  });

  it('lists at once when nothing can extend, and Shift+Tab opens the menu at the end', () => {
    const run = presses(at('theme k'), ['tab', 'shift']);
    expect(run.steps[0]?.tab.phase).toBe('listed');
    expect(run.state.text).toBe('theme kookaburra');
  });

  it("lists ls and every one of the fifteen themes after 'theme '", () => {
    const step = pressTab(TAB_IDLE, at('theme '), env);
    expect(step.tab.phase).toBe('listed');
    const listed = step.tab.phase === 'listed' ? step.tab.result.candidates.map((c) => c.value) : [];
    const themes = env.appearance?.themes().map((theme) => theme.name.toLowerCase()) ?? [];
    expect(themes).toHaveLength(15);
    expect(listed).toEqual(['ls', ...themes]);
    expect(step.tab.phase === 'listed' && step.tab.result.total).toBe(16);
  });

  it('Escape in the menu puts back the line from before it', () => {
    const run = presses(at('theme k'), ['tab', 'tab', 'tab']);
    expect(run.state.text).toBe('theme kookaburra');
    const escaped = menuKey(run.tab, 'escape');
    expect(escaped.effect.edit).toEqual({ text: 'theme k', cursor: 7 });
    expect(escaped.tab).toEqual(TAB_IDLE);
    expect(escaped.effect.list).toBe('hide');
  });

  it('Enter in the menu accepts the choice in full, without running it', () => {
    const run = presses(at('cat "documents/'), ['tab', 'tab']);
    expect(run.steps[0]?.tab.phase).toBe('listed');
    expect(run.state.text).toBe('cat "documents/linux.txt');
    const entered = menuKey(run.tab, 'enter');
    expect(entered.effect.edit?.text).toBe('cat "documents/linux.txt" ');
    expect(entered.tab).toEqual(TAB_IDLE);
  });

  it('any other key commits the choice as it is on the line', () => {
    const run = presses(at('cd do'), ['tab', 'tab']);
    expect(run.state.text).toBe('cd documents/');
    const committed = menuKey(run.tab, 'commit');
    expect(committed.effect.edit).toBeUndefined();
    expect(committed.tab).toEqual(TAB_IDLE);
  });

  it('accepts a unique match and goes back to idle, so the next Tab descends', () => {
    const run = presses(at('cd doc'), ['tab']);
    expect(run.state.text).toBe('cd documents/');
    expect(run.tab).toEqual(TAB_IDLE);
    const next = presses(at('cd pro'), ['tab', 'tab']);
    expect(next.state.text).toBe('cd projects/');
    expect(next.tab.phase).toBe('listed');
    if (next.tab.phase === 'listed') expect(next.tab.result.candidates.map((c) => c.label)).toEqual(['learning/', 'portfolio/', 'vesen/']);
  });

  it("completes 'cat doc', then 'li', to cat documents/linux.txt (03, acceptance)", () => {
    const first = presses(at('cat doc'), ['tab']);
    const typed = { text: `${first.state.text}li`, cursor: first.state.text.length + 2 };
    expect(presses(typed, ['tab']).state.text).toBe('cat documents/linux.txt ');
  });

  it('rings the bell and says so when nothing completes', () => {
    const step = pressTab(TAB_IDLE, at('zzz'), env);
    expect(step.effect).toMatchObject({ bell: true, announce: NO_COMPLETIONS });
    expect(step.effect.edit).toBeUndefined();
    expect(step.tab).toEqual(TAB_IDLE);
  });

  it('lists every command on an empty line', () => {
    const step = pressTab(TAB_IDLE, at(''), env);
    expect(step.tab.phase).toBe('listed');
    if (step.tab.phase === 'listed') expect(step.tab.result.total).toBe(env.registry.list().length + env.registry.list().reduce((n, s) => n + (s.aliases?.length ?? 0), 0) + 3 + 2);
  });

  it('starts again when the line changed since the last press', () => {
    const listed = pressTab(TAB_IDLE, at('theme k'), env);
    // The visitor typed 'a' in between: Tab completes the new line instead of opening the menu.
    const step = pressTab(listed.tab, at('theme ka'), env);
    expect(step.effect.edit?.text).toBe('theme kangaroo ');
  });

  it("asks 'Display all N possibilities? (y or n)' over 100, then lists on yes", async () => {
    h.app.vfs.mkdir('/home/guest/many');
    for (let i = 0; i < 120; i += 1) h.app.vfs.writeFile(`/home/guest/many/f${i}`, '');
    try {
      const asked = pressTab(TAB_IDLE, at('cat many/f'), env);
      expect(asked.tab.phase).toBe('asking');
      expect(asked.effect.question).toBe('Display all 120 possibilities? (y or n)');
      expect(tabView(asked.tab).question).toBe('Display all 120 possibilities? (y or n)');
      expect(answer(asked.tab, false)).toMatchObject({ tab: TAB_IDLE, effect: { question: null } });
      const yes = answer(asked.tab, true);
      expect(yes.tab.phase).toBe('listed');
      expect(yes.effect).toMatchObject({ question: null, list: 'show' });
      // Tab at the question is a yes too.
      expect(pressTab(asked.tab, at('cat many/f'), env).tab.phase).toBe('listed');
    } finally {
      h.app.vfs.rm('/home/guest/many', { recursive: true });
    }
  });

  it('shows the list and the menu choice through tabView', () => {
    const run = presses(at('theme k'), ['tab', 'tab']);
    expect(tabView(run.tab)).toMatchObject({ highlight: 0, question: null });
    expect(tabView(run.tab).result?.candidates.map((c) => c.value)).toEqual(['kangaroo', 'kookaburra']);
    expect(tabView(TAB_IDLE)).toEqual({ result: null, highlight: null, question: null });
  });
});
