// The Tab state machine (docs/plan/02-architecture-and-contracts.md, section 5; designs/
// terminal-input.md, "TAB STATE MACHINE"). Pure: each press takes the state and the line and
// returns the next state and what the editor should do.
//
//   idle      Tab: 0 candidates -> bell and 'No completions'; 1 -> accept it; a longer common
//             prefix -> extend to it (extended); otherwise -> list (listed), or over ASK_ABOVE
//             first ask 'Display all N possibilities? (y or n)' (asking)
//   extended  Tab on the same line -> list
//   listed    Tab on the same line -> menu: candidate 0 goes on the line (Shift+Tab: the last)
//   menu      Tab / Shift+Tab -> the next or previous candidate, wrapping; Escape puts back the
//             line from before the menu; Enter accepts without running; any other key commits
//             the candidate on the line and goes on as usual
//
// A phase belongs to the line it was entered on: on any other line, Tab starts again from idle.

import { accept, complete, extendToCommon } from './engine';
import { TAB_IDLE, tabKey, type CompletionEnv, type CompletionResult, type EditState, type MenuKey, type TabState, type TabStep, type TabView } from './types';

export { tabKey };

/** Above this many candidates, the list asks before it shows them all, as bash does. */
export const ASK_ABOVE = 100;

export const NO_COMPLETIONS = 'No completions';

export function question(total: number): string {
  return `Display all ${total} possibilities? (y or n)`;
}

function listOf(result: CompletionResult, key: string): TabStep {
  if (result.total > ASK_ABOVE) {
    const asked = question(result.total);
    return { tab: { phase: 'asking', key, result }, effect: { question: asked, announce: asked, list: 'hide' } };
  }
  return {
    tab: { phase: 'listed', key, result },
    effect: { list: 'show', highlight: null, announce: `${result.total} completions` },
  };
}

function choose(result: CompletionResult, anchor: EditState, index: number): TabStep {
  const candidate = result.candidates[index];
  if (candidate === undefined) return { tab: TAB_IDLE, effect: { list: 'hide' } };
  const edit = accept(result, candidate, 'cycle');
  return {
    tab: { phase: 'menu', key: tabKey(edit), result, index, anchor },
    effect: { edit, list: 'show', highlight: index, announce: candidate.label },
  };
}

/** One press of Tab, or of Shift+Tab with `reverse`. */
export function pressTab(tab: TabState, state: EditState, env: CompletionEnv, reverse = false): TabStep {
  const key = tabKey(state);
  if (tab.phase !== 'idle' && tab.key === key) {
    if (tab.phase === 'menu') {
      const n = tab.result.candidates.length;
      return choose(tab.result, tab.anchor, (tab.index + (reverse ? -1 : 1) + n) % n);
    }
    if (tab.phase === 'listed') {
      return choose(tab.result, state, reverse ? tab.result.candidates.length - 1 : 0);
    }
    if (tab.phase === 'asking') return answer(tab, true);
  }

  const result = complete(state, env);
  if (result.total === 0) return { tab: TAB_IDLE, effect: { bell: true, announce: NO_COMPLETIONS, list: 'hide', question: null } };
  const only = result.candidates[0];
  if (result.total === 1 && only !== undefined) {
    // So the next Tab goes on from here: into a folder, or on to the next word.
    return { tab: TAB_IDLE, effect: { edit: accept(result, only, 'final'), list: 'hide', question: null } };
  }
  const extended = extendToCommon(result);
  if (extended !== null) return { tab: { phase: 'extended', key: tabKey(extended) }, effect: { edit: extended, list: 'hide', question: null } };
  return listOf(result, key);
}

/** Enter, Escape or any other key while the menu is open. */
export function menuKey(tab: TabState, key: MenuKey): TabStep {
  if (tab.phase !== 'menu') return { tab, effect: {} };
  const hide = { list: 'hide', highlight: null } as const;
  if (key === 'escape') return { tab: TAB_IDLE, effect: { ...hide, edit: tab.anchor } };
  const candidate = tab.result.candidates[tab.index];
  if (key === 'enter' && candidate !== undefined) return { tab: TAB_IDLE, effect: { ...hide, edit: accept(tab.result, candidate, 'final') } };
  return { tab: TAB_IDLE, effect: hide };
}

/** The answer to `Display all N possibilities? (y or n)`. */
export function answer(tab: TabState, yes: boolean): TabStep {
  if (tab.phase !== 'asking') return { tab, effect: {} };
  if (!yes) return { tab: TAB_IDLE, effect: { question: null, list: 'hide' } };
  return { tab: { phase: 'listed', key: tab.key, result: tab.result }, effect: { question: null, list: 'show', highlight: null } };
}

/** What the list under the prompt shows for a Tab state. */
export function tabView(tab: TabState): TabView {
  switch (tab.phase) {
    case 'listed':
      return { result: tab.result, highlight: null, question: null };
    case 'menu':
      return { result: tab.result, highlight: tab.index, question: null };
    case 'asking':
      return { result: null, highlight: null, question: question(tab.result.total) };
    default:
      return { result: null, highlight: null, question: null };
  }
}
