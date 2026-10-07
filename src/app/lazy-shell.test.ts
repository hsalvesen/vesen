import { describe, expect, it } from 'vitest';
import type { AppRequest, Completion, JobResult, ReadRequest, ScreenCommit, ScreenStart, ShellPort, StartOptions } from '../shell/index';
import { writable, type Writable } from '../shell/observable';
import type { JobInfo } from '../shell/types';
import { lazyShell } from './lazy-shell';

/** A stand-in shell that records what reaches it. */
function fakeShell() {
  const job = writable<JobInfo | null>(null);
  const started: string[] = [];
  const startOptions: (StartOptions | undefined)[] = [];
  const aborted: string[] = [];
  const remembered: string[] = [];
  const closed: [number, unknown][] = [];
  const restored: string[] = [];
  const result: JobResult = { status: 0, interrupted: false, blocks: [], screen: 'keep' };
  const shell: ShellPort = {
    cwd: writable('/home/guest'),
    lastStatus: writable(0),
    job,
    preflight: (line) => ({ argv: [line], spec: undefined }),
    start: (line, _origin, options) => {
      started.push(line);
      startOptions.push(options);
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
    historyLines: writable<readonly string[]>([]),
    reads: writable<ReadRequest | null>(null),
    answerRead: () => {},
    incomplete: () => null,
    completion: writable<Completion | null>(null),
    renderPrompt: () => [{ text: 'from the shell' }],
    apps: writable<AppRequest | null>(null),
    closeApp: (id, result) => closed.push([id, result]),
    restoreCwd: (path) => restored.push(path),
  };
  return { shell, started, startOptions, aborted, remembered, closed, restored };
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
  it('has no completion until the kernel arrives, then forwards the kernel’s', async () => {
    const fake = fakeShell();
    const loading = deferred<ShellPort>();
    const lazy = lazyShell(() => loading.promise);
    expect(lazy.completion.get()).toBeNull();
    const engine = { engine: {}, env: {} } as unknown as Completion;
    (fake.shell.completion as Writable<Completion | null>).set(engine);
    loading.resolve(fake.shell);
    await lazy.ready;
    expect(lazy.completion.get()).toBe(engine);
  });

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

  it('puts a waiting line on the screen at once, and has the kernel carry on with that entry', async () => {
    const fake = fakeShell();
    const loading = deferred<ShellPort>();
    const begun: ScreenStart[] = [];
    const lazy = lazyShell(() => loading.promise, { screen: { begin: (start) => begun.push(start), commit: () => {} }, now: () => 3 });
    lazy.start('ls', 'chip');
    expect(begun).toHaveLength(1);
    const [waiting] = begun;
    expect(waiting).toMatchObject({ line: 'ls', origin: 'chip', startedAt: 3 });
    expect(waiting?.output()).toEqual({ blocks: [], screen: 'keep', clears: 0 });
    loading.resolve(fake.shell);
    await lazy.ready;
    expect(fake.startOptions).toEqual([{ continues: waiting?.id }]);
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

  it('ends a waiting line at once on ^C, with ^C and status 130, and never runs it', async () => {
    const fake = fakeShell();
    const loading = deferred<ShellPort>();
    const commits: ScreenCommit[] = [];
    const lazy = lazyShell(() => loading.promise, { screen: { commit: (entry) => commits.push(entry) }, now: () => 5 });
    const handle = lazy.start('stock AAPL');
    const other = lazy.start('help');
    expect(lazy.abort()).toBe(true);
    // Before the kernel has arrived: the prompt is back, and the transcript has both lines.
    const result = await handle.done;
    expect(result).toMatchObject({ status: 130, interrupted: true, blocks: [{ type: 'lines', lines: [[{ text: '^C' }]] }] });
    expect((await other.done).status).toBe(130);
    expect(lazy.job.get()).toBeNull();
    expect(commits.map((commit) => [commit.line, commit.status, commit.endedAt])).toEqual([
      ['stock AAPL', 130, 5],
      ['help', 130, 5],
    ]);
    expect(lazy.abort()).toBe(false);

    loading.resolve(fake.shell);
    await lazy.ready;
    expect(fake.started).toEqual([]);
    // They are in history, as an interrupted line is.
    expect(fake.remembered).toEqual(['stock AAPL', 'help']);
  });

  it('ends one waiting line on its own handle, leaving the others to run', async () => {
    const fake = fakeShell();
    const loading = deferred<ShellPort>();
    const lazy = lazyShell(() => loading.promise);
    const first = lazy.start('sleep 5');
    const second = lazy.start('ls');
    first.abort();
    expect((await first.done).status).toBe(130);
    // The other line still waits, so the job is not over.
    expect(lazy.job.get()).toMatchObject({ name: 'ls' });
    loading.resolve(fake.shell);
    expect((await second.done).status).toBe(0);
    expect(fake.started).toEqual(['ls']);
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
  it('moves to the folder a snapshot kept once the kernel arrives, showing it at once', async () => {
    const fake = fakeShell();
    const loading = deferred<ShellPort>();
    const lazy = lazyShell(() => loading.promise);
    lazy.restoreCwd('/home/guest/projects');
    expect(lazy.cwd.get()).toBe('/home/guest/projects');
    expect(fake.restored).toEqual([]);
    loading.resolve(fake.shell);
    await lazy.ready;
    expect(fake.restored).toEqual(['/home/guest/projects']);
    lazy.restoreCwd('/tmp');
    expect(fake.restored).toEqual(['/home/guest/projects', '/tmp']);
  });

  it('forwards the apps a command shows, and their close', async () => {
    const fake = fakeShell();
    const lazy = lazyShell(() => Promise.resolve(fake.shell));
    await lazy.ready;
    (fake.shell.apps as Writable<AppRequest | null>).set({ id: 3, view: 'shutdown', props: {} });
    expect(lazy.apps.get()?.id).toBe(3);
    lazy.closeApp(3, 'power-on');
    expect(fake.closed).toEqual([[3, 'power-on']]);
  });
});
