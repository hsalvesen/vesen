// CommandSpec.dataCost (docs/plan/02-architecture-and-contracts.md, section 4): the shell asks
// before a command spends real data on a phone, a cellular or slow connection, or Data Saver,
// and a no (or ^D) runs nothing.
import { describe, expect, it, vi } from 'vitest';
import { createSysInfo } from '../services/sysinfo';
import type { ConnectionInfo } from '../services/types';
import { harness } from '../testing/shell-harness';
import { dataCostQuestion, megabytes } from './data-cost';
import { defineCommand, type CommandSpec } from './types';

function setup(options: { answer: string | null; connection?: ConnectionInfo; touch?: boolean }) {
  const ran = vi.fn(() => 0);
  const spec = defineCommand({
    name: 'fetchy',
    category: 'network',
    summary: 'spend some data',
    dataCost: { bytes: (argv) => (argv.includes('none') ? 0 : 5_400_000), confirmOn: ['cellular', 'touch'] },
    run: ran,
  });
  const prompts: string[] = [];
  const sys = { ...createSysInfo(null), connection: () => options.connection ?? { saveData: false, cellular: false } };
  const shell = harness({
    specs: [spec],
    sys,
    terminal: {
      size: () => ({ cols: 80, rows: 24 }),
      touch: options.touch ?? false,
      inApp: null,
      readLine: async ({ prompt }) => {
        prompts.push(prompt);
        return options.answer;
      },
    },
  });
  return { ...shell, ran, prompts };
}

describe('the data question', () => {
  it('asks on a cellular connection, and runs on a yes', async () => {
    const { run, ran, prompts } = setup({ answer: 'y', connection: { saveData: false, cellular: true } });
    expect((await run('fetchy')).status).toBe(0);
    expect(prompts).toEqual(['fetchy downloads about 5 MB. Continue? [y/N] ']);
    expect(ran).toHaveBeenCalledTimes(1);
  });

  it('runs nothing on a no, an empty answer or ^D', async () => {
    for (const answer of ['n', '', null]) {
      const { run, ran } = setup({ answer, touch: true });
      expect((await run('fetchy')).status, String(answer)).toBe(1);
      expect(ran).not.toHaveBeenCalled();
    }
  });

  it('asks nothing where none of its conditions hold, or when the line spends nothing', async () => {
    const quiet = setup({ answer: 'n' });
    expect((await quiet.run('fetchy')).status).toBe(0);
    expect(quiet.prompts).toEqual([]);
    const none = setup({ answer: 'n', touch: true });
    expect((await none.run('fetchy none')).status).toBe(0);
    expect(none.prompts).toEqual([]);
  });

  it('asks nothing of a script; the command decides for itself there', async () => {
    const { run, fs, prompts } = setup({ answer: 'n', touch: true });
    fs.writeFile('/home/guest/go', 'fetchy\n', { mode: 0o755 });
    await run('./go');
    expect(prompts).toEqual([]);
  });

  it('words the question in whole megabytes, at least one', () => {
    const spec: CommandSpec = { name: 'x', category: 'network', summary: 'x', dataCost: { bytes: 300_000, confirmOn: ['saveData'] }, run: () => 0 };
    expect(dataCostQuestion(spec, ['x'], { touch: false, saveData: true, cellular: false })).toBe('x downloads about 1 MB. Continue?');
    expect(megabytes(45_088_768)).toBe(45);
  });
});
