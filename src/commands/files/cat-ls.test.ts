import { describe, expect, it } from 'vitest';
import { isTrustedAction, type Block, type Span } from '../../output/model';
import { runLine, session } from '../../../tests/harness';

/** The lines of the first lines block, as spans. */
function firstLines(blocks: readonly Block[]): readonly (readonly Span[])[] {
  const block = blocks.find((b) => b.type === 'lines');
  return block?.type === 'lines' ? block.lines : [];
}

/** The tappable lines offered in some output. */
function runs(blocks: readonly Block[]): string[] {
  return blocks.flatMap((block) =>
    block.type === 'lines' ? block.lines.flat().flatMap((span) => (isTrustedAction(span.action) && span.action.kind === 'run' ? [span.action.line] : [])) : [],
  );
}

describe('cat', () => {
  it('prints several files in turn, and - or nothing for standard input', async () => {
    const s = await session({ tty: false });
    await s.run('echo one > a; echo two > b');
    expect((await s.run('cat a b')).stdoutPlain).toBe('one\ntwo');
    expect((await s.run('echo piped | cat a - b')).stdoutPlain).toBe('one\npiped\ntwo');
    expect((await s.run('echo piped | cat')).stdoutPlain).toBe('piped');
    expect((await s.run('cat < a')).stdoutPlain).toBe('one');
    s.stop();
  });

  it('carries on after a file it cannot read, in GNU words, and exits 1', async () => {
    const result = await runLine('cat nope README.md documents /etc/shadow');
    expect(result.status).toBe(1);
    expect(result.stderrPlain).toBe(
      ['cat: nope: No such file or directory', 'cat: documents: Is a directory', 'cat: /etc/shadow: Permission denied'].join('\n'),
    );
    expect(result.stdoutPlain).toContain('The Terminal');
  });

  it('offers the file probably meant on a terminal, as a tappable cat', async () => {
    const result = await runLine('cat readme.md');
    expect(result.stderrPlain).toBe('cat: readme.md: No such file or directory\nDid you mean README.md?');
    expect(runs(result.blocks)).toEqual(['cat README.md']);
    expect((await runLine('cat readme.md', { tty: false })).stderrPlain).toBe('cat: readme.md: No such file or directory');
  });

  it("draws the owner's documents in their colours on a terminal only", async () => {
    const styled = firstLines((await runLine('cat README.md')).blocks);
    expect(styled.flat().some((span) => span.style?.fg !== undefined)).toBe(true);
    const piped = await runLine('cat README.md', { tty: false });
    expect(piped.stdoutPlain).toContain('The Terminal');
    expect(piped.stdoutPlain).not.toMatch(/[{<\u001b]/);
    // With an option it is text, on the terminal too.
    const numbered = firstLines((await runLine('cat -n README.md')).blocks);
    expect(numbered.flat().every((span) => span.style === undefined)).toBe(true);
  });

  it('numbers lines with -n and -b, across files, as GNU does', async () => {
    const s = await session({ tty: false });
    await s.run("printf 'a\\n\\nb\\n' > f; printf 'c\\n' > g");
    expect((await s.run('cat -n f g')).stdoutPlain).toBe('     1\ta\n     2\t\n     3\tb\n     4\tc');
    expect((await s.run('cat -b f')).stdoutPlain).toBe('     1\ta\n\n     2\tb');
    expect((await s.run('cat -nb f')).stdoutPlain).toBe('     1\ta\n\n     2\tb');
    s.stop();
  });

  it('squeezes blank lines and shows ends, tabs and control characters', async () => {
    const s = await session({ tty: false });
    await s.run("printf 'a\\n\\n\\n\\tb\\x01\\n' > f");
    expect((await s.run('cat -s f')).stdoutPlain).toBe('a\n\n\tb\u0001');
    expect((await s.run('cat -E f')).stdoutPlain).toBe('a$\n$\n$\n\tb\u0001$');
    expect((await s.run('cat -T f')).stdoutPlain).toBe('a\n\n\n^Ib\u0001');
    expect((await s.run('cat -v f')).stdoutPlain).toBe('a\n\n\n\tb^A');
    expect((await s.run('cat -sA f')).stdoutPlain).toBe('a$\n$\n^Ib^A$');
    expect((await s.run('cat -e f')).stdoutPlain).toBe('a$\n$\n$\n\tb^A$');
    expect((await s.run('cat -t f')).stdoutPlain).toBe('a\n\n\n^Ib^A');
    s.stop();
  });

  it('keeps a file without a final newline as it is', async () => {
    const s = await session({ tty: false });
    await s.run("printf 'no end' > f");
    expect((await s.run('cat f f')).stdoutPlain).toBe('no endno end');
    expect((await s.run('cat -n f f')).stdoutPlain).toBe('     1\tno endno end');
    s.stop();
  });

  it('streams standard input, so cat in the middle of a pipe ends with it', async () => {
    expect(await runLine('yes | cat | head -n 2')).toMatchObject({ status: 0, stdoutPlain: 'y\ny' });
  });

  it('copies standard input byte for byte, a missing final newline included', async () => {
    expect((await runLine("printf 'x' | cat | wc -c", { tty: false })).stdoutPlain).toBe('1');
    expect((await runLine("printf 'a\nb' | cat -n", { tty: false })).stdoutPlain).toBe('     1\ta\n     2\tb');
  });
});

describe('ls', () => {
  it('lists the working directory as a grid on the terminal, sorted, with no forced / (F018)', async () => {
    const result = await runLine('ls');
    const grid = result.blocks[0];
    expect(grid?.type).toBe('grid');
    const names = grid?.type === 'grid' ? grid.items.map((item) => item.text) : [];
    expect(names).toEqual(['bin', 'config', 'desktop', 'documents', 'downloads', 'history.txt', 'music', 'pictures', 'projects', 'public', 'README.md', 'scripts', 'src', 'templates', 'videos']);
    const styles = grid?.type === 'grid' ? Object.fromEntries(grid.items.map((item) => [item.text, item.style])) : {};
    expect(styles.documents).toEqual({ fg: 'link', bold: true });
    expect(styles['README.md']).toEqual({ fg: 'fg-strong' });
  });

  it('lists one name per line, without colour, in a pipe', async () => {
    const result = await runLine('ls', { tty: false });
    expect(result.stdoutPlain.split('\n')).toHaveLength(15);
    expect(result.stdoutPlain).not.toContain('\u001b');
    expect((await runLine('ls | cat')).stdoutPlain.split('\n')[0]).toBe('bin');
  });

  it('shows dotfiles with -a (with . and ..) and -A (without)', async () => {
    const all = (await runLine('ls -a', { tty: false })).stdoutPlain.split('\n');
    expect(all.slice(0, 4)).toEqual(['.', '..', '.bash_history', '.bashrc']);
    const almost = (await runLine('ls -A', { tty: false })).stdoutPlain.split('\n');
    expect(almost[0]).toBe('.bash_history');
    expect(almost).not.toContain('.');
  });

  it('ls -la ~ shows .bashrc, .ssh and projects in the long format', async () => {
    const lines = (await runLine('ls -la ~')).stdoutPlain.split('\n');
    expect(lines[0]).toBe('total 92');
    expect(lines).toContain('-rw-r--r--  1 guest guest  236 Oct  6 11:00 .bashrc');
    expect(lines).toContain('drwx------  2 guest guest 4096 Oct  6 11:00 .ssh');
    expect(lines).toContain('drwxr-xr-x  5 guest guest 4096 Oct  6 11:00 projects');
    expect(lines).toContain('drwxr-xr-x  4 root  root  4096 Oct  6 11:00 ..');
  });

  it('writes sizes, links, devices and the year as GNU ls -l does', async () => {
    expect((await runLine('ls -lh /etc')).stdoutPlain.split('\n')[0]).toBe('total 40K');
    expect((await runLine('ls -l /')).stdoutPlain).toContain('lrwxrwxrwx 1 root root    7 Oct  6 11:00 bin -> usr/bin');
    expect((await runLine('ls -ld /tmp')).stdoutPlain).toBe('drwxrwxrwt 2 root root 4096 Oct  6 11:00 /tmp');
    expect((await runLine('ls -l /dev')).stdoutPlain).toContain('crw-rw-rw- 1 root root 1, 3 Oct  6 11:00 null');
    expect((await runLine('ls -n /home')).stdoutPlain).toContain('drwxr-xr-x  2 1001 1001 4096 Oct  6 11:00 has');
    const s = await session();
    s.app.vfs.touch('/home/guest/old.txt', Date.UTC(2024, 0, 2, 3, 4, 5));
    expect((await s.run('ls -l old.txt')).stdoutPlain).toBe('-rw-r--r-- 1 guest guest 0 Jan  2  2024 old.txt');
    s.stop();
  });

  it('lists several operands, files first, then each folder under a header', async () => {
    const result = await runLine('ls documents README.md /home', { tty: false });
    expect(result.stdoutPlain).toBe('README.md\n\n/home:\nguest\nhas\nuser\n\ndocuments:\nlinux.txt');
  });

  it('lists a file operand as the file, and folders themselves with -d', async () => {
    expect((await runLine('ls README.md', { tty: false })).stdoutPlain).toBe('README.md');
    expect((await runLine('ls -d documents projects', { tty: false })).stdoutPlain).toBe('documents\nprojects');
    expect((await runLine('ls -d', { tty: false })).stdoutPlain).toBe('.');
  });

  it('follows a link to a folder, unless -l, -d or -F asks about the link', async () => {
    expect((await runLine('ls /home/user', { tty: false })).stdoutPlain).toBe((await runLine('ls ~', { tty: false })).stdoutPlain);
    expect((await runLine('ls -l /home/user', { tty: false })).stdoutPlain).toBe('lrwxrwxrwx 1 root root 5 Oct  6 11:00 /home/user -> guest');
    expect((await runLine('ls -l /home/user/', { tty: false })).stdoutPlain).toContain('total');
  });

  it('marks a link in the long format after its target', async () => {
    expect((await runLine('ls -lF /home/user /bin', { tty: false })).stdoutPlain).toBe(
      'lrwxrwxrwx 1 root root 7 Oct  6 11:00 /bin -> usr/bin/\nlrwxrwxrwx 1 root root 5 Oct  6 11:00 /home/user -> guest/',
    );
    expect((await runLine('ls -lp /home', { tty: false })).stdoutPlain).toContain(' user -> guest/');
  });

  it('marks kinds with -F and folders with -p', async () => {
    expect((await runLine('ls -F /home ~/bin', { tty: false })).stdoutPlain).toBe('/home:\nguest/\nhas/\nuser@\n\n/home/guest/bin:\ndeploy*\nmy-script*');
    expect((await runLine('ls -p ~/bin /home', { tty: false })).stdoutPlain).toBe('/home:\nguest/\nhas/\nuser\n\n/home/guest/bin:\ndeploy\nmy-script');
  });

  it('recurses with -R, each folder under its path', async () => {
    const result = await runLine('ls -R projects', { tty: false });
    expect(result.stdoutPlain).toBe(
      ['projects:', 'learning', 'portfolio', 'vesen', '', 'projects/learning:', 'javascript-basics.js', '', 'projects/portfolio:', 'index.html', '', 'projects/vesen:', 'info.txt'].join('\n'),
    );
  });

  it('sorts by time, size and in reverse', async () => {
    const s = await session({ tty: false });
    await s.run('echo first > one.txt');
    await s.run('echo second, longer > two.txt');
    expect((await s.run('ls -t *.txt')).stdoutPlain).toBe('two.txt\none.txt\nhistory.txt');
    expect((await s.run('ls -S *.txt')).stdoutPlain).toBe('history.txt\ntwo.txt\none.txt');
    expect((await s.run('ls -r *.txt')).stdoutPlain).toBe('two.txt\none.txt\nhistory.txt');
    s.stop();
  });

  it('lays out columns for a pipe with -C, down the columns', async () => {
    const result = await runLine('ls -C', { tty: false, cols: 40 });
    expect(result.stdoutPlain.split('\n')).toEqual([
      'bin          history.txt  README.md',
      'config       music        scripts',
      'desktop      pictures     src',
      'documents    projects     templates',
      'downloads    public       videos',
    ]);
  });

  it('colours with --color=always in a pipe, and never with --color=never', async () => {
    expect((await runLine('ls --color=always documents', { tty: false })).stdoutPlain).toBe('linux.txt');
    expect((await runLine('ls --color=always ~/bin', { tty: false })).stdoutPlain).toBe('\u001b[1m\u001b[32mdeploy\u001b[39m\u001b[22m\n\u001b[1m\u001b[32mmy-script\u001b[39m\u001b[22m');
    const never = (await runLine('ls --color=never')).blocks[0];
    expect(never?.type === 'grid' && never.items.every((item) => item.style === undefined)).toBe(true);
    expect(await runLine('ls --color=sometimes')).toMatchObject({ status: 2 });
  });

  it("quotes awkward names on the terminal only, as GNU ls does", async () => {
    const s = await session();
    await s.run("touch 'my file' \"it's\"");
    const grid = (await s.run('ls')).blocks[0];
    const names = grid?.type === 'grid' ? grid.items.map((item) => item.text) : [];
    expect(names).toContain("'my file'");
    expect(names).toContain('"it\'s"');
    s.stop();
    const piped = await session({ tty: false });
    await piped.run("touch 'my file'");
    expect((await piped.run('ls')).stdoutPlain).toContain('\nmy file\n');
    piped.stop();
  });

  it("says what it cannot list in GNU's words: 2 for an operand, 1 inside", async () => {
    expect(await runLine('ls nope')).toMatchObject({ status: 2, stderrPlain: "ls: cannot access 'nope': No such file or directory" });
    expect(await runLine('ls /root')).toMatchObject({ status: 2, stderrPlain: "ls: cannot open directory '/root': Permission denied" });
    expect(await runLine('ls -z')).toMatchObject({ status: 2, stderrPlain: "ls: invalid option -- 'z'\nTry 'ls --help' for more information." });
    const nested = await runLine('ls -R / 2>&1 >/dev/null | head -n 1', { tty: false });
    expect(nested.stdoutPlain).toBe("ls: cannot open directory '/root': Permission denied");
  });

  it('expands globs through the shell, and runs ll from ~/.bashrc', async () => {
    expect((await runLine('ls *.txt', { tty: false })).stdoutPlain).toBe('history.txt');
    expect((await runLine('ls -d .b*', { tty: false })).stdoutPlain).toBe('.bash_history\n.bashrc');
    expect((await runLine('ll', { tty: false })).stdoutPlain.split('\n')[0]).toBe('total 92');
  });

  it('answers --help from its spec, with -h meaning human sizes', async () => {
    expect((await runLine('ls --help')).stdoutPlain).toContain('ls - list directory contents');
    expect((await runLine('ls -lh documents')).stdoutPlain).toBe('total 4.0K\n-rw-r--r-- 1 guest guest 3.1K Oct  6 11:00 linux.txt');
  });
});
