// The acceptance checks of docs/plan/08-shell-and-commands.md that the core ports answer, run as
// a visitor types them, on the terminal and into a pipe.
import { describe, expect, it } from 'vitest';
import { runLine, session } from '../../tests/harness';

describe.each([true, false])('08 acceptance checks (stdout on the terminal: %s)', (tty) => {
  it('echo hi > f; cat f prints hi', async () => {
    expect(await runLine('echo hi > f; cat f', { tty })).toMatchObject({ status: 0, stdoutPlain: 'hi' });
  });

  it('cat nope 2>/dev/null || echo missing prints missing', async () => {
    expect(await runLine('cat nope 2>/dev/null || echo missing', { tty })).toMatchObject({ status: 0, stdoutPlain: 'missing', stderrPlain: '' });
  });

  it('mkdir -p a/b && ls a lists b', async () => {
    expect(await runLine('mkdir -p a/b && ls a', { tty })).toMatchObject({ status: 0, stdoutPlain: 'b' });
  });

  it('rm -rf ~/projects works', async () => {
    const s = await session({ tty });
    expect(await s.run('rm -rf ~/projects')).toMatchObject({ status: 0, stdoutPlain: '', stderrPlain: '' });
    expect(s.app.vfs.exists('/home/guest/projects')).toBe(false);
    s.stop();
  });

  it('rm -r . is refused', async () => {
    const s = await session({ tty });
    expect(await s.run('rm -r .')).toMatchObject({ status: 1, stderrPlain: "rm: refusing to remove '.' or '..' directory: skipping '.'" });
    expect(s.app.vfs.readdir('/home/guest').length).toBeGreaterThan(10);
    s.stop();
  });

  it('ls -la ~ shows .bashrc, .ssh and projects', async () => {
    const { status, stdoutPlain } = await runLine('ls -la ~', { tty });
    expect(status).toBe(0);
    for (const name of ['.bashrc', '.ssh', 'projects']) expect(stdoutPlain).toMatch(new RegExp(` ${name.replace('.', '\\.')}$`, 'm'));
  });

  it('ls *.txt expands, and ll works from ~/.bashrc', async () => {
    expect(await runLine('ls *.txt', { tty })).toMatchObject({ status: 0, stdoutPlain: 'history.txt' });
    expect((await runLine('ll', { tty })).stdoutPlain).toMatch(/ \.bashrc$/m);
  });

  it("echo '<img src=x onerror=alert(1)>' prints the text literally", async () => {
    expect((await runLine("echo '<img src=x onerror=alert(1)>'", { tty })).stdoutPlain).toBe('<img src=x onerror=alert(1)>');
  });
});
