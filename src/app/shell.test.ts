import { describe, expect, it, vi } from 'vitest';
import { lineText, out, type Line } from '../output/model';
import { createStorage } from '../services/storage';
import { STORAGE_KEYS } from '../services/storage-keys';
import { promptText } from '../shell/prompt';
import { stubCommands } from '../testing/shell-harness';
import { createScreen, type ScreenEntry } from '../stores/screen';
import { MEMORY_NOTICE } from '../vfs/persist';
import type { KV } from '../services/types';
import { MAX_SCRIPT_DEPTH } from '../shell/executor';
import { createAppShell, SAFE_MODE_NOTICE, transcriptScreen } from './shell';

const PROMPT: Line = [{ text: 'guest@vesen:~$' }];

/** localStorage as a Map. */
function memoryStorage() {
  const items = new Map<string, string>();
  const area = {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  } as unknown as Storage;
  const storage = createStorage({ localStorage: area, sessionStorage: area });
  return { local: storage.local, session: storage.session, items };
}

/** What an entry shows: its prompt and line, then its output's text. */
function shown(entry: ScreenEntry): string[] {
  const rows = entry.prompt === null ? [] : [`${promptText(entry.prompt)} ${entry.line}`];
  for (const block of entry.blocks) {
    if (block.type === 'lines') rows.push(...block.lines.map(lineText));
  }
  return rows;
}

describe('the transcript as the screen', () => {
  const setup = () => {
    const screen = createScreen(() => 5);
    const sink = transcriptScreen(screen, () => [out.text('BANNER')], () => PROMPT);
    const commit = (line: string, action: 'keep' | 'clear' | 'reset', text?: string, prompt: Line = PROMPT) =>
      sink.commit({
        id: 1,
        line,
        origin: 'keyboard',
        status: 0,
        interrupted: false,
        screen: action,
        blocks: text ? [out.text(text)] : [],
        prompt,
        startedAt: 1,
        endedAt: 2,
      });
    return { screen, commit };
  };

  it('adds an entry for each line, with the prompt it was typed at and its blocks', () => {
    const { screen, commit } = setup();
    commit('echo hi', 'keep', 'hi');
    commit('true', 'keep', undefined, [{ text: 'guest@vesen:/etc$' }]);
    expect(screen.entries().map(shown)).toEqual([['guest@vesen:~$ echo hi', 'hi'], ['guest@vesen:/etc$ true']]);
    expect(screen.entries()[0]).toMatchObject({ state: 'done', status: 0, origin: 'keyboard', startedAt: 1, endedAt: 2 });
  });

  it('empties the screen for clear, keeping what came after without its prompt line', () => {
    const { screen, commit } = setup();
    commit('echo hi', 'keep', 'hi');
    commit('clear', 'clear');
    expect(screen.entries()).toEqual([]);
    commit('clear; ls', 'clear', 'README.md');
    expect(screen.entries().map(shown)).toEqual([['README.md']]);
  });

  it('puts the banner back for reset', () => {
    const { screen, commit } = setup();
    commit('echo hi', 'keep', 'hi');
    commit('reset', 'reset');
    expect(screen.entries().map(shown)).toEqual([['guest@vesen:~$ banner', 'BANNER']]);
  });
});

