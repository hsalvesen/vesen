import { describe, expect, it } from 'vitest';
import { completionHarness } from '../../testing/completion-env';
import { harness } from '../../testing/shell-harness';
import { vfsLister } from './env';

describe('the completion environment', () => {
  it('lists folders through the VFS, links followed, and never throws', () => {
    const fs = {
      readdir: (path: string) => {
        if (path === '/x') return ['dir', 'run', 'note', 'dangling'];
        throw new Error('EACCES');
      },
      stat: (path: string) => {
        if (path === '/x/dir') return { type: 'directory', mode: 0o755 };
        if (path === '/x/run') return { type: 'file', mode: 0o755 };
        if (path === '/x/note') return { type: 'file', mode: 0o644 };
        throw new Error('ENOENT');
      },
    } as unknown as Parameters<typeof vfsLister>[0];
    expect(vfsLister(fs).list('/x')).toEqual([
      { name: 'dir', type: 'dir' },
      { name: 'run', type: 'file', exec: true },
      { name: 'note', type: 'file', exec: false },
      { name: 'dangling', type: 'file' },
    ]);
    expect(vfsLister(fs).list('/root')).toBeNull();
  });

  it("is the session's: its folder, variables, aliases and history", async () => {
    const h = await completionHarness();
    await h.run('cd /tmp; alias g=echo; export ZED=1');
    expect(h.env.cwd()).toBe('/tmp');
    expect(h.env.aliases().get('g')).toBe('echo');
    expect(h.env.vars()).toContainEqual(['ZED', '1']);
    expect(h.env.history()).toEqual(['cd /tmp; alias g=echo; export ZED=1']);
    expect(h.env.home()).toBe('/home/guest');
    h.stop();
  });

  it('loads the engine when the completion store is first subscribed to', async () => {
    const h = harness();
    expect(h.shell.completion.get()).toBeNull();
    const stop = h.shell.completion.subscribe(() => {});
    await new Promise<void>((resolve) => {
      const check = (): void => (h.shell.completion.get() === null ? void setTimeout(check, 1) : resolve());
      check();
    });
    const loaded = h.shell.completion.get();
    expect(loaded?.env).toBe(h.shell.completionEnv);
    expect(loaded?.engine.complete({ text: 'ec', cursor: 2 }, loaded.env).candidates.map((c) => c.value)).toEqual(['echo']);
    stop();
  });
});
