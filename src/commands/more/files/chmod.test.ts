// chmod: GNU's modes, its words and its statuses, on the VFS's permissions.
import { describe, expect, it } from 'vitest';
import { runLine, session } from '../../../../tests/harness';

const mode = (s: Awaited<ReturnType<typeof session>>, path: string): string => s.app.vfs.stat(path).mode.toString(8);

describe('chmod', () => {
  it('sets octal and symbolic modes, silently', async () => {
    const s = await session();
    expect(await s.run('chmod 600 README.md')).toMatchObject({ status: 0, stdoutPlain: '', stderrPlain: '' });
    expect(mode(s, '/home/guest/README.md')).toBe('600');
    await s.run('chmod u+x,go+r README.md');
    expect(mode(s, '/home/guest/README.md')).toBe('744');
    await s.run('chmod a=rX documents');
    expect(mode(s, '/home/guest/documents')).toBe('555');
    await s.run('chmod 1777 public');
    expect((await s.run('ls -ld public')).stdoutPlain).toMatch(/^drwxrwxrwt /);
    s.stop();
  });

  it('takes a mode that looks like an option, and says when the umask held part of it back', async () => {
    const s = await session({ tty: false });
    expect(await s.run('chmod -w README.md')).toMatchObject({ status: 0, stderrPlain: '' });
    expect(mode(s, '/home/guest/README.md')).toBe('444');
    await s.run('chmod 666 history.txt');
    expect(await s.run('chmod -w history.txt')).toMatchObject({ status: 1, stderrPlain: 'chmod: history.txt: new permissions are r--rw-rw-, not r--r--r--' });
    expect(mode(s, '/home/guest/history.txt')).toBe('466');
    // Spelled out, the umask has no say.
    expect(await s.run('chmod a-w history.txt')).toMatchObject({ status: 0, stderrPlain: '' });
    expect(await s.run('chmod -- -x bin/deploy')).toMatchObject({ status: 0 });
    expect(mode(s, '/home/guest/bin/deploy')).toBe('644');
    s.stop();
  });

  it('says what it did with -v, and only what it changed with -c', async () => {
    const s = await session({ tty: false });
    expect((await s.run('chmod -v 755 bin/deploy README.md')).stdoutPlain).toBe(
      "mode of 'bin/deploy' retained as 0755 (rwxr-xr-x)\nmode of 'README.md' changed from 0644 (rw-r--r--) to 0755 (rwxr-xr-x)",
    );
    expect((await s.run('chmod -c 644 bin/deploy README.md .bashrc')).stdoutPlain).toBe(
      "mode of 'bin/deploy' changed from 0755 (rwxr-xr-x) to 0644 (rw-r--r--)\nmode of 'README.md' changed from 0755 (rwxr-xr-x) to 0644 (rw-r--r--)",
    );
    s.stop();
  });

  it('changes a folder and everything in it with -R, leaving links inside alone', async () => {
    const s = await session({ tty: false });
    await s.run('ln -s ../README.md projects/readme');
    const result = await s.run('chmod -Rv go-rwx projects');
    expect(result.status).toBe(0);
    expect(result.stdoutPlain.split('\n')).toEqual([
      "mode of 'projects' changed from 0755 (rwxr-xr-x) to 0700 (rwx------)",
      "mode of 'projects/vesen' changed from 0755 (rwxr-xr-x) to 0700 (rwx------)",
      "mode of 'projects/vesen/info.txt' changed from 0644 (rw-r--r--) to 0600 (rw-------)",
      "mode of 'projects/portfolio' changed from 0755 (rwxr-xr-x) to 0700 (rwx------)",
      "mode of 'projects/portfolio/index.html' changed from 0644 (rw-r--r--) to 0600 (rw-------)",
      "mode of 'projects/learning' changed from 0755 (rwxr-xr-x) to 0700 (rwx------)",
      "mode of 'projects/learning/javascript-basics.js' changed from 0644 (rw-r--r--) to 0600 (rw-------)",
      "neither symbolic link 'projects/readme' nor referent has been changed",
    ]);
    expect(mode(s, '/home/guest/README.md')).toBe('644');
    s.stop();
  });

  it('follows a link named on the line, and refuses one that leads nowhere', async () => {
    const s = await session({ tty: false });
    await s.run('ln -s README.md readme; ln -s nope dangling');
    expect(await s.run('chmod 600 readme')).toMatchObject({ status: 0 });
    expect(mode(s, '/home/guest/README.md')).toBe('600');
    expect(await s.run('chmod 600 dangling')).toMatchObject({ status: 1, stderrPlain: "chmod: cannot operate on dangling symlink 'dangling'" });
    s.stop();
  });

  it("refuses files that are not the visitor's: Operation not permitted", async () => {
    expect(await runLine('chmod 777 /etc/passwd', { tty: false })).toMatchObject({
      status: 1,
      stderrPlain: "chmod: changing permissions of '/etc/passwd': Operation not permitted",
    });
    expect(await runLine('chmod 644 /home/has/about.md README.md', { tty: false })).toMatchObject({
      status: 1,
      stderrPlain: "chmod: changing permissions of '/home/has/about.md': Operation not permitted",
    });
    const verbose = await runLine('chmod -v 600 /etc/hostname', { tty: false });
    expect(verbose.screen).toEqual([
      "! chmod: changing permissions of '/etc/hostname': Operation not permitted",
      "failed to change mode of '/etc/hostname' from 0644 (rw-r--r--) to 0600 (rw-------)",
    ]);
    // -f keeps quiet about it, but the status still says.
    expect(await runLine('chmod -f 777 /etc/passwd nope', { tty: false })).toMatchObject({ status: 1, stderrPlain: '' });
  });

  it('says when a folder cannot be read under -R, and carries on', async () => {
    const s = await session({ tty: false });
    await s.run('mkdir -p locked/inner');
    s.app.vfs.chmod('/home/guest/locked', 0o300);
    const result = await s.run('chmod -R 700 locked README.md');
    // Pre-order, as GNU chmod: the folder itself changes first, to 700, so it can then be read.
    expect(result).toMatchObject({ status: 0, stderrPlain: '' });
    s.app.vfs.chmod('/home/guest/locked', 0o755);
    expect(await s.run('chmod -R a-r locked')).toMatchObject({ status: 1, stderrPlain: "chmod: cannot read directory 'locked': Permission denied" });
    s.stop();
  });

  it('uses --reference for the mode', async () => {
    const s = await session({ tty: false });
    expect(await s.run('chmod --reference=bin/deploy README.md')).toMatchObject({ status: 0 });
    expect(mode(s, '/home/guest/README.md')).toBe('755');
    expect(await s.run('chmod --reference=nope README.md')).toMatchObject({ status: 1, stderrPlain: "chmod: failed to get attributes of 'nope': No such file or directory" });
    s.stop();
  });

  it.each([
    ['chmod', "chmod: missing operand\nTry 'chmod --help' for more information."],
    ['chmod 755', "chmod: missing operand after '755'\nTry 'chmod --help' for more information."],
    ['chmod u+q README.md', "chmod: invalid mode: 'u+q'\nTry 'chmod --help' for more information."],
    ['chmod -z README.md', "chmod: invalid option -- 'z'\nTry 'chmod --help' for more information."],
    ['chmod --nope 755 README.md', "chmod: unrecognized option '--nope'\nTry 'chmod --help' for more information."],
    ['chmod 755 nope', "chmod: cannot access 'nope': No such file or directory"],
  ])('%s fails in GNU’s words with status 1', async (line, stderr) => {
    expect(await runLine(line, { tty: false })).toMatchObject({ status: 1, stderrPlain: stderr });
  });

  it('answers --help from its spec and the doc in its body', async () => {
    const help = await runLine('chmod --help');
    expect(help.status).toBe(0);
    expect(help.stdoutPlain).toContain('chmod - change file mode bits');
    expect(help.stdoutPlain.replace(/\s+/g, ' ')).toContain('Changes the permissions of each FILE to MODE');
  });

  it('makes a script runnable, end to end', async () => {
    const s = await session({ tty: false });
    await s.run("printf '#!/bin/vesh\\necho ran\\n' > hello.sh");
    expect((await s.run('./hello.sh')).status).toBe(126);
    await s.run('chmod +x hello.sh');
    expect(await s.run('./hello.sh')).toMatchObject({ status: 0, stdoutPlain: 'ran' });
    s.stop();
  });
});
