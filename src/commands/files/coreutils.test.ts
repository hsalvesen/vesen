import { describe, expect, it } from 'vitest';
import { runLine, session } from '../../../tests/harness';
import { prefixes } from './mkdir.run';

describe('mkdir', () => {
  it('makes every operand, silently (F019)', async () => {
    const s = await session();
    expect(await s.run('mkdir one two')).toMatchObject({ status: 0, stdoutPlain: '', stderrPlain: '' });
    expect(s.app.vfs.stat('/home/guest/two').type).toBe('directory');
    expect(s.app.vfs.stat('/home/guest/one').owner).toBe('guest');
    s.stop();
  });

  it('makes parents with -p, quietly when they are there, and says each with -v', async () => {
    const s = await session();
    expect(await s.run('mkdir -pv a/b/c')).toMatchObject({
      status: 0,
      stdoutPlain: "mkdir: created directory 'a'\nmkdir: created directory 'a/b'\nmkdir: created directory 'a/b/c'",
    });
    expect(await s.run('mkdir -p a/b && ls a')).toMatchObject({ status: 0, stdoutPlain: 'b' });
    expect(await s.run('mkdir -p documents')).toMatchObject({ status: 0, stderrPlain: '' });
    expect(await s.run('mkdir a')).toMatchObject({ status: 1, stderrPlain: "mkdir: cannot create directory 'a': File exists" });
    s.stop();
  });

  it('is no longer fooled into making a folder called -p (F019)', async () => {
    const s = await session();
    await s.run('mkdir -p x');
    expect(s.app.vfs.exists('/home/guest/-p')).toBe(false);
    s.stop();
  });

  it('sets the mode with -m, octal or symbolic, without the umask', async () => {
    const s = await session({ tty: false });
    expect((await s.run('mkdir -m 700 private; ls -ld private')).stdoutPlain).toMatch(/^drwx------ /);
    expect((await s.run('mkdir -m 777 open; ls -ld open')).stdoutPlain).toMatch(/^drwxrwxrwx /);
    expect((await s.run('mkdir -m u=rwx,go=rx mixed; ls -ld mixed')).stdoutPlain).toMatch(/^drwxr-xr-x /);
    expect(await s.run('mkdir -m nonsense x')).toMatchObject({ status: 1, stderrPlain: "mkdir: invalid mode 'nonsense'" });
    s.stop();
  });

  it("fails in GNU's words", async () => {
    expect(await runLine('mkdir')).toMatchObject({ status: 1, stderrPlain: "mkdir: missing operand\nTry 'mkdir --help' for more information." });
    expect(await runLine('mkdir /root/x /etc/y')).toMatchObject({
      status: 1,
      stderrPlain: "mkdir: cannot create directory '/root/x': Permission denied\nmkdir: cannot create directory '/etc/y': Permission denied",
    });
    expect(await runLine('mkdir nope/x')).toMatchObject({ status: 1, stderrPlain: "mkdir: cannot create directory 'nope/x': No such file or directory" });
    expect(await runLine('mkdir -p README.md/x')).toMatchObject({ status: 1, stderrPlain: "mkdir: cannot create directory 'README.md/x': Not a directory" });
  });

  it('walks the typed path to make parents', () => {
    expect(prefixes('a/b/c')).toEqual(['a', 'a/b', 'a/b/c']);
    expect(prefixes('/tmp/x/')).toEqual(['/tmp', '/tmp/x']);
    expect(prefixes('../up')).toEqual(['..', '../up']);
  });
});

describe('touch', () => {
  it('creates every operand, and updates times, folders included (F019)', async () => {
    const s = await session();
    expect(await s.run('touch a b documents')).toMatchObject({ status: 0, stdoutPlain: '', stderrPlain: '' });
    expect(s.app.vfs.readFile('/home/guest/a')).toBe('');
    const touched = s.app.vfs.stat('/home/guest/documents').mtime;
    expect(touched).toBeGreaterThan(Date.UTC(2026, 9, 6, 0, 0, 0));
    expect(await s.run('touch a')).toMatchObject({ status: 0, stdoutPlain: '' });
    expect(s.app.vfs.stat('/home/guest/a').mtime).toBeGreaterThan(touched);
    s.stop();
  });

  it('creates nothing with -c', async () => {
    const s = await session();
    expect(await s.run('touch -c ghost')).toMatchObject({ status: 0, stderrPlain: '' });
    expect(s.app.vfs.exists('/home/guest/ghost')).toBe(false);
    s.stop();
  });

  it("fails in GNU's words: cannot touch a new file, cannot set the times of another's", async () => {
    expect(await runLine('touch')).toMatchObject({ status: 1, stderrPlain: "touch: missing file operand\nTry 'touch --help' for more information." });
    expect(await runLine('touch /etc/x /etc/passwd')).toMatchObject({
      status: 1,
      stderrPlain: "touch: cannot touch '/etc/x': Permission denied\ntouch: setting times of '/etc/passwd': Permission denied",
    });
    expect(await runLine('touch nope/x')).toMatchObject({ status: 1, stderrPlain: "touch: cannot touch 'nope/x': No such file or directory" });
  });
});

