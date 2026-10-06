// @vitest-environment happy-dom
import { get } from 'svelte/store';
import { afterEach, describe, expect, it } from 'vitest';
import { out } from '../output/model';
import { commandHistory, history } from '../stores/history';
import { emptyHome } from '../vfs/legacy-tree';
import { createAppShell, transcriptScreen } from './shell';

afterEach(() => {
  history.set([]);
  commandHistory.set([]);
});

describe('the transcript as the screen', () => {
  const screen = transcriptScreen(() => 'BANNER');
  const commit = (line: string, screenAction: 'keep' | 'clear' | 'reset', text?: string) =>
    screen.commit({ id: 1, line, origin: 'keyboard', status: 0, interrupted: false, screen: screenAction, blocks: text ? [out.text(text)] : [] });

  it('adds an entry for each line, with its blocks', () => {
    commit('echo hi', 'keep', 'hi');
    commit('true', 'keep');
    expect(get(history)).toEqual([
      { command: 'echo hi', outputs: [[out.text('hi')]] },
      { command: 'true', outputs: [[]] },
    ]);
  });

  it('empties the screen for clear, keeping what came after without its prompt line', () => {
    commit('echo hi', 'keep', 'hi');
    commit('clear', 'clear');
    expect(get(history)).toEqual([]);
    commit('clear; ls', 'clear', 'README.md');
    expect(get(history)).toEqual([{ command: 'clear; ls', echo: false, outputs: [[out.text('README.md')]] }]);
  });

  it('puts the banner back for reset', () => {
    commit('echo hi', 'keep', 'hi');
    commit('reset', 'reset');
    expect(get(history)).toEqual([{ command: 'banner', outputs: ['BANNER'] }]);
  });
});

describe('createAppShell', () => {
  it('records each line in the transcript, and mirrors history for the arrow keys', async () => {
    const app = createAppShell({ banner: () => 'BANNER', fs: emptyHome(), yieldToHost: () => Promise.resolve() });
    await app.shell.run('nope');
    expect(get(history)).toHaveLength(1);
    expect(get(history)[0]?.command).toBe('nope');
    expect(get(commandHistory)).toEqual(['nope']);
    app.stop();
    await app.shell.run('again');
    expect(get(commandHistory)).toEqual(['nope']);
  });
});
