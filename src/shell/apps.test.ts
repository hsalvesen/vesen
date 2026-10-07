// Full-screen apps for a running command (ctx.tty.fullscreen): one at a time, closed by the UI
// with a result, and gone at ^C.
import { describe, expect, it } from 'vitest';
import { createAppRunner } from './apps';

describe('createAppRunner', () => {
  it('shows an app until the UI closes it with a result', async () => {
    const apps = createAppRunner();
    const shown = apps.open<string>('shutdown', { kind: 'poweroff' });
    const request = apps.request.get();
    expect(request).toMatchObject({ view: 'shutdown', props: { kind: 'poweroff' } });
    apps.close((request?.id ?? 0) + 1, 'wrong app');
    expect(apps.request.get()).not.toBeNull();
    apps.close(request?.id ?? 0, 'power-on');
    expect(await shown).toBe('power-on');
    expect(apps.request.get()).toBeNull();
  });

  it('goes away when the job is interrupted, rejecting with its reason', async () => {
    const apps = createAppRunner();
    const controller = new AbortController();
    const shown = apps.open('shutdown', {}, controller.signal);
    controller.abort(new Error('^C'));
    await expect(shown).rejects.toThrow('^C');
    expect(apps.request.get()).toBeNull();
    await expect(apps.open('shutdown', {}, controller.signal)).rejects.toThrow('^C');
  });

  it('ends an app still showing when another opens', async () => {
    const apps = createAppRunner();
    const first = apps.open('shutdown', 1);
    const second = apps.open('pager', 2);
    expect(await first).toBeUndefined();
    expect(apps.request.get()?.view).toBe('pager');
    apps.close(apps.request.get()?.id ?? 0, 'done');
    expect(await second).toBe('done');
  });
});