describe('rm', () => {
  it('removes every operand, silently (F017, F019)', async () => {
    const s = await session();
    expect(await s.run('rm README.md history.txt')).toMatchObject({ status: 0, stdoutPlain: '', stderrPlain: '' });
    expect(s.app.vfs.exists('/home/guest/README.md')).toBe(false);
    expect(s.app.vfs.exists('/home/guest/history.txt')).toBe(false);
    s.stop();
  });

  it('removes folders and their contents with -r, -R or -rf ~/projects', async () => {
    const s = await session();
    expect(await s.run('rm -rf ~/projects')).toMatchObject({ status: 0, stdoutPlain: '', stderrPlain: '' });
    expect(s.app.vfs.exists('/home/guest/projects')).toBe(false);
    expect(await s.run('rm -R downloads')).toMatchObject({ status: 0 });
    expect(await s.run('rm music -r')).toMatchObject({ status: 0 });
    expect(s.app.vfs.exists('/home/guest/music')).toBe(false);
    s.stop();
  });

  it('names each removal with -v, depth first', async () => {
    expect((await runLine('rm -rv documents')).stdoutPlain).toBe("removed 'documents/linux.txt'\nremoved directory 'documents'");
  });

  it('is quiet about missing files with -f, and with no operands', async () => {
    expect(await runLine('rm -f nope')).toMatchObject({ status: 0, stderrPlain: '' });
    expect(await runLine('rm -f')).toMatchObject({ status: 0, stderrPlain: '' });
    expect(await runLine('rm nope')).toMatchObject({ status: 1, stderrPlain: "rm: cannot remove 'nope': No such file or directory" });
    expect(await runLine('rm')).toMatchObject({ status: 1, stderrPlain: "rm: missing operand\nTry 'rm --help' for more information." });
  });

  it('needs -r or -d for a folder, and -d only for an empty one', async () => {
    expect(await runLine('rm documents')).toMatchObject({ status: 1, stderrPlain: "rm: cannot remove 'documents': Is a directory" });
    expect(await runLine('rm -d documents')).toMatchObject({ status: 1, stderrPlain: "rm: cannot remove 'documents': Directory not empty" });
    expect(await runLine('rm -dv .local/share/applications')).toMatchObject({ status: 0, stdoutPlain: "removed directory '.local/share/applications'" });
  });

  it("refuses . .. and / in GNU rm's words, touching nothing (F020)", async () => {
    const s = await session();
    expect(await s.run('rm -r .')).toMatchObject({ status: 1, stderrPlain: "rm: refusing to remove '.' or '..' directory: skipping '.'" });
    expect(await s.run('rm -rf ..')).toMatchObject({ status: 1, stderrPlain: "rm: refusing to remove '.' or '..' directory: skipping '..'" });
    expect(await s.run('rm -r documents/..')).toMatchObject({ status: 1, stderrPlain: "rm: refusing to remove '.' or '..' directory: skipping 'documents/..'" });
    expect(await s.run('rm -r /')).toMatchObject({
      status: 1,
      stderrPlain: "rm: it is dangerous to operate recursively on '/'\nrm: use --no-preserve-root to override this failsafe",
    });
    expect(await s.run('rm .')).toMatchObject({ status: 1, stderrPlain: "rm: cannot remove '.': Is a directory" });
    expect(s.app.vfs.exists('/home/guest/README.md')).toBe(true);
    s.stop();
  });

  it('cannot remove what is not the visitor\'s', async () => {
    expect(await runLine('rm /etc/passwd')).toMatchObject({ status: 1, stderrPlain: "rm: cannot remove '/etc/passwd': Permission denied" });
    const home = await runLine('rm -rf /home/has');
    expect(home.status).toBe(1);
    expect(home.stderrPlain).toContain("rm: cannot remove '/home/has/about.md': Permission denied");
  });

  it('asks with -i, through the terminal, and keeps the file unless the answer is yes', async () => {
    const no = await session({ answer: () => 'n' });
    expect(await no.run('rm -i README.md')).toMatchObject({ status: 0, prompts: ["rm: remove regular file 'README.md'? "] });
    expect(no.app.vfs.exists('/home/guest/README.md')).toBe(true);
    no.stop();
    const yes = await session({ answer: () => 'y' });
    const result = await yes.run('rm -ri documents');
    expect(result.prompts).toEqual(["rm: descend into directory 'documents'? ", "rm: remove regular file 'documents/linux.txt'? ", "rm: remove directory 'documents'? "]);
    expect(yes.app.vfs.exists('/home/guest/documents')).toBe(false);
    yes.stop();
    // No terminal answer (^D) is no; -f never asks.
    expect((await runLine('rm -i README.md')).prompts).toHaveLength(1);
    expect((await runLine('rm -if README.md')).prompts).toEqual([]);
  });
});

