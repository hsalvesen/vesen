// touch's times from -d, -t and -r, and -a and -m (the rest is in coreutils.test.ts).
import { describe, expect, it } from 'vitest';
import { runLine, session } from '../../../tests/harness';

describe('touch -d, -t, -r, -a and -m', () => {
  it('sets the time -d names, on new and existing files', async () => {
    const s = await session({ tty: false });
    expect(await s.run("touch -d '2026-01-02 03:04' README.md new.txt")).toMatchObject({ status: 0, stderrPlain: '' });
    const set = Date.UTC(2026, 0, 1, 16, 4);
    expect(s.app.vfs.stat('/home/guest/README.md').mtime).toBe(set);
    expect(s.app.vfs.stat('/home/guest/new.txt').mtime).toBe(set);
    expect((await s.run('ls -l README.md')).stdoutPlain).toMatch(/ Jan  2  2026 README\.md$/);
    await s.run("touch -d '2 days ago' history.txt");
    expect((await s.run("stat -c '%y' history.txt")).stdoutPlain).toBe('2026-10-04 20:03:00.000000000 +1100');
    await s.run('touch -d @0 epoch');
    expect(s.app.vfs.stat('/home/guest/epoch').mtime).toBe(0);
    s.stop();
  });

  it('reads [[CC]YY]MMDDhhmm[.ss] with -t, and copies a time with -r', async () => {
    const s = await session({ tty: false });
    await s.run('touch -t 202501020304.05 a; touch -r a b');
    expect((await s.run("stat -c '%y %n' a b")).stdoutPlain).toBe('2025-01-02 03:04:05.000000000 +1100 a\n2025-01-02 03:04:05.000000000 +1100 b');
    s.stop();
  });

  it('leaves the time alone with -a, which vesen does not keep, but still creates the file', async () => {
    const s = await session({ tty: false });
    const before = s.app.vfs.stat('/home/guest/README.md').mtime;
    expect(await s.run('touch -a README.md new')).toMatchObject({ status: 0 });
    expect(s.app.vfs.stat('/home/guest/README.md').mtime).toBe(before);
    expect(s.app.vfs.exists('/home/guest/new')).toBe(true);
    await s.run('touch -am README.md');
    expect(s.app.vfs.stat('/home/guest/README.md').mtime).toBeGreaterThan(before);
    s.stop();
  });

  it.each([
    ["touch -d nonsense x", "touch: invalid date format 'nonsense'"],
    ['touch -t 99 x', "touch: invalid date format '99'"],
    ['touch -r nope x', "touch: failed to get attributes of 'nope': No such file or directory"],
    ['touch -d now -r README.md x', "touch: cannot specify times from more than one source\nTry 'touch --help' for more information."],
    ["touch -d yesterday /etc/passwd", "touch: setting times of '/etc/passwd': Permission denied"],
  ])('%s fails with status 1', async (line, stderr) => {
    expect(await runLine(line, { tty: false })).toMatchObject({ status: 1, stderrPlain: stderr });
  });
});
