import { describe, expect, it, vi } from 'vitest';
import { CATEGORY_ORDER, CommandRegistry, catalogueFailure, editDistance, settleCommands } from './registry';
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

    it('never guesses a command that opens a page, takes over the page, spends data or ends the session', () => {
      const risky = new CommandRegistry([
        spec('repo', { category: 'portfolio', opens: () => 'https://github.com' }),
        spec('email', { category: 'portfolio', opens: () => 'mailto:a@b.c' }),
        spec('whoami', { category: 'portfolio', opens: () => 'https://www.linkedin.com' }),
        spec('poweroff', { category: 'system', interactiveOnly: true }),
        spec('speedtest', { category: 'network', dataCost: { bytes: 6_000_000, confirmOn: ['touch'] } }),
        spec('reset'),
        spec('exit', { aliases: ['logout'] }),
        spec('help'),
        spec('ls'),
        spec('true', { aliases: [':'] }),
      ]);
      expect(risky.suggest('repoo').near).toEqual([]);
      expect(risky.suggest('emial').near).toEqual([]);
      expect(risky.suggest('who').near).toEqual([]);
      expect(risky.suggest('powerof').near).toEqual([]);
      expect(risky.suggest('speedtets').near).toEqual([]);
      expect(risky.suggest('rest').near).toEqual([]);
      expect(risky.suggest('exti').near).toEqual([]);
      expect(risky.suggest('e').near).toEqual([]);
      // Typed in another case, they are still found.
      expect(risky.suggest('Repo').near).toEqual(['repo']);
      expect(risky.suggest('EXIT').near).toEqual(['exit']);
    });

    it('takes a distance of 2 only for five letters or more, with the same first letter', () => {
      const real = new CommandRegistry(['repo', 'email', 'help', 'ls', 'set', 'man', 'qr', 'cat', 'history', 'theme'].map((name) => spec(name)));
      for (const typo of ['grep', 'tail', 'head', 'less', 'sort']) {
        expect(real.suggest(typo).near, typo).toEqual([]);
      }
      expect(real.suggest('hstory').near).toEqual(['history']);
      expect(real.suggest('histry').near).toEqual(['history']);
      expect(real.suggest('hxxxory').near).toEqual([]);
      expect(real.suggest('xistory').near).toEqual(['history']);
      expect(real.suggest('xestory').near).toEqual([]);
    });

    it("says plainly that common Linux commands vesen lacks aren't in vesen yet", () => {
      for (const name of ['awk', 'gawk', 'split', 'install']) {
        expect(registry.suggest(name)).toEqual({ near: [], hint: `${name} isn't in vesen yet.` });
      }
      expect(registry.suggest('egrep')).toEqual({ near: [], hint: "Use 'grep -E' instead." });
    });

    it('no longer calls built commands missing, or vesen editorless', () => {
      // Each is built now; its name falls through to the guesses like any other.
      for (const name of ['grep', 'head', 'tail', 'less', 'more', 'wc', 'sort', 'sed', 'ps', 'top', 'kill', 'chmod', 'find']) {
        expect(registry.suggest(name).hint, name).toBeUndefined();
      }
      expect(registry.suggest('nano').hint).toBeUndefined();
    });

    it('points to what vesen has instead of commands from elsewhere', () => {
      const withTop = new CommandRegistry([...names, 'top'].map((name) => spec(name)));
      expect(withTop.suggest('htop')).toEqual({ near: ['top'] });
      expect(withTop.suggest('btop')).toEqual({ near: ['top'] });
      expect(registry.suggest('nvim')).toMatchObject({ near: ['nano'] });
      expect(registry.suggest('emacs')).toMatchObject({ near: ['nano'] });
      expect(registry.suggest('cls')).toEqual({ near: ['clear'] });
      for (const name of ['apt', 'apt-get', 'yum', 'brew']) {
        expect(registry.suggest(name)).toEqual({ near: [], hint: 'vesen has no package manager.' });
      }
    });

    it('suggests an alternative only once it exists', () => {
      const bare = new CommandRegistry([spec('ls')]);
      expect(bare.suggest('emacs')).toEqual({ near: [], hint: "vesen's editor is nano." });
      expect(bare.suggest('htop').near).toEqual([]);
    });

    it('guesses nothing while the catalogue is missing, since the name may be one of its commands', async () => {
      const failing = new CommandRegistry([spec('ls'), spec('cat'), spec('top')], { catalogue: () => Promise.reject(new Error('offline')) });
      await failing.whenComplete();
      expect(failing.complete).toBe(false);
      expect(failing.suggest('ps')).toEqual({ near: [] });
      expect(failing.suggest('cut')).toEqual({ near: [] });
      // What is certain still holds: another case, and what vesen has instead.
      expect(failing.suggest('LS')).toEqual({ near: ['ls'] });
      expect(failing.suggest('htop')).toEqual({ near: ['top'] });
      const loaded = new CommandRegistry([spec('ls'), spec('cat')]);
      expect(loaded.suggest('ps')).toEqual({ near: ['ls'] });
    });

    it('has a hint for no command that the kernel or the catalogue has', async () => {
      const { buildRegistry, specFiles } = await import('../commands/index');
      const full = buildRegistry([], specFiles());
      await full.whenComplete();
      const every = full.names({ includeHidden: true });
      expect(every).toContain('grep');
      for (const name of every) expect(full.suggest(name).hint, name).toBeUndefined();
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

  describe('the catalogue', () => {
    /** A catalogue loader that settles when the test says. */
    function deferred() {
      const calls: { resolve: (specs: readonly CommandSpec[]) => void; reject: (error: Error) => void }[] = [];
      const load = vi.fn(
        () =>
          new Promise<readonly CommandSpec[]>((resolve, reject) => {
            calls.push({ resolve, reject });
          }),
      );
      return { load, calls };
    }

    it('is complete at once without one', async () => {
      const registry = new CommandRegistry([spec('ls')]);
      expect(registry.complete).toBe(true);
      await registry.whenComplete();
      expect(registry.takeFailure()).toBeUndefined();
    });

    it('loads once, when first asked, and lets every listener know', async () => {
      const { load, calls } = deferred();
      const registry = new CommandRegistry([spec('ls')], { catalogue: load });
      const heard = vi.fn();
      registry.onChange(heard);
      expect(registry.complete).toBe(false);
      expect(load).not.toHaveBeenCalled();
      const first = registry.whenComplete();
      const second = registry.whenComplete();
      expect(load).toHaveBeenCalledTimes(1);
      expect(registry.get('rev')).toBeUndefined();
      calls[0]?.resolve([spec('rev', { category: 'text', aliases: ['ver'] })]);
      await Promise.all([first, second]);
      expect(registry.complete).toBe(true);
      expect(registry.get('ver')?.name).toBe('rev');
      expect(registry.names()).toEqual(['ls', 'rev', 'ver']);
      expect(heard).toHaveBeenCalledTimes(1);
      await registry.whenComplete();
      expect(load).toHaveBeenCalledTimes(1);
    });

    it('reports a failed load once, and tries again when next asked', async () => {
      const { load, calls } = deferred();
      const registry = new CommandRegistry([spec('ls')], { catalogue: load });
      const waiting = registry.whenComplete();
      calls[0]?.reject(new Error('Failed to fetch'));
      await waiting;
      expect(registry.complete).toBe(false);
      expect(registry.takeFailure()).toBe('Failed to fetch');
      expect(registry.takeFailure()).toBeUndefined();
      const again = registry.whenComplete();
      expect(load).toHaveBeenCalledTimes(2);
      // The new attempt has not failed: there is nothing to report.
      expect(registry.takeFailure()).toBeUndefined();
      calls[1]?.resolve([spec('rev')]);
      await again;
      expect(registry.complete).toBe(true);
      expect(registry.get('rev')).toBeDefined();
    });

    it('settles a loader that throws at once as a failure, never a rejection', async () => {
      const registry = new CommandRegistry([], {
        catalogue: () => {
          throw new Error('no chunk');
        },
      });
      await expect(registry.whenComplete()).resolves.toBeUndefined();
      expect(registry.takeFailure()).toBe('no chunk');
    });

    it('lets a catalogue command replace a stand-in, and adds nothing when another name clashes', async () => {
      const registry = new CommandRegistry([spec('ls')], { catalogue: () => Promise.resolve([spec('head', { summary: 'the real head' })]) });
      registry.registerStandIn(spec('head', { aliases: ['first'] }));
      await registry.whenComplete();
      expect(registry.get('head')?.summary).toBe('the real head');
      expect(registry.get('first')).toBeUndefined();

      const clashing = new CommandRegistry([spec('ls')], { catalogue: () => Promise.resolve([spec('rev'), spec('dir', { aliases: ['ls'] })]) });
      await clashing.whenComplete();
      expect(clashing.complete).toBe(false);
      expect(clashing.takeFailure()).toBe("registry: 'ls' is already registered as a command");
      // All or nothing: rev, which did not clash, is not in either.
      expect(clashing.get('rev')).toBeUndefined();
    });

    it('waits for it at most so long, and never past an abort', async () => {
      vi.useFakeTimers();
      try {
        const { load, calls } = deferred();
        const registry = new CommandRegistry([], { catalogue: load });
        const late = settleCommands(registry, undefined, 1000);
        await vi.advanceTimersByTimeAsync(1000);
        await expect(late).resolves.toBe(false);

        const controller = new AbortController();
        const aborted = settleCommands(registry, controller.signal, 1000);
        controller.abort();
        await expect(aborted).resolves.toBe(false);

        const arriving = settleCommands(registry, undefined, 1000);
        calls[0]?.resolve([spec('rev')]);
        await expect(arriving).resolves.toBe(true);
        expect(load).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('words the failure for the visitor', () => {
      expect(catalogueFailure('Failed to fetch')).toBe("Some of vesen's commands could not be loaded (Failed to fetch). The next command will try again.");
    });
  });
});
