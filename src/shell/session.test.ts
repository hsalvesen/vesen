import { describe, expect, it } from 'vitest';
import { createStorage } from '../services/storage';
import { JobControl, Session, ShellEnv, createHistory, defaultEnv, isVariableName } from './session';
import { GUEST } from './types';

function memoryStorage(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed));
  const area: Storage = {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, value),
  };
  return { storage: createStorage({ localStorage: area, sessionStorage: area }), data };
}

describe('ShellEnv', () => {
  it('keeps values and export flags, and lists exported ones for commands', () => {
    const env = new ShellEnv();
    env.set('A', '1');
    env.set('B', '2', { export: true });
    env.set('A', '3');
    expect(env.get('A')).toBe('3');
    expect(env.isExported('A')).toBe(false);
    expect(env.isExported('B')).toBe(true);
    expect(env.entries(true)).toEqual([['B', '2']]);
    expect(env.entries()).toEqual([
      ['A', '3'],
      ['B', '2'],
    ]);
    env.unset('B');
    expect(env.get('B')).toBeUndefined();
  });

  it('keeps an exported variable exported when it is set again', () => {
    const env = new ShellEnv([['PATH', '/bin', true]]);
    env.set('PATH', '/usr/bin');
    expect(env.isExported('PATH')).toBe(true);
  });

  it('gives a child a copy, with overrides exported, leaving the parent alone', () => {
    const env = new ShellEnv([['A', '1', false]]);
    const child = env.child({ B: '2' });
    child.set('A', 'changed');
    expect(child.get('B')).toBe('2');
    expect(child.isExported('B')).toBe(true);
    expect(env.get('A')).toBe('1');
    expect(env.get('B')).toBeUndefined();
  });

  it('starts a session the way a bash login shell does, for guest at vesen', () => {
    const env = defaultEnv({ columns: 46, rows: 30 });
    expect(Object.fromEntries(env.entries())).toMatchObject({
      HOME: '/home/guest',
      USER: 'guest',
      HOSTNAME: 'vesen',
      PWD: '/home/guest',
      OLDPWD: '/home/guest',
      SHELL: '/bin/vesh',
      TERM: 'xterm-256color',
      COLUMNS: '46',
      LINES: '30',
      PS1: '\\u@\\h:\\w\\$ ',
      PATH: '/home/guest/bin:/usr/local/bin:/usr/bin:/bin',
    });
    expect(env.isExported('HOME')).toBe(true);
    expect(env.isExported('PS1')).toBe(false);
    expect(isVariableName('A_1')).toBe(true);
    expect(isVariableName('1A')).toBe(false);
  });
});

