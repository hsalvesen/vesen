import { describe, expect, it } from 'vitest';
import { runLine, session } from '../../../tests/harness';
import { CLEAR_SEQUENCE } from './clear';

describe('history', () => {
  it('numbers every line as bash does, the history line itself last', async () => {
    const s = await session();
    await s.run('pwd');
    await s.run('cd documents');
    const result = await s.run('history');
    expect(result.stdoutPlain).toBe('    1  pwd\n    2  cd documents\n    3  history');
    const first = result.blocks[0];
    // The numbers stand out on the terminal; a pipe gets the text.
    expect(first?.type === 'lines' ? first.lines[0]?.[0]?.style : undefined).toEqual({ fg: 'accent' });
    s.stop();
  });

  it('shows the last N lines', async () => {
    const s = await session({ tty: false });
    for (const line of ['echo a', 'echo b', 'echo c']) await s.run(line);
    expect((await s.run('history 2')).stdoutPlain).toBe('    3  echo c\n    4  history 2');
    expect((await s.run('history 0')).stdoutPlain).toBe('');
    expect(await s.run('history abc')).toMatchObject({ status: 1, stderrPlain: 'vesen: history: abc: numeric argument required' });
    expect(await s.run('history 1 2')).toMatchObject({ status: 1, stderrPlain: 'vesen: history: too many arguments' });
    s.stop();
  });

  it('deletes a line with -d, renumbering the rest, and counts back from the end for a negative offset', async () => {
    const s = await session({ tty: false });
    for (const line of ['echo a', 'echo b', 'echo c']) await s.run(line);
    await s.run('history -d 1');
    expect((await s.run('history')).stdoutPlain).toBe('    1  echo b\n    2  echo c\n    3  history -d 1\n    4  history');
    await s.run('history -d -2');
    expect(s.app.shell.history.list().map((entry) => entry.line)).toEqual(['echo b', 'echo c', 'history -d 1', 'history -d -2']);
    expect(await s.run('history -d 99')).toMatchObject({ status: 1, stderrPlain: 'vesen: history: 99: history position out of range' });
    expect(await s.run('history -d x')).toMatchObject({ status: 2 });
    s.stop();
  });

  it('clears with -c, and starts counting again', async () => {
    const s = await session({ tty: false });
    await s.run('echo a');
    expect(await s.run('history -c')).toMatchObject({ status: 0, stdoutPlain: '' });
    expect((await s.run('history')).stdoutPlain).toBe('    1  history');
    s.stop();
  });

  it('runs !n as the number history shows', async () => {
    const s = await session({ tty: false });
    await s.run('echo one');
    await s.run('echo two');
    await s.run('history -d 1');
    expect(s.app.shell.history.get(1)).toBe('echo two');
    s.stop();
  });
});

describe('clear', () => {
  it('clears the screen on the terminal', async () => {
    const result = await runLine('echo before; clear; echo after');
    expect(result.stdoutPlain).toBe('after');
    expect((await runLine('clear')).blocks).toEqual([]);
  });

  it("writes the terminal's clear sequence into a pipe, which clears the screen at the other end", async () => {
    expect((await runLine('clear', { tty: false })).stdoutPlain).toBe(CLEAR_SEQUENCE);
    const viaCat = await runLine('echo before; clear | cat; echo after');
    expect(viaCat.stdoutPlain).toBe('after');
  });
});
