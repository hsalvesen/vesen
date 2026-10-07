// The catalogue as the kernel sees it: commands that arrive after the kernel (src/commands/more).
// A name not in the registry yet waits for them, bounded by ^C, before it is 127; a failed load
// is said once and tried again by the next command; the completion store gives a new value when
// they land, so Tab, the ghost and the chips see them.
import { describe, expect, it, vi } from 'vitest';
import help from '../commands/shell/help';
import { harness } from '../testing/shell-harness';
import type { Completion } from './complete/types';
import { defineCommand, type CommandSpec } from './types';

const shout = defineCommand({
  name: 'shout',
  category: 'text',
  summary: 'say it louder',
  run: async (ctx) => {
    await ctx.stdout.write(`${ctx.args.join(' ').toUpperCase()}\n`);
  },
});

/** A catalogue that arrives, or fails, when the test says. */
function deferred() {
  const calls: { resolve: (specs: readonly CommandSpec[]) => void; reject: (error: Error) => void }[] = [];
  const load = vi.fn(
    () =>
      new Promise<readonly CommandSpec[]>((resolve, reject) => {
        calls.push({ resolve, reject });
      }),
  );
  return { load, calls };
}

/** Lets every settled promise run on. */
async function flush(): Promise<void> {
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
}

describe('a name the kernel does not have yet', () => {
  it('waits for the catalogue, then runs the command from it', async () => {
    const { load, calls } = deferred();
    const h = harness({ catalogue: load });
    expect(h.shell.registry.complete).toBe(false);
    let done = false;
    const running = h.run('shout hello').then((result) => {
      done = true;
      return result;
    });
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
    expect(done).toBe(false);
    calls[0]?.resolve([shout]);
    const result = await running;
    expect(result).toMatchObject({ status: 0, stdout: 'HELLO' });
    // From now on it is in the registry: no waiting, no second load.
    expect((await h.run('shout again')).stdout).toBe('AGAIN');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('is 127 only once the catalogue has settled without it', async () => {
    const { load, calls } = deferred();
    const h = harness({ catalogue: load });
    let status: number | null = null;
    const running = h.run('nope').then((result) => {
      status = result.status;
      return result;
    });
    await flush();
    expect(status).toBeNull();
    calls[0]?.resolve([shout]);
    const result = await running;
    expect(result.status).toBe(127);
    expect(result.stderr).toBe("vesen: nope: command not found\nType 'help' to see all commands.");
  });

  it('never waits for a command the kernel has', async () => {
    const { load } = deferred();
    const h = harness({ catalogue: load });
    expect(await h.run('echo hi')).toMatchObject({ status: 0, stdout: 'hi' });
    expect(load).not.toHaveBeenCalled();
  });

  it('stops waiting at ^C, with 130', async () => {
    const { load } = deferred();
    const h = harness({ catalogue: load });
    const running = h.run('shout hi');
    await flush();
    h.shell.abort();
    expect((await running).status).toBe(130);
  });

  it('reports a failed load once, and tries again with the next command', async () => {
    const { load, calls } = deferred();
    const h = harness({ catalogue: load });
    // Both stages wait on the one attempt; its failure is said once, under the first.
    const running = h.run('nope | nada');
    await flush();
    calls[0]?.reject(new Error('Failed to fetch'));
    const failed = await running;
    expect(failed.status).toBe(127);
    const notes = failed.stderr.split('\n').filter((line) => line.startsWith("Some of vesen's commands could not be loaded"));
    expect(notes).toEqual(["Some of vesen's commands could not be loaded (Failed to fetch). The next command will try again."]);
    expect(failed.stderr).toContain('vesen: nope: command not found');
    expect(failed.stderr).toContain('vesen: nada: command not found');

    const retry = h.run('shout back');
    await flush();
    expect(load).toHaveBeenCalledTimes(2);
    calls[1]?.resolve([shout]);
    expect(await retry).toMatchObject({ status: 0, stdout: 'BACK' });
  });
});

describe('a listing', () => {
  it('waits for the catalogue, and shows what there is with a note when it could not be loaded', async () => {
    const { load, calls } = deferred();
    const h = harness({ specs: [help], catalogue: load });
    const listing = h.run('help --all');
    await flush();
    calls[0]?.reject(new Error('Failed to fetch'));
    const result = await listing;
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^echo +display a line of text$/m);
    expect(result.stderr).toBe("Some of vesen's commands could not be loaded (Failed to fetch). The next command will try again.");

    // The next one tries again, and lists them all.
    const again = h.run('help --all');
    await flush();
    expect(load).toHaveBeenCalledTimes(2);
    calls[1]?.resolve([shout]);
    const listed = await again;
    expect(listed.stderr).toBe('');
    expect(listed.stdout).toMatch(/^shout +say it louder$/m);
  });
});

describe('completion', () => {
  it('gives a new value when the catalogue lands, which completes its commands', async () => {
    const { load, calls } = deferred();
    const h = harness({ catalogue: load });
    let latest: Completion | null = null;
    const stop = h.shell.completion.subscribe((value) => (latest = value));
    const before = await vi.waitFor(() => {
      if (latest === null) throw new Error('the engine has not loaded');
      return latest;
    });
    const typed = { text: 'sho', cursor: 3 };
    expect(before.engine.complete(typed, before.env)).toMatchObject({ total: 0, namesCommand: true });
    void h.shell.registry.whenComplete();
    calls[0]?.resolve([shout]);
    const after = await vi.waitFor(() => {
      if (latest === null || latest === before) throw new Error('no new value yet');
      return latest;
    });
    expect(after.engine.complete(typed, after.env).candidates.map((c) => c.value)).toEqual(['shout']);
    stop();
  });
});