describe('rmdir', () => {
  it('removes empty folders silently, and -p their empty parents', async () => {
    const s = await session();
    expect(await s.run('mkdir empty && rmdir empty')).toMatchObject({ status: 0, stdoutPlain: '', stderrPlain: '' });
    expect(await s.run('rmdir -pv .local/share/applications')).toMatchObject({
      status: 0,
      stdoutPlain: "rmdir: removing directory, '.local/share/applications'\nrmdir: removing directory, '.local/share'\nrmdir: removing directory, '.local'",
    });
    expect(s.app.vfs.exists('/home/guest/.local')).toBe(false);
    s.stop();
  });

  it("fails in GNU's words", async () => {
    expect(await runLine('rmdir videos')).toMatchObject({ status: 1, stderrPlain: "rmdir: failed to remove 'videos': Directory not empty" });
    expect(await runLine('rmdir README.md')).toMatchObject({ status: 1, stderrPlain: "rmdir: failed to remove 'README.md': Not a directory" });
    expect(await runLine('rmdir nope')).toMatchObject({ status: 1, stderrPlain: "rmdir: failed to remove 'nope': No such file or directory" });
    expect(await runLine('rmdir .')).toMatchObject({ status: 1, stderrPlain: "rmdir: failed to remove '.': Invalid argument" });
    expect(await runLine('rmdir /etc')).toMatchObject({ status: 1, stderrPlain: "rmdir: failed to remove '/etc': Directory not empty" });
    expect(await runLine('rmdir --ignore-fail-on-non-empty videos')).toMatchObject({ status: 0, stderrPlain: '' });
    expect(await runLine('rmdir')).toMatchObject({ status: 1 });
  });
});

