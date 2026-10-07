import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { at, completionHarness, type CompletionHarness } from '../../testing/completion-env';
import { complete } from './engine';
import { applyGhost, ghostFor } from './ghost';
import type { CompletionEnv } from './types';

let h: CompletionHarness;
let env: CompletionEnv;

beforeAll(async () => {
  h = await completionHarness();
  env = h.env;
});
afterAll(() => h.stop());

const ghost = (line: string, history: readonly string[] = [], options = {}) => {
  const state = at(line);
  return ghostFor(state, complete(state, env), history, options);
};

describe('ghostFor', () => {
  it('offers the rest of the newest history line that starts with the whole line', () => {
    expect(ghost('the', ['theme ls', 'theme set wombat'])).toEqual({ text: 'me set wombat', source: 'history', acceptable: true });
  });

  it('skips a history line with a line break, which the one-line prompt cannot hold', () => {
    expect(ghost('echo', ['echo plain', 'echo "a\nb"'])).toEqual({ text: ' plain', source: 'history', acceptable: true });
  });

  it('prefers history to a completion', () => {
    expect(ghost('ca', ['cat README.md'])?.source).toBe('history');
    expect(ghost('ca', [])).toEqual({ text: 't', source: 'completion', acceptable: true });
  });

  it('offers the rest of the one candidate, or of the shared prefix', () => {
    expect(ghost('the')).toEqual({ text: 'me ', source: 'completion', acceptable: true });
    expect(ghost('cat documents/li')?.text).toBe('nux.txt ');
    expect(ghost('set -o ')).toEqual({ text: 'no', source: 'completion', acceptable: true });
  });

  it('shows a placeholder that cannot be accepted', () => {
    const hint = ghost('weather ');
    expect(hint).toEqual({ text: 'PLACE', source: 'placeholder', acceptable: false });
    if (hint === null) return;
    expect(applyGhost(at('weather '), hint)).toEqual(at('weather '));
  });

  it('shows nothing mid-line, with a selection, with the menu open, or on an empty line', () => {
    expect(ghost('the‸ ls')).toBeNull();
    expect(ghost('the', [], { selection: true })).toBeNull();
    expect(ghost('the', [], { menuOpen: true })).toBeNull();
    expect(ghost('', ['help'])).toBeNull();
  });

  it('shows nothing for a completion that would rewrite what was typed', () => {
    expect(ghost('cat readme')).toBeNull();
  });

  it('accepts all of a ghost, or one word of it', () => {
    const history = ghost('the', ['theme set wombat']);
    if (history === null) throw new Error('no ghost');
    expect(applyGhost(at('the'), history)).toEqual({ text: 'theme set wombat', cursor: 16 });
    expect(applyGhost(at('the'), history, 'word')).toEqual({ text: 'theme', cursor: 5 });
    const path = { text: 'uments/linux.txt', source: 'history', acceptable: true } as const;
    expect(applyGhost(at('cat doc'), path, 'word').text).toBe('cat documents/');
  });
});
