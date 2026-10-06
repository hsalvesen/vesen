import { get } from 'svelte/store';
import { afterEach, describe, expect, it } from 'vitest';
import { interruptJob, job, runJob } from './job';

afterEach(() => {
  interruptJob();
});

describe('runJob', () => {
  it('returns what the task returns and clears the job', async () => {
    const outcome = await runJob('echo', () => 'hello');

    expect(outcome).toEqual({ status: 'done', value: 'hello' });
    expect(get(job)).toBeNull();
  });

  it('publishes the running job', async () => {
    let release = (): void => {};
    const pending = runJob('stock', () => new Promise<void>((resolve) => (release = resolve)));

    expect(get(job)).toMatchObject({ name: 'stock' });
    release();
    await pending;
    expect(get(job)).toBeNull();
  });

  it('settles at once on interrupt, even when the task never does and ignores its signal', async () => {
    const pending = runJob('curl', () => new Promise<string>(() => {}));

    expect(interruptJob()).toBe(true);

    await expect(pending).resolves.toEqual({ status: 'interrupted' });
    expect(get(job)).toBeNull();
  });

  it('aborts the signal the task was given', async () => {
    let seen: AbortSignal | undefined;
    const pending = runJob('weather', (signal) => {
      seen = signal;
      return new Promise<string>(() => {});
    });

    interruptJob();
    await pending;

    expect(seen?.aborted).toBe(true);
  });

  it('drops output that arrives after the interrupt', async () => {
    let finish = (_value: string): void => {};
    const pending = runJob('speedtest', () => new Promise<string>((resolve) => (finish = resolve)));

    interruptJob();
    finish('late output');

    await expect(pending).resolves.toEqual({ status: 'interrupted' });
  });

  it('passes on a failure of the task', async () => {
    await expect(
      runJob('cat', () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
  });

  it('reports when there is nothing to interrupt', () => {
    expect(interruptJob()).toBe(false);
  });
});
