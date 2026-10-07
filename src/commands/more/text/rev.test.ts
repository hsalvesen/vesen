// rev, the first command in the catalogue (src/commands/more): what it does, and the catalogue's
// path end to end in the app's shell, from a name the kernel does not have to /usr/bin, help,
// man, which and type.
import { describe, expect, it } from 'vitest';
import { runLine, session } from '../../../../tests/harness';
import { reverseLine, reverseText } from './rev.run';

describe('rev', () => {
  it('reverses each line by whole characters', () => {
    expect(reverseLine('hello')).toBe('olleh');
    expect(reverseLine('héllo 👋')).toBe('👋 olléh');
    expect(reverseText('ab\ncd\n')).toBe('ba\ndc\n');
    expect(reverseText('')).toBe('');
  });

  it('reads standard input, or each FILE in turn, and - for standard input', async () => {
    expect(await runLine('echo hello | rev')).toMatchObject({ status: 0, stdoutPlain: 'olleh' });
    expect((await runLine("printf 'one\\ntwo\\n' | rev", { tty: false })).stdoutPlain).toBe('eno\nowt');
    const s = await session({ tty: false });
    await s.run("printf 'abc\\nxyz\\n' > two.txt");
    expect((await s.run('echo mid | rev two.txt - two.txt')).stdoutPlain).toBe('cba\nzyx\ndim\ncba\nzyx');
    s.stop();
  });

  it('keeps a last line with no newline without one', async () => {
    const s = await session();
    await s.run('printf abc | rev > out.txt');
    expect(s.app.vfs.readFile('/home/guest/out.txt')).toBe('cba');
    await s.run("printf 'x\\n\\ny\\n' | rev > out.txt");
    expect(s.app.vfs.readFile('/home/guest/out.txt')).toBe('x\n\ny\n');
    s.stop();
  });

  it('ends at once in a pipe that stops reading', async () => {
    expect(await runLine('yes | rev | head -n 2', { tty: false })).toMatchObject({ status: 0, stdoutPlain: 'y\ny' });
  });

  it('says which FILE it cannot read, carries on, and exits 1', async () => {
    const result = await runLine('rev nope .bashrc documents', { tty: false });
    expect(result.status).toBe(1);
    expect(result.stderrPlain).toBe('rev: cannot open nope: No such file or directory\nrev: documents: Is a directory');
    expect(result.stdoutPlain).toContain('"al- sl"=ll saila');
  });

  it('answers -h and --help from its spec and the doc in its body', async () => {
    const help = await runLine('rev -h');
    expect(help.status).toBe(0);
    expect(help.stdoutPlain).toContain('rev - reverse the characters of each line');
    expect(help.stdoutPlain.replace(/\s+/g, ' ')).toContain('Copies each FILE to standard output with the characters');
    expect((await runLine('rev --help')).stdoutPlain).toBe(help.stdoutPlain);
    expect(await runLine('rev --nope')).toMatchObject({ status: 1, stderrPlain: "rev: unrecognized option '--nope'\nTry 'rev --help' for more information." });
  });
});

describe('the catalogue in the app', () => {
  it('is not in the kernel: a line asking for rev loads it, and from then on it is everywhere', async () => {
    const s = await session({ catalogue: 'lazy', tty: false });
    const registry = s.app.shell.registry;
    expect(registry.complete).toBe(false);
    expect(registry.get('rev')).toBeUndefined();
    expect((await s.run('ls /usr/bin')).stdoutPlain.split('\n')).not.toContain('rev');

    expect(await s.run('echo resolved | rev')).toMatchObject({ status: 0, stdoutPlain: 'devloser' });
    expect(registry.complete).toBe(true);
    expect(registry.get('rev')?.category).toBe('text');

    // Its stub and man page join the others.
    expect((await s.run('ls /usr/bin')).stdoutPlain.split('\n')).toContain('rev');
    expect((await s.run('echo path | /usr/bin/rev')).stdoutPlain).toBe('htap');
    expect((await s.run('echo bin | /bin/rev')).stdoutPlain).toBe('nib');
    expect((await s.run('cat /usr/share/man/man1/rev.1')).stdoutPlain).toContain('rev \\- reverse the characters of each line');
    // reset builds the seed again, with the catalogue's stubs in it.
    await s.run('reset');
    expect((await s.run('which rev')).stdoutPlain).toBe('/usr/bin/rev');
    s.stop();
  });

  it.each([
    ['help --all', /^rev +reverse the characters of each line$/m],
    ['help', /^Text: .*\brev\b/m],
    ['help rev', /^rev - reverse the characters of each line$/m],
    ['man rev', /^REV\(1\) +User Commands +REV\(1\)$/m],
    ['whatis rev', /^rev \(1\) +- reverse the characters of each line$/m],
    ['apropos reverse', /^rev \(1\) +- reverse the characters of each line$/m],
    ['which rev', /^\/usr\/bin\/rev$/m],
    ['type rev', /^rev is \/usr\/bin\/rev$/m],
    ['command -v rev', /^\/usr\/bin\/rev$/m],
  ])('%s waits for the catalogue, so it knows rev', async (line, expected) => {
    const s = await session({ catalogue: 'lazy', tty: false, cols: 120 });
    expect(s.app.shell.registry.complete).toBe(false);
    const result = await s.run(line);
    expect(result.status, result.stderrPlain).toBe(0);
    expect(result.stdoutPlain).toMatch(expected);
    s.stop();
  });

  it('says command not found only once the catalogue is in', async () => {
    const s = await session({ catalogue: 'lazy' });
    const result = await s.run('nope');
    expect(s.app.shell.registry.complete).toBe(true);
    expect(result).toMatchObject({ status: 127, stderrPlain: "vesen: nope: command not found\nType 'help' to see all commands." });
    s.stop();
  });

  it('comes with the idle prefetch, whatever the connection', async () => {
    const s = await session({ catalogue: 'lazy' });
    expect(s.app.shell.registry.complete).toBe(false);
    await s.app.prefetch();
    expect(s.app.shell.registry.complete).toBe(true);
    s.stop();
  });
});
