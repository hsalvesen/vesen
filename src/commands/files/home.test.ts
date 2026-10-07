// The visitor's home folder and the file commands over the VFS, end to end through the shell, as
// a pipe receives their output.
import { describe, expect, it } from 'vitest';
import { session, type Session } from '../../../tests/harness';

async function piped(): Promise<{ s: Session; run: (line: string) => Promise<string> }> {
  const s = await session({ tty: false });
  const run = async (line: string): Promise<string> => {
    const { stdoutPlain, stderrPlain } = await s.run(line);
    return [stdoutPlain, stderrPlain].filter((text) => text !== '').join('\n');
  };
  return { s, run };
}

describe('the home folder (F003)', () => {
  it('holds the dotfiles, so ls -a ~ lists .bashrc', async () => {
    const { s, run } = await piped();
    expect((await run('ls -a ~')).split('\n')).toEqual(expect.arrayContaining(['.bashrc', '.ssh', 'projects']));
    s.stop();
  });

  it("is /home/guest, beside the owner's home and the /home/user link to it", async () => {
    const { s, run } = await piped();
    expect(await run('ls /home')).toBe('guest\nhas\nuser');
    expect(await run('ls /home/user')).toBe(await run('ls ~'));
    s.stop();
  });

  it('opens its files by their home paths, and through /home/user', async () => {
    const { s, run } = await piped();
    expect(await run('cat ~/.bashrc')).toContain('alias ll="ls -la"');
    expect(await run('cat ~/.ssh/known_hosts')).toContain('github.com ssh-rsa');
    expect(await run('cat /home/user/.bashrc')).toContain('alias ll="ls -la"');
    await run('cd /home/user/documents');
    expect(s.app.shell.cwd.get()).toBe('/home/user/documents');
    expect(await run('ls')).toBe('linux.txt');
    s.stop();
  });
});

describe('the file commands over the VFS', () => {
  it('get Linux permissions: touch /etc/x and cat /etc/shadow are refused (F082)', async () => {
    const { s, run } = await piped();
    expect(await run('touch /etc/x')).toBe("touch: cannot touch '/etc/x': Permission denied");
    expect(await run('cat /etc/shadow')).toBe('cat: /etc/shadow: Permission denied');
    expect(await run('mkdir /root/x')).toBe("mkdir: cannot create directory '/root/x': Permission denied");
    expect(await run('ls /root')).toBe("ls: cannot open directory '/root': Permission denied");
    s.stop();
  });

  it('refuse to remove . .. and /, in GNU rm words (F020)', async () => {
    const { s, run } = await piped();
    expect(await run('rm -r .')).toBe("rm: refusing to remove '.' or '..' directory: skipping '.'");
    expect(await run('rm -r ..')).toBe("rm: refusing to remove '.' or '..' directory: skipping '..'");
    expect(await run('rm -r /')).toBe("rm: it is dangerous to operate recursively on '/'\nrm: use --no-preserve-root to override this failsafe");
    expect(s.app.vfs.exists('/home/guest/README.md')).toBe(true);
    s.stop();
  });

  it('read /proc, made on every read', async () => {
    const { s, run } = await piped();
    expect(await run('cat /proc/uptime')).toMatch(/^\d+\.\d\d \d+\.\d\d$/);
    expect(await run('cat /proc/meminfo')).toContain('MemTotal:');
    s.stop();
  });

  it('print the owner documents as plain text, with no markup in them (F093)', async () => {
    const { s, run } = await piped();
    const readme = await run('cat README.md');
    expect(readme).toContain('The Terminal');
    expect(readme).not.toMatch(/[{<]/);
    s.stop();
  });
});