describe('cp', () => {
  it('copies a file, silently, keeping the styled document styled', async () => {
    const s = await session();
    expect(await s.run('cp README.md copy.md')).toMatchObject({ status: 0, stdoutPlain: '', stderrPlain: '' });
    expect(s.app.vfs.readFile('/home/guest/copy.md')).toBe(s.app.vfs.readFile('/home/guest/README.md'));
    expect(s.app.vfs.stat('/home/guest/copy.md').owner).toBe('guest');
    s.stop();
  });

  it('copies into a folder, folders with -r, and says each with -v', async () => {
    const s = await session();
    expect((await s.run('cp -v history.txt .bashrc documents/')).stdoutPlain).toBe("'history.txt' -> 'documents/history.txt'\n'.bashrc' -> 'documents/.bashrc'");
    expect((await s.run('cp -rv projects/vesen backup')).stdoutPlain).toBe("'projects/vesen' -> 'backup'\n'projects/vesen/info.txt' -> 'backup/info.txt'");
    // Into a folder that is there, the copy goes inside it.
    await s.run('cp -r projects/vesen backup');
    expect(s.app.vfs.readdir('/home/guest/backup').sort()).toEqual(['info.txt', 'vesen']);
    s.stop();
  });

  it('keeps what is there with -n', async () => {
    const s = await session();
    await s.run('echo mine > keep.txt');
    await s.run('cp -n README.md keep.txt');
    expect(s.app.vfs.readFile('/home/guest/keep.txt')).toBe('mine\n');
    await s.run('cp README.md keep.txt');
    expect(s.app.vfs.readFile('/home/guest/keep.txt')).toContain('The Terminal');
    s.stop();
  });

  it("fails in GNU's words", async () => {
    expect(await runLine('cp')).toMatchObject({ status: 1, stderrPlain: "cp: missing file operand\nTry 'cp --help' for more information." });
    expect(await runLine('cp a')).toMatchObject({ status: 1, stderrPlain: "cp: missing destination file operand after 'a'\nTry 'cp --help' for more information." });
    expect(await runLine('cp nope x')).toMatchObject({ status: 1, stderrPlain: "cp: cannot stat 'nope': No such file or directory" });
    expect(await runLine('cp documents d2')).toMatchObject({ status: 1, stderrPlain: "cp: -r not specified; omitting directory 'documents'" });
    expect(await runLine('cp -r documents documents/inner')).toMatchObject({
      status: 1,
      stderrPlain: "cp: cannot copy a directory, 'documents', into itself, 'documents/inner'",
    });
    expect(await runLine('cp README.md README.md')).toMatchObject({ status: 1, stderrPlain: "cp: 'README.md' and 'README.md' are the same file" });
    expect(await runLine('cp a b nope')).toMatchObject({ status: 1, stderrPlain: "cp: target 'nope' is not a directory" });
    expect(await runLine('cp /etc/shadow x')).toMatchObject({ status: 1, stderrPlain: "cp: cannot open '/etc/shadow' for reading: Permission denied" });
    expect(await runLine('cp README.md /etc/x')).toMatchObject({ status: 1, stderrPlain: "cp: cannot create regular file '/etc/x': Permission denied" });
  });
});

describe('mv', () => {
  it('renames, moves into a folder, and says so with -v', async () => {
    const s = await session();
    expect(await s.run('mv README.md readme.md')).toMatchObject({ status: 0, stdoutPlain: '', stderrPlain: '' });
    expect(s.app.vfs.exists('/home/guest/README.md')).toBe(false);
    expect((await s.run('mv -v readme.md history.txt documents')).stdoutPlain).toBe(
      "renamed 'readme.md' -> 'documents/readme.md'\nrenamed 'history.txt' -> 'documents/history.txt'",
    );
    expect(s.app.vfs.readdir('/home/guest/documents').sort()).toEqual(['history.txt', 'linux.txt', 'readme.md']);
    s.stop();
  });

  it('keeps what is there with -n', async () => {
    const s = await session();
    await s.run('mv -n README.md history.txt');
    expect(s.app.vfs.exists('/home/guest/README.md')).toBe(true);
    s.stop();
  });

  it("fails in GNU's words", async () => {
    expect(await runLine('mv')).toMatchObject({ status: 1, stderrPlain: "mv: missing file operand\nTry 'mv --help' for more information." });
    expect(await runLine('mv nope x')).toMatchObject({ status: 1, stderrPlain: "mv: cannot stat 'nope': No such file or directory" });
    expect(await runLine('mv projects projects/sub')).toMatchObject({
      status: 1,
      stderrPlain: "mv: cannot move 'projects' to a subdirectory of itself, 'projects/sub'",
    });
    expect(await runLine('mv README.md README.md')).toMatchObject({ status: 1, stderrPlain: "mv: 'README.md' and 'README.md' are the same file" });
    expect(await runLine('mv README.md /etc/')).toMatchObject({ status: 1, stderrPlain: "mv: cannot move 'README.md' to '/etc/README.md': Permission denied" });
    expect(await runLine('mkdir -p d/documents/x && mv documents d')).toMatchObject({
      status: 1,
      stderrPlain: "mv: cannot move 'documents' to 'd/documents': Directory not empty",
    });
  });
});

