// tree: the drawing, its options and its count, as one art block on the terminal that a narrow
// screen scrolls rather than wraps, and as tree's own text in a pipe.
import { describe, expect, it } from 'vitest';
import { runLine, session } from '../../../../tests/harness';

describe('tree', () => {
  it('draws a folder with box-drawing lines, sorted, then counts', async () => {
    expect(await runLine('tree projects', { tty: false })).toMatchObject({
      status: 0,
      stdoutPlain: [
        'projects',
        '├── learning',
        '│   └── javascript-basics.js',
        '├── portfolio',
        '│   └── index.html',
        '└── vesen',
        '    └── info.txt',
        '',
        '3 directories, 3 files',
      ].join('\n'),
    });
  });

  it('is one art block on the terminal, the same at 40 and 80 columns, which scrolls rather than wraps', async () => {
    const narrow = await runLine('tree -af ~', { cols: 40 });
    const wide = await runLine('tree -af ~', { cols: 80 });
    expect(narrow.stdoutPlain).toBe(wide.stdoutPlain);
    const art = narrow.blocks.find((block) => block.type === 'art');
    expect(art).toMatchObject({ type: 'art', fit: 'scroll' });
    // Some rows are wider than a 40-column phone: they scroll sideways as one drawing.
    const rows = art?.type === 'art' ? art.text.split('\n') : [];
    expect(Math.max(...rows.map((row) => Array.from(row).length))).toBeGreaterThan(40);
    expect(rows[0]).toBe('/home/guest');
    // A screen reader hears the paths, not the lines.
    expect(art?.type === 'art' ? art.alt : '').toMatch(/^Tree of \/home\/guest, 20 directories, \d+ files: \/home\/guest\/\.bash_history, /);
    expect(art?.type === 'art' ? art.alt : '').toContain('/home/guest/projects/vesen/info.txt');
    expect(narrow.stdoutPlain).toMatch(/\n\n20 directories, \d+ files$/);
    // And a pipe gets tree's own text, whatever the width.
    expect((await runLine('tree -af ~', { tty: false, cols: 40 })).stdoutPlain).toBe(wide.stdoutPlain);
  });

  it('hides dot files unless -a, and leaves out what -I matches', async () => {
    const plain = (await runLine('tree ~', { tty: false })).stdoutPlain;
    expect(plain).not.toContain('.bashrc');
    const all = (await runLine("tree -a -I '.ssh|*.txt' ~", { tty: false })).stdoutPlain;
    expect(all).toContain('.bashrc');
    expect(all).not.toContain('.ssh');
    expect(all).not.toContain('.txt');
    expect((await runLine('tree -I bin -I src ~', { tty: false })).stdoutPlain).not.toMatch(/── (bin|src)$/m);
  });

  it('stops at -L levels, lists folders only with -d, and puts folders first with --dirsfirst', async () => {
    expect((await runLine('tree -L 1 /home', { tty: false })).stdoutPlain).toBe('/home\n├── guest\n├── has\n└── user -> guest\n\n3 directories, 0 files');
    expect((await runLine('tree -d projects', { tty: false })).stdoutPlain).toBe('projects\n├── learning\n├── portfolio\n└── vesen\n\n3 directories');
    const s = await session({ tty: false });
    await s.run('mkdir zz; touch aa');
    expect((await s.run('tree -L 1 --dirsfirst --noreport src')).stdoutPlain).toBe('src\n└── main.c');
    const listed = (await s.run('tree -L 1 --dirsfirst')).stdoutPlain.split('\n');
    expect(listed.indexOf('├── zz')).toBeLessThan(listed.indexOf('├── aa'));
    s.stop();
  });

  it('puts the permissions (-p), the size in bytes (-s) or in K, M and G (-h) in brackets before each name', async () => {
    const run = async (line: string): Promise<string> => (await runLine(line, { tty: false })).stdoutPlain;
    expect(await run('tree -p projects')).toBe(
      [
        'projects',
        '├── [drwxr-xr-x]  learning',
        '│   └── [-rw-r--r--]  javascript-basics.js',
        '├── [drwxr-xr-x]  portfolio',
        '│   └── [-rw-r--r--]  index.html',
        '└── [drwxr-xr-x]  vesen',
        '    └── [-rw-r--r--]  info.txt',
        '',
        '3 directories, 3 files',
      ].join('\n'),
    );
    expect((await run('tree -s projects/vesen')).split('\n')[1]).toBe('└── [        118]  info.txt');
    // -h is the size for people here, never help.
    expect((await run('tree -h projects')).split('\n').slice(1, 3)).toEqual(['├── [4.0K]  learning', '│   └── [ 115]  javascript-basics.js']);
    expect((await run('tree -psh documents')).split('\n')[1]).toBe('└── [-rw-r--r-- 3.1K]  linux.txt');
    // A link's own type and size, not what it points to.
    expect((await run('tree -p -L 1 /home')).split('\n')[3]).toBe('└── [lrwxrwxrwx]  user -> guest');
  });

  it('prints full paths with -f', async () => {
    expect((await runLine('tree -f downloads', { tty: false })).stdoutPlain).toBe(
      'downloads\n├── downloads/README-download.txt\n└── downloads/software.tar.gz\n\n0 directories, 2 files',
    );
  });

  it('shows links with their targets, unfollowed, and counts a link to a folder as a folder', async () => {
    expect((await runLine('tree /bin', { tty: false })).stdoutPlain).toBe('/bin -> usr/bin\n\n0 directories, 0 files');
    const s = await session({ tty: false });
    await s.run('mkdir t; ln -s ../documents t/docs; ln -s nope t/broken');
    expect((await s.run('tree t')).stdoutPlain).toBe('t\n├── broken -> nope\n└── docs -> ../documents\n\n1 directory, 1 file');
    s.stop();
  });

  it('marks what it cannot open, and exits 2 for a DIRECTORY it cannot list', async () => {
    expect(await runLine('tree nope', { tty: false })).toMatchObject({ status: 2, stdoutPlain: 'nope  [error opening dir]\n\n0 directories, 0 files' });
    expect(await runLine('tree /root', { tty: false })).toMatchObject({ status: 2, stdoutPlain: '/root  [error opening dir]\n\n0 directories, 0 files' });
    const s = await session({ tty: false });
    await s.run('mkdir -p box/locked');
    s.app.vfs.chmod('/home/guest/box/locked', 0o000);
    expect(await s.run('tree box')).toMatchObject({ status: 0, stdoutPlain: 'box\n└── locked  [error opening dir]\n\n1 directory, 0 files' });
    s.stop();
  });

  it('refuses a level that is not a positive number', async () => {
    expect(await runLine('tree -L 0', { tty: false })).toMatchObject({ status: 1, stderrPlain: 'tree: Invalid level, must be greater than 0.' });
    expect(await runLine('tree -L x', { tty: false })).toMatchObject({ status: 1, stderrPlain: 'tree: Invalid level, must be greater than 0.' });
  });
});
