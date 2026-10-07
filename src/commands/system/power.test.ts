// poweroff, reboot and shutdown (F029): the Shutdown app through tty.fullscreen, then a new
// session with the files kept; never from a pipe or a script; and never a dead page.
import { describe, expect, it, vi } from 'vitest';
import { session } from '../../../tests/harness';
import { createAppRunner } from '../../shell/apps';
import { POWER_ON, type ShutdownView } from '../../shell/shutdown';
import { shutdownLines } from './power.run';

/** Shows each app and powers on at once, recording what was shown. */
function powerOnAtOnce() {
  const shown: { view: string; props: ShutdownView }[] = [];
  const fullscreen = vi.fn(async (view: string, props: unknown) => {
    shown.push({ view, props: props as ShutdownView });
    return POWER_ON;
  });
  return { shown, fullscreen };
}

describe('poweroff', () => {
  it("shows systemd's lines in the Shutdown app, then starts a new session that keeps the files", async () => {
    const { shown, fullscreen } = powerOnAtOnce();
    const s = await session({ fullscreen });
    await s.run('echo kept > notes.txt');
    await s.run('cd /tmp');
    await s.run('export LEFT=1');
    const result = await s.run('poweroff');
    expect(result.status).toBe(0);
    // A new session: the screen is reset to the banner, and the shell is home again.
    expect(result.screen).toEqual([]);
    expect(shown).toEqual([{ view: 'shutdown', props: { kind: 'poweroff', lines: shutdownLines('poweroff', 'guest'), inApp: false, touch: false } }]);
    expect((await s.run('pwd')).stdoutPlain).toBe('/home/guest');
    expect((await s.run('cat notes.txt')).stdoutPlain).toBe('kept');
    expect((await s.run('echo "[$LEFT]"')).stdoutPlain).toBe('[]');
    s.stop();
  });

  it('tells the app it is in an in-app browser, so the off screen says how to close the page', async () => {
    const { shown, fullscreen } = powerOnAtOnce();
    const s = await session({ fullscreen, inApp: 'instagram', touch: true });
    await s.run('poweroff');
    expect(shown[0]?.props).toMatchObject({ inApp: true, touch: true });
    s.stop();
  });

  it('runs only at the prompt: never in a pipe, $( ) or a script', async () => {
    const { fullscreen } = powerOnAtOnce();
    const s = await session({ fullscreen });
    expect(await s.run('poweroff | cat')).toMatchObject({ status: 0, stderrPlain: 'poweroff: only at the prompt' });
    expect(await s.run('X=$(reboot); echo $?')).toMatchObject({ stdoutPlain: '1' });
    expect(fullscreen).not.toHaveBeenCalled();
    s.stop();
  });

  it('is interrupted by ^C while the screen is up, and the prompt comes back', async () => {
    const apps = createAppRunner();
    const s = await session({ fullscreen: (view, props) => apps.open(view, props) });
    const handle = s.app.shell.start('poweroff');
    await vi.waitFor(() => expect(apps.request.get()?.view).toBe('shutdown'));
    handle.abort();
    expect((await handle.done).status).toBe(130);
    s.stop();
  });

  it('describes the shutdown as systemd does, ending with the power state', () => {
    const lines = shutdownLines('poweroff', 'guest');
    expect(lines[1]).toBe('[  OK  ] Stopped vesen shell session for guest.');
    expect(lines).toContain('[  OK  ] Unmounted /home/guest (your files are kept).');
    expect(lines.slice(-2)).toEqual(['[  OK  ] Reached target System Power Off.', 'reboot: Power down']);
    expect(shutdownLines('reboot', 'guest').slice(-2)).toEqual(['[  OK  ] Reached target System Reboot.', 'reboot: Restarting system']);
  });
});

describe('reboot and shutdown', () => {
  it('reboot comes straight back up', async () => {
    const { shown, fullscreen } = powerOnAtOnce();
    const s = await session({ fullscreen });
    expect((await s.run('reboot')).status).toBe(0);
    expect(shown[0]?.props.kind).toBe('reboot');
    s.stop();
  });

  it('shutdown powers off, or reboots with -r, now only', async () => {
    const { shown, fullscreen } = powerOnAtOnce();
    const s = await session({ fullscreen });
    expect((await s.run('shutdown now')).status).toBe(0);
    expect((await s.run('shutdown -r now')).status).toBe(0);
    expect((await s.run('shutdown')).status).toBe(0);
    expect(shown.map((app) => app.props.kind)).toEqual(['poweroff', 'reboot', 'poweroff']);
    expect(await s.run('shutdown +5')).toMatchObject({ status: 1, stderrPlain: "shutdown: scheduled shutdowns are not supported; try 'shutdown now'" });
    expect(shown).toHaveLength(3);
    s.stop();
  });
});
