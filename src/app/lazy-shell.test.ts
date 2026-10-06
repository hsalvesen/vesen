import { describe, expect, it } from 'vitest';
import type { JobResult, ScreenCommit, ShellPort } from '../shell/index';
import { writable } from '../shell/observable';
import type { JobInfo } from '../shell/types';
import { lazyShell } from './lazy-shell';

/** A stand-in shell that records what reaches it. */
function fakeShell() {
  const job = writable<JobInfo | null>(null);
  const started: string[] = [];
  const aborted: string[] = [];
  const remembered: string[] = [];
  const result: JobResult = { status: 0, interrupted: false, blocks: [], screen: 'keep' };
  const shell: ShellPort = {
    cwd: writable('/home/guest'),
    lastStatus: writable(0),
    job,
    preflight: (line) => ({ argv: [line], spec: undefined }),
    start: (line) => {
      started.push(line);
      job.set({ name: line, label: null, startedAt: 0 });
      let interrupted = false;
      return {
        id: started.length,
        done: Promise.resolve().then(() => ({ ...result, interrupted, status: interrupted ? 130 : 0 })),
        abort: () => {
          interrupted = true;
          aborted.push(line);
        },
      };
    },
    run: (line) => shell.start(line).done,
    abort: () => false,
    remember: (line) => remembered.push(line),
    renderPrompt: () => [{ text: 'from the shell' }],
  };
  return { shell, started, aborted, remembered };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('lazyShell', () => {
  it('runs a line typed before the kernel arrives as soon as it does', async () => {
    const fake = fakeShell();
    const loading = deferred<ShellPort>();
    const lazy = lazyShell(() => loading.promise, { now: () => 7 });
    expect(lazy.preflight('ls')).toBeNull();
    const handle = lazy.start('ls');
    expect(lazy.job.get()).toEqual({ name: 'ls', label: null, startedAt: 7 });
    loading.resolve(fake.shell);
    expect((await handle.done).status).toBe(0);
    expect(fake.started).toEqual(['ls']);
    expect(lazy.cwd.get()).toBe('/home/guest');
    expect(lazy.preflight('pwd')).toEqual({ argv: ['pwd'], spec: undefined });
  });

  it('starts the waiting lines in order before it shows the kernel’s job, so the prompt never looks idle', async () => {
    const fake = fakeShell();
    const loading = deferred<ShellPort>();
    const lazy = lazyShell(() => loading.promise);
    const seen: (string | null)[] = [];
    lazy.job.subscribe((value) => seen.push(value?.name ?? null));
    const first = lazy.start('one');
    const second = lazy.start('two');
    loading.resolve(fake.shell);
    await Promise.all([first.done, second.done]);
    expect(fake.started).toEqual(['one', 'two']);
    // Idle before anything was typed, and never again until the real job ends.
    expect(seen).toEqual([null, 'one', 'two', 'two']);
  });

  it('interrupts a waiting line as soon as the kernel can run it', async () => {
    const fake = fakeShell();
    const loading = deferred<ShellPort>();
    const lazy = lazyShell(() => loading.promise);
    const handle = lazy.start('stock AAPL');
    expect(lazy.abort()).toBe(true);
    loading.resolve(fake.shell);
    expect((await handle.done).status).toBe(130);
    expect(fake.aborted).toEqual(['stock AAPL']);
  });

  it('remembers lines for history until the kernel arrives', async () => {
    const fake = fakeShell();
    const lazy = lazyShell(() => Promise.resolve(fake.shell));
    lazy.remember('sudo ls');
    await lazy.ready;
    lazy.remember('sudo pwd');
    expect(fake.remembered).toEqual(['sudo ls', 'sudo pwd']);
    expect(lazy.abort()).toBe(false);
  });

  it('says the shell could not load, and records the line', async () => {
    const commits: ScreenCommit[] = [];
    const lazy = lazyShell(() => Promise.reject(new Error('offline')), { screen: { commit: (entry) => commits.push(entry) } });
    const result = await lazy.run('ls');
    expect(result.status).toBe(1);
    expect(commits).toHaveLength(1);
    expect(commits[0]?.blocks[0]).toMatchObject({ type: 'lines', stream: 'stderr' });
    // The prompt it was typed at, drawn from the lazy shell's own stores.
    expect(commits[0]?.prompt.map((span) => span.text).join('')).toBe('guest@vesen:~$');
    expect(lazy.job.get()).toBeNull();
  });

  it('draws the prompt itself until the shell is here, then asks the shell', async () => {
    const fake = fakeShell();
    const loading = deferred<ShellPort>();
    const lazy = lazyShell(() => loading.promise, { columns: () => 30 });
    expect(lazy.renderPrompt().map((span) => span.text).join('')).toBe('guest@vesen:~$');
    loading.resolve(fake.shell);
    await lazy.ready;
    expect(lazy.renderPrompt()).toEqual([{ text: 'from the shell' }]);
  });

  it('forwards the kernel’s stores once it is here', async () => {
    const fake = fakeShell();
    const lazy = lazyShell(() => Promise.resolve(fake.shell));
    await lazy.ready;
    (fake.shell.job as ReturnType<typeof writable<JobInfo | null>>).set({ name: 'x', label: 'busy', startedAt: 1 });
    expect(lazy.job.get()).toEqual({ name: 'x', label: 'busy', startedAt: 1 });
    expect(lazy.start('pwd').id).toBe(1);
  });
});
