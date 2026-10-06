import { describe, expect, it } from 'vitest';
import { harness } from '../../testing/shell-harness';
import alias, { shellQuote } from './alias';
import exportSpec from './export';
import reset from './reset';

const ported = () => harness({ specs: [alias, exportSpec, reset] });

describe('alias', () => {
  it('defines, prints and lists aliases, as bash prints them', async () => {
    const { run, shell } = ported();
    await run("alias la='ls -a' gs='git status'");
    expect(shell.aliases.get('la')).toBe('ls -a');
    expect((await run('alias la')).stdout).toBe("alias la='ls -a'");
    expect((await run('alias')).stdout).toBe("alias gs='git status'\nalias la='ls -a'");
    expect((await run('la')).stdout).toBe('a.txt\nb.txt\n.bashrc\ndocs');
  });

  it('fails for an unknown or invalid name', async () => {
    const { run } = ported();
    expect(await run('alias nope')).toMatchObject({ status: 1, stderr: 'vesen: alias: nope: not found' });
    expect(await run("alias 'a/b=x'")).toMatchObject({ status: 1, stderr: "vesen: alias: `a/b': invalid alias name" });
  });

  it("quotes values with ' in them", () => {
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
  });
});

describe('export', () => {
  it('exports to the commands the shell runs', async () => {
    const { run } = ported();
    await run('NAME=Has');
    expect((await run('printenv NAME')).status).toBe(1);
    await run('export NAME');
    expect((await run('printenv NAME')).stdout).toBe('Has');
    await run('export GREETING="hi there"');
    expect((await run('printenv GREETING')).stdout).toBe('hi there');
    expect((await run('export -p')).stdout).toContain('declare -x GREETING="hi there"');
    await run('export -n GREETING');
    expect((await run('printenv GREETING')).status).toBe(1);
  });

  it('refuses a name that is not an identifier', async () => {
    const { run } = ported();
    expect(await run('export 1x=2')).toMatchObject({ status: 1, stderr: "vesen: export: `1x=2': not a valid identifier" });
  });
});

describe('reset', () => {
  it('restores the files, the folder, history and the theme, and puts the banner back', async () => {
    const { run, shell, fs, appearance } = ported();
    await run('echo new > new.txt; cd /etc; alias x=y');
    const result = await run('reset');
    expect(result.screen).toBe('reset');
    expect(fs.exists('/home/guest/new.txt')).toBe(false);
    expect(shell.cwd.get()).toBe('/home/guest');
    expect(shell.aliases.size).toBe(0);
    expect(shell.history.list()).toEqual([]);
    expect(appearance.resets).toBe(1);
  });
});