describe('createAppShell', () => {
  const build = (storage: ReturnType<typeof memoryStorage>['local'] | null = null) => {
    const screen = createScreen();
    // The kernel's stand-ins for echo and cat; the spec files' cd, pwd and reset win over theirs.
    const app = createAppShell({ banner: () => [out.text('BANNER')], specs: stubCommands(), storage, screen, version: '2.0.0', yieldToHost: () => Promise.resolve() });
    return { app, screen };
  };

  it('records each line in the transcript with the prompt it was typed at (F023)', async () => {
    const { app, screen } = build();
    await app.shell.run('nope');
    await app.shell.run('cd /etc');
    await app.shell.run('cd /home/guest/documents');
    await app.shell.run('pwd');
    const prompts = screen.entries().map((entry) => (entry.prompt === null ? null : promptText(entry.prompt)));
    // nope failed, so the next prompt's $ is red; the text is the same.
    expect(prompts).toEqual(['guest@vesen:~$', 'guest@vesen:~$', 'guest@vesen:/etc$', 'guest@vesen:~/documents$']);
    expect(screen.entries()[1]?.prompt?.[5]?.style?.fg).toBe('error');
    expect(screen.entries()[2]?.prompt?.[5]?.style?.fg).toBe('fg-strong');
    expect(promptText(app.shell.renderPrompt())).toBe('guest@vesen:~/documents$');
    app.stop();
  });

  it('seeds the VFS from the registry, with the visitor at home', async () => {
    const { app } = build();
    expect(app.vfs.readdir('/usr/bin')).toEqual(expect.arrayContaining(['cd', 'pwd', 'reset', 'alias', 'export']));
    expect(app.vfs.readFile('/etc/os-release')).toContain('VERSION="2.0.0"');
    expect(app.shell.cwd.get()).toBe('/home/guest');
    app.stop();
  });

  it('sources ~/.bashrc at boot, quietly, so ll and the exports work (F072)', async () => {
    const { app, screen } = build();
    await app.boot();
    expect(app.shell.aliases.get('ll')).toBe('ls -la');
    expect(app.shell.aliases.get('la')).toBe('ls -A');
    expect(app.shell.aliases.get('l')).toBe('ls -CF');
    expect(app.shell.env.get('EDITOR')).toBe('nano');
    expect(app.shell.env.isExported('PATH')).toBe(true);
    expect(app.shell.history.list()).toEqual([]);
    expect(screen.entries()).toEqual([]);
    app.stop();
  });

  it('runs the scripts in ~/bin from $PATH, and /bin/pwd through its stub', async () => {
    const { app, screen } = build();
    await app.boot();
    await app.shell.run('my-script');
    await app.shell.run('cd /etc; /bin/pwd');
    await app.shell.run('~/README.md');
    const outputs = screen.entries().map((entry) => shown(entry).slice(1));
    expect(outputs).toEqual([['Personal script executed'], ['/etc'], ['vesen: /home/guest/README.md: Permission denied']]);
    app.stop();
  });

  it('keeps the files under ~ across a reload, and reset restores the seed', async () => {
    const { local, items } = memoryStorage();
    const first = build(local);
    await first.app.boot();
    await first.app.shell.run('echo kept > note.txt');
    first.app.persistence.flush();
    first.app.stop();
    expect(items.has(STORAGE_KEYS.fs.key)).toBe(true);

    const second = build(local);
    await second.app.boot();
    expect((await second.app.shell.run('cat note.txt')).status).toBe(0);
    expect(second.app.vfs.readFile('/home/guest/note.txt')).toBe('kept\n');
    expect(second.app.shell.history.list().map((entry) => entry.line)).toEqual(['echo kept > note.txt', 'cat note.txt']);

    await second.app.shell.run('reset');
    second.app.persistence.flush();
    expect(second.app.vfs.exists('/home/guest/note.txt')).toBe(false);
    expect(second.app.shell.history.list()).toEqual([]);
    expect(items.has(STORAGE_KEYS.fs.key)).toBe(false);
    second.app.stop();
  });

  it('loads the bodies of lazy commands ahead of their first run, and survives one that fails', async () => {
    const load = vi.fn(async () => ({ run: () => 0 }));
    const broken = vi.fn(() => Promise.reject(new Error('offline')));
    const app = createAppShell({
      banner: () => [],
      specs: [
        ...stubCommands(),
        { name: 'lazy', category: 'shell', summary: 'x', load },
        { name: 'broken', category: 'shell', summary: 'x', load: broken },
      ],
      screen: createScreen(),
      version: '0.0.0',
      yieldToHost: () => Promise.resolve(),
    });
    expect(await app.prefetch()).toBe(true);
    expect(load).toHaveBeenCalledTimes(1);
    expect(broken).toHaveBeenCalledTimes(1);
    expect((await app.shell.run('lazy')).status).toBe(0);
    app.stop();
  });

  it('fetches nothing ahead on Data Saver or mobile data', async () => {
    for (const connection of [{ saveData: true, type: 'wifi' }, { type: 'cellular' }, { effectiveType: '3g' }]) {
      const load = vi.fn(async () => ({ run: () => 0 }));
      const app = createAppShell({
        banner: () => [],
        specs: [...stubCommands(), { name: 'lazy', category: 'shell', summary: 'x', load }],
        screen: createScreen(),
        version: '0.0.0',
        sysHost: {
          navigator: { userAgent: 'test', languages: ['en-AU'], hardwareConcurrency: 4, connection },
          screen: { width: 390, height: 844, colorDepth: 24 },
          devicePixelRatio: 3,
        },
        yieldToHost: () => Promise.resolve(),
      });
      expect(await app.prefetch(), JSON.stringify(connection)).toBe(false);
      expect(load).not.toHaveBeenCalled();
      // The first run still loads it.
      expect((await app.shell.run('lazy')).status).toBe(0);
      expect(load).toHaveBeenCalledTimes(1);
      app.stop();
    }
  });

  it('says once, dimly, that nothing is kept when there is no storage', async () => {
    const { app, screen } = build(null);
    await app.boot();
    await app.shell.run('echo a > a.txt; echo b > b.txt');
    app.persistence.save();
    app.persistence.save();
    const notices = screen.entries().filter((entry) => entry.prompt === null);
    expect(notices.map(shown)).toEqual([[MEMORY_NOTICE]]);
    expect(notices[0]?.blocks[0]).toMatchObject({ type: 'lines', lines: [[{ style: { fg: 'muted' } }]] });
    app.stop();
  });
});

