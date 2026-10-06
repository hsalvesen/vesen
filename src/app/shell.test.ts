import { describe, expect, it } from 'vitest';
import { lineText, out, type Line } from '../output/model';
import { createStorage } from '../services/storage';
import { STORAGE_KEYS } from '../services/storage-keys';
import { promptText } from '../shell/prompt';
import { stubCommands } from '../testing/shell-harness';
import { createScreen, type ScreenEntry } from '../stores/screen';
import { MEMORY_NOTICE } from '../vfs/persist';
import { createAppShell, transcriptScreen } from './shell';

const PROMPT: Line = [{ text: 'guest@vesen:~$' }];

/** localStorage as a Map. */
function memoryStorage() {
  const items = new Map<string, string>();
  const area = {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  } as unknown as Storage;
  return { local: createStorage({ localStorage: area, sessionStorage: area }).local, items };
}

/** What an entry shows: its prompt and line, then its output's text. */
function shown(entry: ScreenEntry): string[] {
  const rows = entry.prompt === null ? [] : [`${promptText(entry.prompt)} ${entry.line}`];
  for (const block of entry.blocks) {
    if (block.type === 'lines') rows.push(...block.lines.map(lineText));
    else if (block.type === 'legacyHtml') rows.push(`<html>${block.html}`);
  }
  return rows;
}

describe('the transcript as the screen', () => {
  const setup = () => {
    const screen = createScreen(() => 5);
    const sink = transcriptScreen(screen, () => 'BANNER', () => PROMPT);
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
    expect(screen.entries().map(shown)).toEqual([['guest@vesen:~$ banner', '<html>BANNER']]);
  });
});

describe('createAppShell', () => {
  const build = (storage: ReturnType<typeof memoryStorage>['local'] | null = null) => {
    const screen = createScreen();
    // The kernel's stand-ins for echo and cat; the spec files' cd, pwd and reset win over theirs.
    const app = createAppShell({ banner: () => 'BANNER', specs: stubCommands(), storage, screen, version: '2.0.0', yieldToHost: () => Promise.resolve() });
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
    const app = createAppShell({ banner: () => '', specs: [...stubCommands(), hang], screen, version: '0.0.0', yieldToHost: () => Promise.resolve() });
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
