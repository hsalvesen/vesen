// du and df: sizes from the VFS, in GNU's layouts, and df's line for the browser's own estimate.
import { describe, expect, it } from 'vitest';
import { runLine, session } from '../../../../tests/harness';
import { createSysInfo } from '../../../services/sysinfo';
import type { SysInfo } from '../../../services/types';

describe('du', () => {
  it('prints each folder with its total, the deepest first, in kibibytes of 4 KiB blocks', async () => {
    expect(await runLine('du projects', { tty: false })).toMatchObject({
      status: 0,
      stdoutPlain: '8\tprojects/vesen\n8\tprojects/portfolio\n8\tprojects/learning\n28\tprojects',
    });
  });

  it('adds files with -a, a total with -c, and human sizes with -h', async () => {
    expect((await runLine('du -ach projects', { tty: false })).stdoutPlain).toBe(
      [
        '4.0K\tprojects/vesen/info.txt',
        '8.0K\tprojects/vesen',
        '4.0K\tprojects/portfolio/index.html',
        '8.0K\tprojects/portfolio',
        '4.0K\tprojects/learning/javascript-basics.js',
        '8.0K\tprojects/learning',
        '28K\tprojects',
        '28K\ttotal',
      ].join('\n'),
    );
  });

  it('summarizes with -s, limits depth with -d, and measures bytes with -b', async () => {
    expect((await runLine('du -s projects documents', { tty: false })).stdoutPlain).toBe('28\tprojects\n8\tdocuments');
    const depth = (await runLine('du -d 1', { tty: false })).stdoutPlain.split('\n');
    expect(depth).toContain('28\t./projects');
    expect(depth).not.toContain('8\t./projects/vesen');
    expect(depth[depth.length - 1]).toMatch(/^\d+\t\.$/);
    expect((await runLine('du -b README.md documents/linux.txt', { tty: false })).stdoutPlain).toBe('850\tREADME.md\n3093\tdocuments/linux.txt');
    expect((await runLine('du -sb documents', { tty: false })).stdoutPlain).toBe(`${4096 + 3093}\tdocuments`);
    expect((await runLine('du -s --apparent-size documents', { tty: false })).stdoutPlain).toBe(`${Math.ceil((4096 + 3093) / 1024)}\tdocuments`);
  });

  it('counts a new file by the blocks it takes', async () => {
    const s = await session({ tty: false });
    await s.run('mkdir box; truncate -s 5000 box/f; touch box/empty');
    expect((await s.run('du -a box')).stdoutPlain).toBe('8\tbox/f\n0\tbox/empty\n12\tbox');
    s.stop();
  });

  it('says what it cannot read, still counts the folder, and exits 1', async () => {
    expect(await runLine('du /root', { tty: false })).toMatchObject({ status: 1, stdoutPlain: '4\t/root', stderrPlain: "du: cannot read directory '/root': Permission denied" });
    expect(await runLine('du nope README.md', { tty: false })).toMatchObject({ status: 1, stdoutPlain: '4\tREADME.md', stderrPlain: "du: cannot access 'nope': No such file or directory" });
  });

  it.each([
    ['du -sa', "du: cannot both summarize and show all entries\nTry 'du --help' for more information."],
    ['du -s -d 1', "du: warning: summarizing conflicts with --max-depth=1\nTry 'du --help' for more information."],
    ['du -d x', "du: invalid maximum depth 'x'"],
  ])('%s is a mistake', async (line, stderr) => {
    expect(await runLine(line, { tty: false })).toMatchObject({ status: 1, stderrPlain: stderr });
  });
});

/** System facts with a storage estimate, as a browser gives one. */
function withStorage(estimate: { usage: number; quota: number } | null): SysInfo {
  const base = createSysInfo(null);
  return { ...base, storage: () => Promise.resolve(estimate) };
}

describe('df', () => {
  it("shows vesen's file system and its quota in GNU's layout", async () => {
    const result = await runLine('df', { tty: false });
    expect(result.status).toBe(0);
    const [head, row, more] = result.stdoutPlain.split('\n');
    expect(head).toBe('Filesystem     1K-blocks  Used Available Use% Mounted on');
    expect(row).toMatch(/^vesenfs +512 +\d+ +\d+ +\d+% \/$/);
    expect(more).toBeUndefined();
  });

  it('adds the storage the browser grants the site, when it says', async () => {
    const sys = withStorage({ usage: 3 * 1024 * 1024, quota: 2 * 1024 ** 3 });
    const rows = (await runLine('df -h', { tty: false, sys })).stdoutPlain.split('\n');
    expect(rows[0]).toBe('Filesystem      Size  Used Avail Use% Mounted on');
    expect(rows[1]).toMatch(/^vesenfs +512K +\d+K +\d+K +\d+% \/$/);
    expect(rows[2]).toBe('browser         2.0G  3.0M  2.0G   1% (site data)');
    // A browser that says nothing leaves the line out.
    expect((await runLine('df -h', { tty: false, sys: withStorage(null) })).stdoutPlain.split('\n')).toHaveLength(2);
  });

  it('counts the visitor’s files against the quota', async () => {
    const s = await session({ tty: false });
    const before = Number(/vesenfs +\d+ +(\d+)/.exec((await s.run('df')).stdoutPlain)?.[1]);
    await s.run('truncate -s 100K big');
    const after = Number(/vesenfs +\d+ +(\d+)/.exec((await s.run('df')).stdoutPlain)?.[1]);
    expect(after - before).toBeGreaterThanOrEqual(100);
    s.stop();
  });

  it('adds a type column with -T, a total with --total, and the file system of each FILE', async () => {
    const rows = (await runLine('df -T --total ~ /tmp', { tty: false })).stdoutPlain.split('\n');
    expect(rows[0]).toBe('Filesystem     Type    1K-blocks  Used Available Use% Mounted on');
    expect(rows[1]).toMatch(/^vesenfs +vesenfs +512 /);
    expect(rows[2]).toBe(rows[1]);
    expect(rows[3]).toMatch(/^total +- +1024 +\d+ +\d+ +\d+% -$/);
    expect(await runLine('df nope', { tty: false })).toMatchObject({ status: 1, stderrPlain: 'df: nope: No such file or directory\ndf: no file systems processed' });
  });
});