describe('boot', () => {
  it('interrupts a ~/.bashrc that never ends, so the shell still starts', async () => {
    const screen = createScreen();
    const hang = { name: 'hang', category: 'shell' as const, summary: 'never finish', run: () => new Promise<number>(() => {}) };
    const app = createAppShell({ banner: () => [], specs: [...stubCommands(), hang], screen, version: '0.0.0', yieldToHost: () => Promise.resolve() });
    app.vfs.writeFile('/home/guest/.bashrc', 'alias before=1\nhang\nalias after=1\n');
    const started = Date.now();
    const status = await app.shell.source('~/.bashrc', { quiet: true, timeoutMs: 50 });
    expect(status).toBe(130);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(app.shell.aliases.get('before')).toBe('1');
    expect(app.shell.aliases.has('after')).toBe(false);
    expect((await app.shell.run('alias before')).status).toBe(0);
    app.stop();
  });
});

describe('boot safety', () => {
  /** A shell that yields to real timers, as the browser's does. */
  const real = (sessionStorage: KV<'session'> | null = null, extra: ReturnType<typeof stubCommands> = []) => {
    const screen = createScreen();
    const app = createAppShell({ banner: () => [], specs: [...stubCommands(), ...extra], screen, version: '0.0.0', sessionStorage });
    return { app, screen };
  };

  it('stops a ~/.bashrc that sources itself at the nesting limit', async () => {
    const { app } = real();
    app.vfs.writeFile('/home/guest/.bashrc', 'X=$((X+1))\nsource ~/.bashrc\nalias after=1\n');
    const status = await app.shell.source('~/.bashrc', { quiet: true, timeoutMs: 5000 });
    expect(status).toBe(0);
    expect(app.shell.env.get('X')).toBe(String(MAX_SCRIPT_DEPTH));
    expect(app.shell.aliases.get('after')).toBe('1');
    expect((await app.shell.run('source ~/.bashrc')).blocks).toContainEqual(
      expect.objectContaining({ type: 'lines', stream: 'stderr', lines: [[expect.objectContaining({ text: 'vesen: source: /home/guest/.bashrc: maximum nesting level exceeded' })]] }),
    );
    app.stop();
  });

  it('gives timers, ^C and the boot deadline a turn while a script runs itself over and over', async () => {
    const { app } = real();
    // Three calls a level, sixteen levels deep: 3^16 runs, far too many to finish.
    app.vfs.writeFile('/home/guest/bin/s', 's\ns\ns\n', { mode: 0o755 });
    let ticks = 0;
    const timer = setInterval(() => (ticks += 1), 5);
    try {
      const handle = app.shell.start('PATH=~/bin:$PATH; s');
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(ticks).toBeGreaterThan(0);
      handle.abort();
      expect((await handle.done).status).toBe(130);

      // At boot, the deadline stops it.
      app.vfs.writeFile('/home/guest/.bashrc', 'PATH=~/bin:$PATH\ns\n');
      const started = Date.now();
      expect(await app.shell.source('~/.bashrc', { quiet: true, timeoutMs: 100 })).toBe(130);
      expect(Date.now() - started).toBeLessThan(2000);
    } finally {
      clearInterval(timer);
      app.stop();
    }
  });

  it('skips ~/.bashrc, and says so, when the last load never finished reading it', async () => {
    const { session } = memoryStorage();
    const first = real(session);
    first.app.vfs.writeFile('/home/guest/.bashrc', 'alias mine=1\n');
    await first.app.boot();
    // A boot that finishes leaves no marker, so the next one reads ~/.bashrc as usual.
    expect(session.get(STORAGE_KEYS.boot.key)).toBeNull();
    expect(first.app.shell.aliases.get('mine')).toBe('1');
    first.app.stop();

    // A load that froze in ~/.bashrc left the marker behind.
    session.set(STORAGE_KEYS.boot.key, '1');
    const second = real(session);
    second.app.vfs.writeFile('/home/guest/.bashrc', 'alias mine=1\n');
    await second.app.boot();
    expect(second.app.shell.aliases.has('mine')).toBe(false);
    expect(second.app.shell.env.get('EDITOR')).toBe('nano');
    expect(second.screen.entries().map(shown)).toEqual([[SAFE_MODE_NOTICE]]);
    expect(session.get(STORAGE_KEYS.boot.key)).toBeNull();
    second.app.stop();
  });

  it('never runs a command that takes over the page from ~/.bashrc', async () => {
    const takeover = vi.fn(() => 0);
    const { app, screen } = real(null, [{ name: 'takeover', category: 'system', summary: 'x', interactiveOnly: true, run: takeover }]);
    app.vfs.writeFile('/home/guest/.bashrc', 'alias before=1\ntakeover\npoweroff\nalias after=1\n');
    await app.boot();
    expect(takeover).not.toHaveBeenCalled();
    expect(app.shell.aliases.get('after')).toBe('1');
    // poweroff's own spec is one such command too: nothing was shut down.
    expect(screen.entries().flatMap(shown).join('\n')).not.toMatch(/shut ?down/i);
    app.stop();
  });
});
