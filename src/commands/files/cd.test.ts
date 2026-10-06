import { describe, expect, it } from 'vitest';
import { isTrustedAction, type Block } from '../../output/model';
import { harness } from '../../testing/shell-harness';
import cd from './cd';
import pwd from './pwd';

const ported = () => harness({ specs: [cd, pwd] });

/** The tappable suggestions in a result. */
function runs(blocks: readonly Block[]): string[] {
  return blocks.flatMap((block) =>
    block.type === 'lines' ? block.lines.flat().flatMap((span) => (isTrustedAction(span.action) && span.action.kind === 'run' ? [span.action.line] : [])) : [],
  );
}

describe('cd', () => {
  it('goes home with no operand or ~, and follows ..', async () => {
    const { run, shell } = ported();
    await run('cd /etc');
    await run('cd');
    expect(shell.cwd.get()).toBe('/home/guest');
    await run('cd docs/..');
    expect(shell.cwd.get()).toBe('/home/guest');
    await run('cd ~/docs');
    expect(shell.cwd.get()).toBe('/home/guest/docs');
    await run('cd ../..');
    expect(shell.cwd.get()).toBe('/home');
  });

  it('cd - goes back to $OLDPWD and prints it', async () => {
    const { run, shell } = ported();
    await run('cd /etc');
    expect(await run('cd -')).toMatchObject({ status: 0, stdout: '/home/guest' });
    expect(shell.cwd.get()).toBe('/home/guest');
    expect((await run('cd -; echo $PWD $OLDPWD')).stdout).toBe('/etc\n/etc /home/guest');
  });

  it('says why it cannot, in bash words, with status 1', async () => {
    const { run, shell } = ported();
    expect(await run('cd nope')).toMatchObject({ status: 1, stderr: 'vesen: cd: nope: No such file or directory' });
    expect(await run('cd a.txt')).toMatchObject({ status: 1, stderr: 'vesen: cd: a.txt: Not a directory' });
    expect(await run('cd a b')).toMatchObject({ status: 1, stderr: 'vesen: cd: too many arguments' });
    expect(shell.cwd.get()).toBe('/home/guest');
    expect(await run('HOME= cd')).toMatchObject({ status: 1, stderr: 'vesen: cd: HOME not set' });
  });

  it('offers a near-miss folder as a tappable cd', async () => {
    const { run } = ported();
    const wrongCase = await run('cd Docs');
    expect(wrongCase.stderr).toBe('vesen: cd: Docs: No such file or directory\nDid you mean docs?');
    expect(runs(wrongCase.blocks)).toEqual(['cd docs']);
    expect(runs((await run('cd dcs')).blocks)).toEqual(['cd docs']);
    // The shell expands ~ before cd sees it, as bash does.
    expect(runs((await run('cd ~/dosc')).blocks)).toEqual(['cd /home/guest/docs']);
    // Files are not offered, and nothing far off is.
    expect(runs((await run('cd a.tx')).blocks)).toEqual([]);
    expect(runs((await run('cd zzzzzz')).blocks)).toEqual([]);
  });

  it('keeps a symbolic link in the path, and -P resolves it', async () => {
    const { run, shell, fs } = ported();
    fs.symlink('docs', '/home/guest/link');
    await run('cd link');
    expect(shell.cwd.get()).toBe('/home/guest/link');
    expect((await run('pwd; pwd -P')).stdout).toBe('/home/guest/link\n/home/guest/docs');
    await run('cd -P /home/guest/link');
    expect(shell.cwd.get()).toBe('/home/guest/docs');
  });
});

describe('pwd', () => {
  it('prints the working directory, and its --help comes from the spec', async () => {
    const { run } = ported();
    expect((await run('pwd')).stdout).toBe('/home/guest');
    expect((await run('pwd --help')).stdout).toContain('print the working directory');
  });

  it('cannot resolve a folder that has gone, with -P', async () => {
    const { run, fs } = ported();
    await run('cd docs');
    fs.rmdir('/home/guest/docs');
    expect((await run('pwd')).stdout).toBe('/home/guest/docs');
    expect(await run('pwd -P')).toMatchObject({
      status: 1,
      stderr: 'pwd: error retrieving current directory: getcwd: cannot access parent directories: No such file or directory',
    });
  });
});