describe('history', () => {
  it('numbers lines, and skips blank lines, lines starting with a space and immediate repeats', () => {
    const history = createHistory();
    for (const line of ['ls', 'ls', ' secret', '', '   ', 'pwd', 'ls']) history.add(line);
    expect(history.list()).toEqual([
      { n: 1, line: 'ls' },
      { n: 2, line: 'pwd' },
      { n: 3, line: 'ls' },
    ]);
    expect(history.get(2)).toBe('pwd');
    expect(history.last()).toBe('ls');
    expect(history.last(2)).toBe('pwd');
    expect(history.findPrefix('p')).toBe('pwd');
    expect(history.search('l')).toEqual({ n: 3, line: 'ls' });
    expect(history.search('l', 3)).toEqual({ n: 1, line: 'ls' });
  });

  it('keeps the newest HISTSIZE lines, and numbers keep counting', () => {
    const history = createHistory({ size: 3 });
    for (const line of ['a', 'b', 'c', 'd']) history.add(line);
    expect(history.list()).toEqual([
      { n: 2, line: 'b' },
      { n: 3, line: 'c' },
      { n: 4, line: 'd' },
    ]);
  });

  it('removes one entry, or all of them', () => {
    const history = createHistory();
    history.add('a');
    history.add('b');
    history.add('c');
    history.remove(1);
    // As bash renumbers after history -d, so !n and the listing agree.
    expect(history.list()).toEqual([
      { n: 1, line: 'b' },
      { n: 2, line: 'c' },
    ]);
    history.add('d');
    expect(history.list().map((entry) => entry.n)).toEqual([1, 2, 3]);
    history.clear();
    expect(history.list()).toEqual([]);
    history.add('e');
    expect(history.list()).toEqual([{ n: 1, line: 'e' }]);
  });

  it('survives a reload under vesen:history:v1, and ignores what it cannot read', () => {
    const { storage, data } = memoryStorage();
    const first = createHistory({ storage: storage.local });
    first.add('echo saved');
    first.add(' echo secret');
    expect(JSON.parse(data.get('vesen:history:v1') ?? '')).toEqual({ v: 1, lines: ['echo saved'] });

    const second = createHistory({ storage: memoryStorage({ 'vesen:history:v1': data.get('vesen:history:v1') ?? '' }).storage.local });
    expect(second.list()).toEqual([{ n: 1, line: 'echo saved' }]);

    for (const raw of ['not json', '{"v":2,"lines":["x"]}', '{"v":1,"lines":"x"}']) {
      expect(createHistory({ storage: memoryStorage({ 'vesen:history:v1': raw }).storage.local }).list()).toEqual([]);
    }
  });

  it('is a store the UI can subscribe to', () => {
    const history = createHistory();
    const seen: number[] = [];
    const stop = history.subscribe((entries) => seen.push(entries.length));
    history.add('a');
    history.clear();
    stop();
    history.add('b');
    expect(seen).toEqual([0, 1, 0]);
  });
});

describe('JobControl', () => {
  it('publishes the running job and clears it at the end', () => {
    const jobs = new JobControl();
    const { id, signal } = jobs.begin('stock', 1000);
    expect(jobs.store.get()).toEqual({ id, name: 'stock', label: null, startedAt: 1000 });
    jobs.describe(id, 'stock', 'fetching AAPL');
    expect(jobs.store.get()?.label).toBe('fetching AAPL');
    jobs.end(id);
    expect(jobs.store.get()).toBeNull();
    expect(signal.aborted).toBe(false);
  });

  it('aborts the job once, and a new job aborts the one before', () => {
    const jobs = new JobControl();
    const first = jobs.begin('a', 0);
    const second = jobs.begin('b', 0);
    expect(first.signal.aborted).toBe(true);
    expect(jobs.abort()).toBe(true);
    expect(second.signal.aborted).toBe(true);
    expect(jobs.abort()).toBe(false);
  });

  it('ignores updates for a job that is no longer current', () => {
    const jobs = new JobControl();
    const old = jobs.begin('a', 0);
    jobs.begin('b', 0);
    jobs.describe(old.id, 'a', 'stale');
    jobs.end(old.id);
    expect(jobs.store.get()?.name).toBe('b');
  });
});

describe('Session', () => {
  it('starts at home, follows moves with PWD and OLDPWD, and resets', () => {
    const session = new Session({ size: () => ({ cols: 50, rows: 20 }) });
    expect(session.currentDir).toBe(GUEST.home);
    session.moveTo('/etc');
    expect(session.env.get('PWD')).toBe('/etc');
    expect(session.env.get('OLDPWD')).toBe('/home/guest');
    expect(session.cwd.get()).toBe('/etc');

    session.env.set('MINE', 'x');
    session.aliases.set('ll', 'ls -l');
    session.options.noclobber = true;
    session.setStatus(3);
    session.reset();
    expect(session.env.get('MINE')).toBeUndefined();
    expect(session.env.get('COLUMNS')).toBe('50');
    expect(session.aliases.size).toBe(0);
    expect(session.options.noclobber).toBe(false);
    expect(session.status).toBe(0);
    expect(session.currentDir).toBe('/home/guest');
  });

  it('keeps $COLUMNS and $LINES in step with the terminal', () => {
    let size = { cols: 80, rows: 24 };
    const session = new Session({ size: () => size });
    size = { cols: 40, rows: 12 };
    session.syncSize();
    expect(session.env.get('COLUMNS')).toBe('40');
    expect(session.env.get('LINES')).toBe('12');
  });
});
