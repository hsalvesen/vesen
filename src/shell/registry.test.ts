import { describe, expect, it } from 'vitest';
import { CATEGORY_ORDER, CommandRegistry, editDistance } from './registry';
import type { CommandSpec } from './types';

const spec = (name: string, extra: Partial<CommandSpec> = {}): CommandSpec => ({
  name,
  category: 'files',
  summary: `the ${name} command`,
  run: () => 0,
  ...extra,
});

const names = ['ls', 'cat', 'cd', 'clear', 'help', 'history', 'nano', 'pwd', 'theme', 'fastfetch'];

describe('editDistance', () => {
  it('counts edits, with a swap of neighbours as one', () => {
    expect(editDistance('ls', 'ls')).toBe(0);
    expect(editDistance('lss', 'ls')).toBe(1);
    expect(editDistance('sl', 'ls')).toBe(1);
    expect(editDistance('hlep', 'help')).toBe(1);
    expect(editDistance('kitten', 'sitting')).toBe(3);
    expect(editDistance('', 'abc')).toBe(3);
  });
});

describe('CommandRegistry', () => {
  it('finds commands by name and alias', () => {
    const registry = new CommandRegistry([spec('fastfetch', { aliases: ['neofetch'], category: 'system' })]);
    expect(registry.get('fastfetch')?.name).toBe('fastfetch');
    expect(registry.get('neofetch')?.name).toBe('fastfetch');
  });

  it('never resolves inherited keys', () => {
    const registry = new CommandRegistry([spec('ls')]);
    for (const key of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) expect(registry.get(key)).toBeUndefined();
  });

  it('throws on a duplicate name or alias', () => {
    const registry = new CommandRegistry([spec('ls', { aliases: ['dir'] })]);
    expect(() => registry.register(spec('ls'))).toThrow("'ls' is already registered as a command");
    expect(() => registry.register(spec('dir'))).toThrow("'dir' is already registered as an alias of 'ls'");
    expect(() => registry.register(spec('vdir', { aliases: ['ls'] }))).toThrow(/'ls' is already registered/);
    expect(() => registry.register(spec('twice', { aliases: ['twice'] }))).toThrow('lists the same name twice');
    // A failed registration leaves nothing behind.
    expect(registry.get('vdir')).toBeUndefined();
  });

  it('refuses names a shell could not type', () => {
    const registry = new CommandRegistry();
    for (const name of ['', 'a b', 'a/b', 'a|b', '$x']) expect(() => registry.register(spec(name))).toThrow('not a valid command name');
  });

  it('lists by category, sorted, without hidden commands unless asked', () => {
    const registry = new CommandRegistry([
      spec('theme', { category: 'portfolio' }),
      spec('cat'),
      spec('ls', { aliases: ['dir'] }),
      spec('sl', { category: 'fun', hidden: true }),
    ]);
    expect(registry.list().map((s) => s.name)).toEqual(['cat', 'ls', 'theme']);
    expect(registry.list({ category: 'files' }).map((s) => s.name)).toEqual(['cat', 'ls']);
    expect(registry.list({ includeHidden: true }).map((s) => s.name)).toEqual(['cat', 'ls', 'sl', 'theme']);
    expect(registry.names()).toEqual(['cat', 'dir', 'ls', 'theme']);
    expect(CATEGORY_ORDER[0]).toBe('portfolio');
  });

  describe('suggest', () => {
    const registry = new CommandRegistry(names.map((name) => spec(name)));

    it('offers commands within an edit distance of 2, nearest first', () => {
      expect(registry.suggest('lss').near).toEqual(['ls']);
      expect(registry.suggest('sl').near).toEqual(['ls']);
      expect(registry.suggest('hlep').near).toEqual(['help']);
      expect(registry.suggest('thme').near).toEqual(['theme']);
      expect(registry.suggest('histroy').near).toEqual(['history']);
    });

    it('prefers a match that differs only in case', () => {
      expect(registry.suggest('LS').near).toEqual(['ls']);
      expect(registry.suggest('Theme').near).toEqual(['theme']);
    });

    it('falls back to commands the word begins', () => {
      expect(registry.suggest('fastf').near).toEqual(['fastfetch']);
    });

    it('offers nothing for a word near nothing', () => {
      expect(registry.suggest('qqqq')).toEqual({ near: [] });
      expect(registry.suggest('constructor')).toEqual({ near: [] });
    });

    it('points to what vesen has instead of commands from elsewhere', () => {
      expect(registry.suggest('vim')).toEqual({ near: ['nano'] });
      expect(registry.suggest('vi')).toEqual({ near: ['nano'] });
      expect(registry.suggest('cls')).toEqual({ near: ['clear'] });
      for (const name of ['apt', 'apt-get', 'yum', 'brew']) {
        expect(registry.suggest(name)).toEqual({ near: [], hint: 'vesen has no package manager.' });
      }
    });

    it('suggests an alternative only once it exists', () => {
      const bare = new CommandRegistry([spec('ls')]);
      expect(bare.suggest('vim')).toEqual({ near: [] });
    });
  });

  describe('validate', () => {
    it('finds long summaries, misplaced variadics, flag mistakes and examples that do not lex', () => {
      const registry = new CommandRegistry([
        spec('long', { summary: 'x'.repeat(51) }),
        spec('args', {
          args: [
            { name: 'A', source: { kind: 'int' }, variadic: true },
            { name: 'B', source: { kind: 'int' } },
          ],
        }),
        spec('flags', {
          flags: [
            { short: 'a', description: '' },
            { short: 'a', long: 'all', description: 'again' },
          ],
        }),
        spec('examples', { examples: [{ line: 'echo "open' }] }),
        spec('fine', { examples: [{ line: 'fine | cat' }] }),
      ]);
      expect(registry.validate()).toEqual([
        'long: summary is longer than 50 characters',
        'args: only the last argument may be variadic (A)',
        'flags: flag a has no description',
        'flags: flag -a is defined twice',
        "examples: example 'echo \"open' does not lex",
      ]);
    });
  });
});
