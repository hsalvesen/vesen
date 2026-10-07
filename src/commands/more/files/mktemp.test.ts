// mktemp: a new private file or folder with a random name, in /tmp unless told otherwise.
import { describe, expect, it } from 'vitest';
import { runLine, session } from '../../../../tests/harness';

describe('mktemp', () => {
  it('makes an empty file only its owner may read, in /tmp, and prints its name', async () => {
    const s = await session({ tty: false });
    const result = await s.run('mktemp');
    expect(result.status).toBe(0);
    expect(result.stdoutPlain).toMatch(/^\/tmp\/tmp\.[A-Za-z0-9]{10}$/);
    expect(s.app.vfs.stat(result.stdoutPlain)).toMatchObject({ type: 'file', mode: 0o600, owner: 'guest', size: 0 });
    // The harness's random numbers repeat; the names still never collide.
    const again = await s.run('mktemp');
    expect(again.stdoutPlain).not.toBe(result.stdoutPlain);
    expect(s.app.vfs.readdir('/tmp')).toHaveLength(2);
    s.stop();
  });

  it('makes a folder with -d, rwx------', async () => {
    const s = await session({ tty: false });
    const name = (await s.run('mktemp -d')).stdoutPlain;
    expect(s.app.vfs.stat(name)).toMatchObject({ type: 'directory', mode: 0o700 });
    s.stop();
  });

  it('fills a TEMPLATE of its own, here or in a folder from -p, $TMPDIR or --tmpdir, with a suffix', async () => {
    const s = await session({ tty: false });
    expect((await s.run('mktemp notes.XXXXXX')).stdoutPlain).toMatch(/^notes\.[A-Za-z0-9]{6}$/);
    expect((await s.run('mktemp report-XXX.txt')).stdoutPlain).toMatch(/^report-[A-Za-z0-9]{3}\.txt$/);
    expect((await s.run('mktemp --suffix=.log -p ~')).stdoutPlain).toMatch(/^\/home\/guest\/tmp\.[A-Za-z0-9]{10}\.log$/);
    expect((await s.run('mktemp --tmpdir=documents draft.XXXX')).stdoutPlain).toMatch(/^documents\/draft\.[A-Za-z0-9]{4}$/);
    expect((await s.run('TMPDIR=/home/guest/projects mktemp')).stdoutPlain).toMatch(/^\/home\/guest\/projects\/tmp\./);
    expect((await s.run('mktemp -t job.XXXX')).stdoutPlain).toMatch(/^\/tmp\/job\.[A-Za-z0-9]{4}$/);
    s.stop();
  });

  it('only prints a name with -u', async () => {
    const s = await session({ tty: false });
    const name = (await s.run('mktemp -u')).stdoutPlain;
    expect(name).toMatch(/^\/tmp\/tmp\./);
    expect(s.app.vfs.exists(name)).toBe(false);
    s.stop();
  });

  it.each([
    ['mktemp fooXX', "mktemp: too few X's in template 'fooXX'"],
    ['mktemp -p /tmp a/bXXX', "mktemp: invalid template, 'a/bXXX', contains directory separator"],
    ['mktemp --tmpdir /x/yXXX', "mktemp: invalid template, '/x/yXXX'; with --tmpdir, it may not be absolute"],
    ['mktemp --suffix=.x fooXXX.txt', "mktemp: with --suffix, template 'fooXXX.txt' must end in X"],
    ['mktemp --suffix=a/b', "mktemp: invalid suffix 'a/b', contains directory separator"],
    ['mktemp /etc/xXXXX', "mktemp: failed to create file via template '/etc/xXXXX': Permission denied"],
    ['mktemp -d nope/xXXX', "mktemp: failed to create directory via template 'nope/xXXX': No such file or directory"],
    ['mktemp aXXX bXXX', "mktemp: too many templates\nTry 'mktemp --help' for more information."],
  ])('%s fails with status 1', async (line, stderr) => {
    expect(await runLine(line, { tty: false })).toMatchObject({ status: 1, stdoutPlain: '', stderrPlain: stderr });
  });

  it('says nothing with -q', async () => {
    expect(await runLine('mktemp -q /etc/xXXXX', { tty: false })).toMatchObject({ status: 1, stderrPlain: '' });
  });
});
