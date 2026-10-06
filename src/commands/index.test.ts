import { describe, expect, it } from 'vitest';
import type { CommandSpec } from '../shell/types';
import { buildRegistry, specFiles } from './index';

const spec = (name: string, extra: Partial<CommandSpec> = {}): CommandSpec => ({ name, category: 'files', summary: name, run: () => 0, ...extra });

describe('the command catalogue', () => {
  it('finds the spec files under src/commands/<category>/', () => {
    // Each port adds one, and this list grows.
    expect(specFiles().map((found) => found.name).sort()).toEqual([
      'alias', 'cat', 'cd', 'clear', 'cp', 'echo', 'export', 'history', 'ln', 'ls', 'mkdir', 'mv', 'printf', 'pwd',
      'reset', 'rm', 'rmdir', 'stat', 'touch',
    ]);
  });

  it('has spec files that pass the registry lint', () => {
    expect(buildRegistry([], specFiles()).validate()).toEqual([]);
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
