import { describe, expect, it } from 'vitest';
import type { CommandSpec } from '../shell/types';
import { buildRegistry, specFiles } from './index';

const spec = (name: string, extra: Partial<CommandSpec> = {}): CommandSpec => ({ name, category: 'files', summary: name, run: () => 0, ...extra });

describe('the command catalogue', () => {
  it('finds the spec files under src/commands/<category>/', () => {
    // Each port adds one, and this list grows.
    expect(specFiles().map((found) => found.name).sort()).toEqual([
      'about', 'alias', 'apropos', 'banner', 'cat', 'cathode', 'cd', 'clear', 'command', 'contact', 'cp', 'date', 'debug', 'echo',
      'env', 'exit', 'export', 'false', 'help', 'history', 'keys', 'linkedin', 'ln', 'login', 'ls', 'man', 'mkdir', 'mv',
      'open', 'poweroff', 'printenv', 'printf', 'privacy', 'pwd', 'reboot', 'repo', 'reset', 'rm', 'rmdir', 'set', 'shutdown',
      'sleep', 'source', 'stat', 'sudo', 'test', 'theme', 'touch', 'true', 'type', 'unalias', 'unset', 'weather', 'whatis', 'which', 'whoami',
    ]);
  });

  it('has spec files that pass the registry lint', () => {
    expect(buildRegistry([], specFiles()).validate()).toEqual([]);
  });

  it('keeps the long help of a command with a lazy body in the spec or the body, never both', async () => {
    let kept = 0;
    for (const found of specFiles()) {
      if (found.load === undefined) continue;
      const { doc } = await found.load();
      if (doc === undefined) continue;
      kept += 1;
      expect(found.description === undefined || doc.description === undefined, found.name).toBe(true);
      expect(found.man === undefined || doc.man === undefined, found.name).toBe(true);
    }
    // ls, printf, test and the other bodies in a <name>.run.ts of their own.
    expect(kept).toBeGreaterThanOrEqual(12);
  });

  it('lets a spec file replace the legacy command of the same name', () => {
    const port = spec('ls', { summary: 'list directory contents' });
    const registry = buildRegistry([spec('ls', { summary: 'legacy' }), spec('cat')], [port]);
    expect(registry.get('ls')).toBe(port);
    expect(registry.get('cat')?.summary).toBe('cat');
  });

  it('throws on a clash between spec files, or a legacy name taken by an alias', () => {
    expect(() => buildRegistry([], [spec('ls'), spec('ls')])).toThrow("'ls' is already registered");
    expect(() => buildRegistry([spec('dir')], [spec('ls', { aliases: ['dir'] })])).toThrow("'dir' is already registered as an alias of 'ls'");
  });
});
