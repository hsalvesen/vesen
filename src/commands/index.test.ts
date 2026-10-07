import { describe, expect, it } from 'vitest';
import type { CommandSpec } from '../shell/types';
import { allSpecFiles, buildRegistry, loadCatalogue, specFiles } from './index';

const spec = (name: string, extra: Partial<CommandSpec> = {}): CommandSpec => ({ name, category: 'files', summary: name, run: () => 0, ...extra });

describe('the command catalogue', () => {
  it('finds the spec files under src/commands/<category>/', () => {
    // Each port adds one, and this list grows.
    expect(specFiles().map((found) => found.name).sort()).toEqual([
      'about', 'alias', 'apropos', 'banner', 'cat', 'cathode', 'cd', 'clear', 'command', 'contact', 'cp', 'curl', 'date', 'debug',
      'echo', 'env', 'exit', 'export', 'false', 'fastfetch', 'help', 'history', 'keys', 'linkedin', 'ln', 'login', 'ls', 'man',
      'mkdir', 'mv', 'open', 'poweroff', 'printenv', 'printf', 'privacy', 'pwd', 'qr', 'reboot', 'repo', 'reset', 'rm', 'rmdir',
      'set', 'shutdown', 'sleep', 'source', 'speedtest', 'stat', 'stock', 'sudo', 'test', 'theme', 'touch', 'true', 'type',
      'unalias', 'unset', 'weather', 'whatis', 'which', 'whoami',
    ]);
  });

  it('finds the catalogue under src/commands/more/<category>/, apart from the kernel', async () => {
    // Each wave adds to it.
    const catalogue = await loadCatalogue();
    expect(catalogue.map((found) => found.name).sort()).toEqual([
      'base64', 'basename', 'bc', 'chgrp', 'chmod', 'chown', 'column', 'cut', 'df', 'diff', 'dirname', 'du', 'expr', 'file', 'find',
      'fold', 'grep', 'head', 'md5sum', 'mktemp', 'nl', 'readlink', 'realpath', 'rev', 'sed', 'seq', 'sha1sum', 'sha256sum',
      'sha512sum', 'sort', 'sync', 'tail', 'tee', 'tr', 'tree', 'truncate', 'uniq', 'wc', 'xargs', 'yes',
    ]);
    const core = new Set(specFiles().map((found) => found.name));
    for (const found of catalogue) expect(core.has(found.name), found.name).toBe(false);
    for (const found of catalogue) expect(['text', 'files', 'system', 'network', 'fun', 'editor'], found.name).toContain(found.category);
  });

  it('registers the catalogue beside the kernel with no clash, and passes the registry lint', async () => {
    const registry = buildRegistry([], specFiles());
    expect(registry.complete).toBe(false);
    expect(registry.get('rev')).toBeUndefined();
    await registry.whenComplete();
    expect(registry.takeFailure()).toBeUndefined();
    expect(registry.complete).toBe(true);
    expect(registry.get('rev')?.category).toBe('text');
    expect(registry.validate()).toEqual([]);
  });

  it('lets a catalogue command replace an extra of the same name, as a spec file does', async () => {
    const registry = buildRegistry([spec('rev', { summary: 'stand-in' }), spec('cat')], [spec('ls')], loadCatalogue);
    expect(registry.get('rev')?.summary).toBe('stand-in');
    await registry.whenComplete();
    expect(registry.get('rev')?.summary).toBe('reverse the characters of each line');
    const catalogue = (await loadCatalogue()).map((found) => found.name);
    expect(registry.names()).toEqual(['cat', 'ls', ...catalogue].sort((a, b) => a.localeCompare(b)));
  });

  it('keeps the long help of a command with a lazy body in the spec or the body, never both', async () => {
    let kept = 0;
    for (const found of await allSpecFiles()) {
      if (found.load === undefined) continue;
      const { doc } = await found.load();
      if (doc === undefined) continue;
      kept += 1;
      expect(found.description === undefined || doc.description === undefined, found.name).toBe(true);
      expect(found.man === undefined || doc.man === undefined, found.name).toBe(true);
    }
    // ls, printf, test, rev and the other bodies in a <name>.run.ts of their own.
    expect(kept).toBeGreaterThanOrEqual(13);
  });

  it('lets a spec file replace an extra command of the same name', () => {
    const port = spec('ls', { summary: 'list directory contents' });
    const registry = buildRegistry([spec('ls', { summary: 'stand-in' }), spec('cat')], [port]);
    expect(registry.get('ls')).toBe(port);
    expect(registry.get('cat')?.summary).toBe('cat');
  });

  it('throws on a clash between spec files, or an extra name taken by an alias', () => {
    expect(() => buildRegistry([], [spec('ls'), spec('ls')])).toThrow("'ls' is already registered");
    expect(() => buildRegistry([spec('dir')], [spec('ls', { aliases: ['dir'] })])).toThrow("'dir' is already registered as an alias of 'ls'");
  });
});
