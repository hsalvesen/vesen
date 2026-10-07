// GNU chmod's mode grammar (lib/chmod-mode.ts), against what coreutils gives.
import { describe, expect, it } from 'vitest';
import { applyMode, compileMode, describeMode, permString } from './chmod-mode';

const apply = (mode: string, old: number, directory = false, umask = 0o022): number | null => {
  const compiled = compileMode(mode);
  return compiled === null ? null : applyMode(compiled, old, directory, umask);
};

describe('compileMode and applyMode', () => {
  it('reads octal modes, which set every bit', () => {
    expect(apply('755', 0o644)).toBe(0o755);
    expect(apply('0', 0o777)).toBe(0);
    expect(apply('1777', 0o755, true)).toBe(0o1777);
    expect(apply('4755', 0o644)).toBe(0o4755);
    expect(apply('17777', 0)).toBeNull();
    expect(apply('8', 0)).toBeNull();
  });

  it('keeps a folder’s set-ID bits unless the octal mode has five digits or sets them', () => {
    expect(apply('755', 0o2755, true)).toBe(0o2755);
    expect(apply('755', 0o2755, false)).toBe(0o755);
    expect(apply('00755', 0o2755, true)).toBe(0o755);
    expect(apply('2775', 0o755, true)).toBe(0o2775);
  });

  it('adds, removes and sets bits for who is named', () => {
    expect(apply('u+x', 0o644)).toBe(0o744);
    expect(apply('go-w', 0o666)).toBe(0o644);
    expect(apply('a=r', 0o755)).toBe(0o444);
    expect(apply('u=rwx,g=rx,o=', 0o000)).toBe(0o750);
    expect(apply('ug+rw,o-rwx', 0o007)).toBe(0o660);
    expect(apply('u=', 0o755)).toBe(0o055);
    expect(apply('a+t', 0o777, true)).toBe(0o1777);
    expect(apply('u+s,g+s', 0o755)).toBe(0o6755);
    expect(apply('o+t-x', 0o777, true)).toBe(0o1776);
  });

  it('holds back the umask’s bits when nobody is named', () => {
    expect(apply('+w', 0o444)).toBe(0o644);
    expect(apply('+x', 0o644)).toBe(0o755);
    expect(apply('-w', 0o666)).toBe(0o466);
    expect(apply('=r', 0o777)).toBe(0o444);
    expect(apply('+w', 0o444, false, 0)).toBe(0o666);
    expect(compileMode('+w')?.usesUmask).toBe(true);
    expect(compileMode('a+w')?.usesUmask).toBe(false);
    expect(compileMode('644')?.usesUmask).toBe(false);
  });

  it('adds execute with X only to folders and to files someone may run', () => {
    expect(apply('a+X', 0o644)).toBe(0o644);
    expect(apply('a+X', 0o744)).toBe(0o755);
    expect(apply('a+X', 0o644, true)).toBe(0o755);
    expect(apply('go+rX', 0o700, true)).toBe(0o755);
  });

  it("copies another class's bits with u, g or o", () => {
    expect(apply('g=u', 0o640)).toBe(0o660);
    expect(apply('o=g', 0o750)).toBe(0o755);
    expect(apply('go=u-w', 0o755)).toBe(0o755);
    expect(apply('a=u', 0o600)).toBe(0o666);
  });

  it('applies operators after an octal number only when nobody is named', () => {
    expect(apply('=644', 0o777)).toBe(0o644);
    expect(apply('+111', 0o644)).toBe(0o755);
    expect(apply('u+7', 0)).toBeNull();
  });

  it('refuses what is not a mode', () => {
    for (const bad of ['', 'xyz', 'u', 'u+q', 'a+r,', ',', 'z+x', 'u+x,,g+w', 'rwx']) expect(compileMode(bad), bad).toBeNull();
  });
});

describe('describing a mode', () => {
  it('writes the permission letters and chmod -v’s octal form', () => {
    expect(permString(0o644)).toBe('rw-r--r--');
    expect(permString(0o4755)).toBe('rwsr-xr-x');
    expect(permString(0o1776)).toBe('rwxrwxrwT');
    expect(describeMode(0o644)).toBe('0644 (rw-r--r--)');
    expect(describeMode(0o1777)).toBe('1777 (rwxrwxrwt)');
  });
});
