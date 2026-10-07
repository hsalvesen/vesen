// find: its tests, operators and actions, -exec through the shell and -delete, unreadable
// folders, and its mistakes, in GNU find's words.
import { describe, expect, it } from 'vitest';
import { runLine, session } from '../../../../tests/harness';

const lines = async (line: string): Promise<string[]> => (await runLine(line, { tty: false })).stdoutPlain.split('\n').filter((row) => row !== '');

describe('find', () => {
  it('prints every path below the starting point, from it, with no expression', async () => {
    expect(await lines('find projects')).toEqual([
      'projects',
      'projects/vesen',
      'projects/vesen/info.txt',
      'projects/portfolio',
      'projects/portfolio/index.html',
      'projects/learning',
      'projects/learning/javascript-basics.js',
    ]);
    const here = await runLine('find', { tty: false });
    expect(here.status).toBe(0);
    expect(here.stdoutPlain.split('\n')).toContain('./.ssh/known_hosts');
    expect((await lines('find projects/')).slice(0, 2)).toEqual(['projects/', 'projects/vesen']);
  });

  it('matches names, case-folded names and whole paths with shell patterns', async () => {
    expect(await lines("find . -name '*.txt'")).toEqual([
      './history.txt',
      './documents/linux.txt',
      './projects/vesen/info.txt',
      './desktop/shortcuts.txt',
      './downloads/README-download.txt',
      './public/shared-file.txt',
      './templates/document-template.txt',
    ]);
    expect(await lines("find . -iname 'readme*'")).toEqual(['./README.md', './downloads/README-download.txt']);
    expect(await lines("find . -path '*/vesen/*'")).toEqual(['./projects/vesen/info.txt']);
    expect(await lines("find . -name '.*' -maxdepth 1")).toContain('./.bashrc');
  });

  it('tests types, sizes, emptiness, owners, modes and times', async () => {
    expect(await lines('find /dev -type c')).toEqual(['/dev/null', '/dev/zero', '/dev/random', '/dev/urandom', '/dev/tty']);
    expect(await lines('find / -maxdepth 1 -type l')).toEqual(['/bin']);
    expect(await lines('find ~/bin ~/src -type f,d')).toEqual(['/home/guest/bin', '/home/guest/bin/my-script', '/home/guest/bin/deploy', '/home/guest/src', '/home/guest/src/main.c']);
    expect(await lines('find ~ -type f -size +1k')).toEqual(['/home/guest/history.txt', '/home/guest/documents/linux.txt']);
    expect(await lines('find . -size -1')).toEqual(['./.bash_history']);
    expect(await lines('find README.md -size 850c')).toEqual(['README.md']);
    expect(await lines('find . -empty')).toEqual(['./.local/share/applications', './.bash_history']);
    expect(await lines("find /etc -user root -name 'sh*'")).toEqual(['/etc/shadow', '/etc/shells']);
    expect(await lines('find /etc -group shadow')).toEqual(['/etc/shadow']);
    expect(await lines('find /etc -perm 640')).toEqual(['/etc/shadow']);
    expect(await lines('find ~/scripts -perm -u+x -type f')).toEqual(['/home/guest/scripts/backup.sh', '/home/guest/scripts/setup.py']);
    expect(await lines('find /tmp -perm /o+t')).toEqual(['/tmp']);
    expect(await lines('find ~/.ssh -perm -o+r')).toEqual(['/home/guest/.ssh/known_hosts']);
    expect(await lines('find /root -maxdepth 0 -readable')).toEqual([]);
    expect(await lines('find ~/bin -executable -type f')).toEqual(['/home/guest/bin/my-script', '/home/guest/bin/deploy']);
    expect(await lines('find src -mtime 0 -mmin +60')).toEqual(['src', 'src/main.c']);
    expect(await lines('find src -mtime +0')).toEqual([]);
  });

  it('compares times with -newer, and limits depth with -mindepth and -maxdepth', async () => {
    const s = await session({ tty: false });
    await s.run('touch fresh.txt');
    expect((await s.run('find . -newer README.md')).stdoutPlain).toBe('.\n./fresh.txt');
    expect((await s.run('find projects -mindepth 2 -maxdepth 2')).stdoutPlain).toBe(
      'projects/vesen/info.txt\nprojects/portfolio/index.html\nprojects/learning/javascript-basics.js',
    );
    expect((await s.run('find . -mmin -5 -type f')).stdoutPlain).toBe('./fresh.txt');
    s.stop();
  });

  it('combines tests with -a, -o, ! and parentheses, and stops at -prune and -quit', async () => {
    expect(await lines("find . -name '*.c' -o -name '*.js'")).toEqual(['./projects/learning/javascript-basics.js', './src/main.c']);
    expect(await lines("find src scripts -type f ! -name '*.c'")).toEqual(['scripts/backup.sh', 'scripts/setup.py']);
    expect(await lines("find src scripts -not -type d -a -not -name '*.sh'")).toEqual(['src/main.c', 'scripts/setup.py']);
    expect(await lines("find . \\( -name '*.md' -o -name '*.m3u' \\) -type f")).toEqual(['./README.md', './music/playlist.m3u']);
    expect(await lines("find . -name .ssh -prune -o -name 'c*' -print")).toEqual(['./config']);
    expect(await lines("find . -name 'c*'")).toEqual(['./config', './.ssh/config']);
    expect(await lines("find . -name '*.txt' -print -quit")).toEqual(['./history.txt']);
    expect(await lines("find . -name '*.txt' -quit")).toEqual([]);
    expect(await lines('find . -false -o -name main.c , -name README.md')).toEqual(['./README.md']);
  });

  it('runs -exec through the shell, once per file with ; and once for all with +', async () => {
    expect(await runLine("find . -name '*.c' -exec echo found: {} \\;", { tty: false })).toMatchObject({ status: 0, stdoutPlain: 'found: ./src/main.c' });
    expect((await runLine("find scripts -type f -exec echo {} ';'", { tty: false })).stdoutPlain).toBe('scripts/backup.sh\nscripts/setup.py');
    expect((await runLine('find scripts -type f -exec echo files: {} +', { tty: false })).stdoutPlain).toBe('files: scripts/backup.sh scripts/setup.py');
    expect((await runLine("find src -name '*.c' -exec cat {} \\;", { tty: false })).stdoutPlain).toContain('printf("Hello, World!\\n");');
    // {} inside a word, quoted as it is, so a name with a space or a quote reaches the command whole.
    const s = await session({ tty: false });
    await s.run("mkdir odd; touch \"odd/it's here\"");
    expect((await s.run('find odd -type f -exec echo [{}] \\;')).stdoutPlain).toBe("[odd/it's here]");
    // -exec is true when the command exits 0, so it can be a test.
    expect((await s.run("find . -maxdepth 1 -type f -exec test -s {} \\; -print")).stdoutPlain.split('\n')).toEqual(['./README.md', './history.txt', './.bashrc', './.profile', './.vimrc', './.gitconfig']);
    s.stop();
  });

  it('removes what -exec rm finds, and reports a + command that fails', async () => {
    const s = await session({ tty: false });
    expect(await s.run("find . -name '*.txt' -exec rm {} \\;")).toMatchObject({ status: 0, stderrPlain: '' });
    expect((await s.run("find . -name '*.txt'")).stdoutPlain).toBe('');
    expect(await s.run('find src -type f -exec false {} +')).toMatchObject({ status: 1 });
    expect(await s.run('find src -type f -exec nope {} +')).toMatchObject({ status: 1, stderrPlain: "find: 'nope': No such file or directory" });
    expect(await s.run('find src -type f -exec ./nope {} \\;')).toMatchObject({ status: 1, stderrPlain: "find: './nope': No such file or directory" });
    s.stop();
  });

  it('runs each command on its own, so cd and export there leave the shell as it was', async () => {
    const s = await session({ tty: false });
    expect(await s.run('find /tmp -maxdepth 0 -exec cd {} \\; -print')).toMatchObject({ status: 0, stdoutPlain: '/tmp' });
    expect((await s.run('pwd')).stdoutPlain).toBe('/home/guest');
    await s.run('find . -maxdepth 0 -exec export FOUND=yes \\;');
    expect((await s.run('echo "[$FOUND]"')).stdoutPlain).toBe('[]');
    // A program of the visitor's own runs too.
    await s.run("printf '#!/bin/vesh\\necho script got $1\\n' > show.sh; chmod +x show.sh");
    expect((await s.run('find src -type f -exec ./show.sh {} \\;')).stdoutPlain).toBe('script got src/main.c');
    s.stop();
  });

  it('asks before each command with -ok', async () => {
    const answers = ['y', 'n'];
    const s = await session({ tty: false, answer: () => answers.shift() ?? null });
    const result = await s.run('find scripts -type f -ok echo yes: {} \\;');
    expect(result.prompts).toEqual(['< echo ... scripts/backup.sh > ? ', '< echo ... scripts/setup.py > ? ']);
    expect(result.stdoutPlain).toBe('yes: scripts/backup.sh');
    s.stop();
  });

  it('deletes with -delete, the contents before the folder, but never .', async () => {
    const s = await session({ tty: false });
    await s.run('mkdir -p x/y; touch x/y/z x/a');
    expect(await s.run('find x -delete')).toMatchObject({ status: 0, stdoutPlain: '', stderrPlain: '' });
    expect(s.app.vfs.exists('/home/guest/x')).toBe(false);
    expect(await s.run('find downloads -type f -delete')).toMatchObject({ status: 0 });
    expect(s.app.vfs.readdir('/home/guest/downloads')).toEqual([]);
    await s.run('mkdir -p e/f; cd e');
    expect(await s.run('find . -delete')).toMatchObject({ status: 0, stderrPlain: '' });
    expect(s.app.vfs.exists('/home/guest/e')).toBe(true);
    expect(s.app.vfs.readdir('/home/guest/e')).toEqual([]);
    await s.run('cd ~');
    // A folder with something left in it, and a file that is not the visitor's.
    expect(await s.run('find documents -name documents -delete')).toMatchObject({ status: 1, stderrPlain: "find: cannot delete 'documents': Directory not empty" });
    expect(await s.run('find /etc -name hostname -delete')).toMatchObject({ status: 1, stderrPlain: "find: cannot delete '/etc/hostname': Permission denied" });
    s.stop();
  });

  it('prints with -print0 and -ls', async () => {
    expect((await runLine('find src -print0', { tty: false })).stdoutPlain).toBe('src\0src/main.c\0');
    const listed = await lines('find src/main.c /bin -ls');
    expect(listed[0]).toMatch(/^ +\d+ +4 -rw-r--r-- +1 guest +guest +\d+ Oct  6 11:00 src\/main\.c$/);
    expect(listed[1]).toMatch(/^ +\d+ +0 lrwxrwxrwx +1 root +root +7 Oct  6 11:00 \/bin -> usr\/bin$/);
  });

  it('follows links only with -L, or -H for the starting points', async () => {
    expect(await lines('find /bin')).toEqual(['/bin']);
    expect(await lines('find -H /bin -maxdepth 1 -name ls')).toEqual(['/bin/ls']);
    expect(await lines('find -L /home -maxdepth 1 -type d')).toEqual(['/home', '/home/guest', '/home/has', '/home/user']);
    const s = await session({ tty: false });
    await s.run('mkdir loop; ln -s . loop/self');
    const result = await s.run('find -L loop');
    expect(result.status).toBe(1);
    expect(result.stdoutPlain).toBe('loop\nloop/self');
    expect(result.stderrPlain).toBe("find: File system loop detected; 'loop/self' is part of the same file system loop as 'loop'.");
    s.stop();
  });

  it('says which starting points and folders it could not read, carries on, and exits 1', async () => {
    const result = await runLine('find nope /root /home/has', { tty: false });
    expect(result.status).toBe(1);
    expect(result.screen).toEqual([
      "! find: 'nope': No such file or directory",
      '/root',
      "! find: '/root': Permission denied",
      '/home/has',
      '/home/has/about.md',
      '/home/has/projects.md',
      '/home/has/.plan',
    ]);
  });

  it('warns about a global option after a test, as GNU find does', async () => {
    const result = await runLine("find . -name 'x' -maxdepth 1", { tty: false });
    expect(result.status).toBe(0);
    expect(result.stderrPlain).toBe(
      'find: warning: you have specified the global option -maxdepth after the argument -name, but global options are not positional, i.e., -maxdepth affects tests specified before it as well as those specified after it.  Please specify global options before other arguments.',
    );
  });

  it.each([
    ['find . -name', "find: missing argument to `-name'"],
    ['find . -foo', "find: unknown predicate `-foo'"],
    ['find . -regex x', "find: unknown predicate `-regex'"],
    ['find . -type q', 'find: Unknown argument to -type: q'],
    ['find . -size 3q', "find: invalid -size type `q'"],
    ['find . -mtime x', "find: invalid argument `x' to `-mtime'"],
    ['find . -maxdepth x', "find: Expected a positive decimal integer argument to -maxdepth, but got 'x'"],
    ['find . -user bob', "find: 'bob' is not the name of a known user"],
    ['find . -group bob', "find: 'bob' is not the name of an existing group"],
    ['find . -perm xyz', "find: invalid mode 'xyz'"],
    ['find . -newer nope', "find: 'nope': No such file or directory"],
    ['find . -name a b', "find: paths must precede expression: `b'\nfind: possible unquoted pattern after predicate `-name'?"],
    ['find . -type f b', "find: paths must precede expression: `b'"],
    ['find . \\( -name a', "find: invalid expression; I was expecting to find a ')' somewhere but did not see one."],
    ['find . \\( \\)', 'find: invalid expression; empty parentheses are not allowed.'],
    ['find . \\)', "find: invalid expression; you have too many ')'"],
    ['find . -o', "find: invalid expression; you have used a binary operator '-o' with nothing before it."],
    ['find . -name x -o', "find: invalid expression; you have used a binary operator '-o' with nothing after it."],
    ['find . !', "find: expected an expression after '!'"],
    ['find . -exec echo {}', "find: missing argument to `-exec'"],
    ['find . -exec {} +', "find: missing argument to `-exec'"],
    ['find . -exec echo {} {} +', 'find: Only one instance of {} is supported with -exec ... +'],
  ])('%s fails before it starts, with status 1', async (line, stderr) => {
    expect(await runLine(line, { tty: false })).toMatchObject({ status: 1, stdoutPlain: '', stderrPlain: stderr });
  });

  it('answers --help itself, and -h as the first word', async () => {
    const help = await runLine('find --help');
    expect(help.status).toBe(0);
    expect(help.stdoutPlain).toContain('find - search for files in a folder tree');
    expect((await runLine('find -h')).stdoutPlain).toBe(help.stdoutPlain);
    expect((await runLine('man find', { tty: false })).stdoutPlain).toMatch(/^ACTIONS$/m);
  });

  it('stops at once on ^C', async () => {
    const s = await session();
    const handle = s.app.shell.start('find / -exec sleep 1 \\;');
    await new Promise((resolve) => setTimeout(resolve, 20));
    handle.abort();
    expect(await handle.done).toMatchObject({ status: 130, interrupted: true });
    s.stop();
  });
});