describe('ln', () => {
  it('makes symbolic links, silently, which open their target', async () => {
    const s = await session({ tty: false });
    expect(await s.run('ln -s documents/linux.txt linux')).toMatchObject({ status: 0, stdoutPlain: '', stderrPlain: '' });
    expect((await s.run('head -n 1 < linux')).stdoutPlain).toBe('Arch Linux Beginner Notes');
    expect((await s.run('ls -l linux')).stdoutPlain).toMatch(/ linux -> documents\/linux\.txt$/);
    expect((await s.run('ln -sv /etc/hostname')).stdoutPlain).toBe("'hostname' -> '/etc/hostname'");
    expect((await s.run('ln -s ../README.md .bashrc documents')).status).toBe(0);
    expect((await s.run('cat documents/README.md | head -n 1')).status).toBe(0);
    s.stop();
  });

  it('replaces a link with -f, and refuses without it', async () => {
    const s = await session({ tty: false });
    await s.run('ln -s .bashrc rc');
    expect(await s.run('ln -s .profile rc')).toMatchObject({ status: 1, stderrPlain: "ln: failed to create symbolic link 'rc': File exists" });
    expect(await s.run('ln -sfv .profile rc')).toMatchObject({ status: 0, stdoutPlain: "'rc' -> '.profile'" });
    expect(s.app.vfs.readlink('/home/guest/rc')).toBe('.profile');
    s.stop();
  });

  it('says there are no hard links, in Linux words', async () => {
    expect(await runLine('ln README.md hard', { tty: false })).toMatchObject({
      status: 1,
      stderrPlain: "ln: failed to create hard link 'hard' => 'README.md': Operation not permitted",
    });
  });

  it("fails in GNU's words", async () => {
    expect(await runLine('ln -s')).toMatchObject({ status: 1 });
    expect(await runLine('ln -s y /etc/z')).toMatchObject({ status: 1, stderrPlain: "ln: failed to create symbolic link '/etc/z': Permission denied" });
    expect(await runLine('ln -s a b c')).toMatchObject({ status: 1, stderrPlain: "ln: target 'c' is not a directory" });
  });
});

describe('stat', () => {
  it("prints GNU stat's layout, in the visitor's time zone", async () => {
    const result = await runLine('stat .bashrc');
    const lines = result.stdoutPlain.split('\n');
    expect(lines[0]).toBe('  File: .bashrc');
    expect(lines[1]).toBe('  Size: 236       \tBlocks: 8          IO Block: 4096   regular file');
    expect(lines[2]).toMatch(/^Device: 8,1\tInode: \d{7} {5}Links: 1$/);
    expect(lines[3]).toBe('Access: (0644/-rw-r--r--)  Uid: ( 1000/   guest)   Gid: ( 1000/   guest)');
    expect(lines.slice(4)).toEqual([
      'Access: 2026-10-06 11:00:00.000000000 +1100',
      'Modify: 2026-10-06 11:00:00.000000000 +1100',
      'Change: 2026-10-06 11:00:00.000000000 +1100',
      ' Birth: -',
    ]);
    // The same file has the same inode each time.
    expect((await runLine('stat .bashrc')).stdoutPlain).toBe(result.stdoutPlain);
  });

  it('describes a link itself, and what it points to with -L', async () => {
    expect((await runLine('stat /home/user')).stdoutPlain.split('\n').slice(0, 2)).toEqual([
      '  File: /home/user -> guest',
      '  Size: 5         \tBlocks: 0          IO Block: 4096   symbolic link',
    ]);
    expect((await runLine('stat -L /home/user')).stdoutPlain).toContain('directory');
    expect((await runLine('stat /dev/null')).stdoutPlain).toContain('Links: 1     Device type: 1,3');
  });

  it('prints what -c and --printf ask for', async () => {
    expect((await runLine("stat -c '%A %a %U:%G %s %F %n' .bashrc /etc")).stdoutPlain).toBe(
      '-rw-r--r-- 644 guest:guest 236 regular file .bashrc\ndrwxr-xr-x 755 root:root 4096 directory /etc',
    );
    expect((await runLine("stat --printf '%n\\t%s\\n' .bashrc")).stdoutPlain).toBe('.bashrc\t236');
    expect((await runLine("stat -c '%-8U|%5s|%N|%Y|%q' /home/user")).stdoutPlain).toBe(`root    |    5|'/home/user' -> 'guest'|${Date.UTC(2026, 9, 6) / 1000}|?`);
  });

  it("fails in GNU's words", async () => {
    expect(await runLine('stat nope')).toMatchObject({ status: 1, stderrPlain: "stat: cannot statx 'nope': No such file or directory" });
    expect(await runLine('stat')).toMatchObject({ status: 1, stderrPlain: "stat: missing operand\nTry 'stat --help' for more information." });
  });
});
