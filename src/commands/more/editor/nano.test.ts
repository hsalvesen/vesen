// nano, and vi and vim, which open it (wave F): what the editor is handed for a new, an existing,
// an unwritable and an unreadable file, and its writes, which go through the file system as the
// visitor, so permissions apply and the file is there for cat afterwards.
import { describe, expect, it, vi } from 'vitest';
import { runLine, session } from '../../../../tests/harness';
import { EDITOR_CLOSED, type EditorView, type SaveResult } from '../../../lib/nano';
import { createStorage } from '../../../services/storage';
import { createAppRunner } from '../../../shell/apps';
import { MAX_KEPT, MAX_KEPT_CHARS } from '../../lib/nano-keep';
import { readOperands } from './nano.run';

/**
 * A screen that shows the editor, lets `edit` act as the visitor (typing, then saving with the
 * view's own save), records what was shown and saved, and leaves.
 */
function editorScreen(edit: (view: EditorView) => SaveResult[] = () => [], loads = true) {
  const shown: { view: string; props: EditorView }[] = [];
  const saves: SaveResult[] = [];
  const fullscreen = vi.fn(async (view: string, props: unknown) => {
    const editor = props as EditorView;
    shown.push({ view, props: editor });
    saves.push(...edit(editor));
    return loads ? EDITOR_CLOSED : undefined;
  });
  return { shown, saves, fullscreen };
}

describe('nano', () => {
  it('opens a new file, saves what was typed, and cat shows it after', async () => {
    const screen = editorScreen((view) => [view.save(view.name ?? '', 'hello from nano\n')]);
    const s = await session({ fullscreen: screen.fullscreen });
    const result = await s.run('nano notes.txt');
    expect(result).toMatchObject({ status: 0, stdoutPlain: '', stderrPlain: '' });
    expect(screen.shown[0]?.view).toBe('editor');
    expect(screen.shown[0]?.props).toMatchObject({ name: 'notes.txt', text: '', message: '[ New File ]', touch: false });
    expect(screen.saves).toEqual([{ ok: true, name: 'notes.txt', message: '[ Wrote 1 line ]' }]);
    expect((await s.run('cat notes.txt')).stdoutPlain).toBe('hello from nano');
    // The file is the visitor's, like any other they make.
    expect((await s.run('stat -c %U notes.txt')).stdoutPlain).toBe('guest');
    s.stop();
  });

  it('opens an existing file with its text, and says how many lines it read', async () => {
    const screen = editorScreen();
    await runLine('nano .bashrc', { fullscreen: screen.fullscreen, touch: true });
    const cat = await runLine('cat .bashrc', { tty: false });
    const props = screen.shown[0]?.props;
    expect(props?.text.replace(/\n$/, '')).toBe(cat.stdoutPlain);
    expect(props?.message).toMatch(/^\[ Read \d+ lines \]$/);
    expect(props?.touch).toBe(true);
  });

  it('writes a new buffer under the name the visitor gives it, ~ included', async () => {
    const screen = editorScreen((view) => [view.save('~/drafts.txt', 'a\nb\n')]);
    const s = await session({ fullscreen: screen.fullscreen });
    await s.run('cd /tmp; nano');
    expect(screen.shown[0]?.props).toMatchObject({ name: null, text: '', message: '' });
    expect(screen.saves).toEqual([{ ok: true, name: '~/drafts.txt', message: '[ Wrote 2 lines ]' }]);
    expect((await s.run('cat ~/drafts.txt')).stdoutPlain).toBe('a\nb');
    s.stop();
  });

  it('warns about a file the visitor cannot change, and saving it says [ File is unwritable ]', async () => {
    const screen = editorScreen((view) => [view.save(view.name ?? '', 'hacked\n'), view.save('/etc/new.conf', 'x\n')]);
    const s = await session({ fullscreen: screen.fullscreen });
    await s.run('nano /etc/hostname');
    expect(screen.shown[0]?.props.message).toBe("[ File '/etc/hostname' is unwritable ]");
    expect(screen.saves).toEqual([
      { ok: false, message: '[ File is unwritable ]' },
      { ok: false, message: '[ File is unwritable ]' },
    ]);
    expect((await s.run('cat /etc/hostname')).stdoutPlain).toBe('vesen');
    expect((await s.run('ls /etc/new.conf')).status).not.toBe(0);
    s.stop();
  });

  it('opens an unreadable file empty, saying why, and reports other write errors in their words', async () => {
    const screen = editorScreen((view) => [view.save('nope/x.txt', 'x\n'), view.save('documents', 'x\n')]);
    await runLine('nano /etc/shadow', { fullscreen: screen.fullscreen });
    expect(screen.shown[0]?.props).toMatchObject({ text: '', message: '[ Error reading /etc/shadow: Permission denied ]' });
    expect(screen.saves).toEqual([
      { ok: false, message: '[ Error writing nope/x.txt: No such file or directory ]' },
      { ok: false, message: '[ Error writing documents: Is a directory ]' },
    ]);
  });

  it('puts the caret where +LINE,COLUMN says', async () => {
    const screen = editorScreen();
    await runLine('nano +3,2 .bashrc', { fullscreen: screen.fullscreen });
    expect(screen.shown[0]?.props).toMatchObject({ name: '.bashrc', line: 3, column: 2 });
    expect(readOperands(['+5'])).toEqual({ file: null, line: 5 });
    expect(readOperands(['+', 'x'])).toEqual({ file: 'x' });
    expect(readOperands(['a', 'b'])).toEqual({ error: 'one FILE at a time' });
  });

  it('refuses a folder and a second FILE before it opens', async () => {
    const screen = editorScreen();
    expect(await runLine('nano documents', { fullscreen: screen.fullscreen })).toMatchObject({ status: 1, stderrPlain: 'nano: documents: Is a directory' });
    expect(await runLine('nano a b', { fullscreen: screen.fullscreen })).toMatchObject({
      status: 1,
      stderrPlain: "nano: one FILE at a time\nTry 'nano --help' for more information.",
    });
    expect(screen.fullscreen).not.toHaveBeenCalled();
  });

  it('runs only at the prompt, never from a pipe or a script', async () => {
    const screen = editorScreen();
    expect(await runLine('nano x | cat', { fullscreen: screen.fullscreen })).toMatchObject({ stderrPlain: 'nano: only at the prompt' });
    expect(await runLine('X=$(nano x)', { fullscreen: screen.fullscreen })).toMatchObject({ status: 1 });
    expect(screen.fullscreen).not.toHaveBeenCalled();
  });

  it('says so when the editor could not load', async () => {
    const screen = editorScreen(() => [], false);
    expect(await runLine('nano x', { fullscreen: screen.fullscreen })).toMatchObject({ status: 1, stderrPlain: 'nano: the editor could not be opened' });
  });

  it('is interrupted by ^C while it shows', async () => {
    const apps = createAppRunner();
    const s = await session({ fullscreen: (view, props) => apps.open(view, props) });
    const handle = s.app.shell.start('nano notes.txt');
    await vi.waitFor(() => expect(apps.request.get()?.view).toBe('editor'));
    handle.abort();
    expect((await handle.done).status).toBe(130);
    s.stop();
  });

  it('answers to editor and edit too', async () => {
    const screen = editorScreen();
    await runLine('editor a.txt', { fullscreen: screen.fullscreen });
    await runLine('edit b.txt', { fullscreen: screen.fullscreen });
    expect(screen.shown.map((shown) => shown.props.name)).toEqual(['a.txt', 'b.txt']);
  });
});

describe('vi and vim', () => {
  it.each(['vi', 'vim'])('%s says vesen has none, then opens nano on the file', async (name) => {
    const screen = editorScreen((view) => [view.save(view.name ?? '', 'typed in nano\n')]);
    const s = await session({ fullscreen: screen.fullscreen });
    const result = await s.run(`${name} notes.txt`);
    expect(result).toMatchObject({ status: 0, stderrPlain: `vesen has no ${name}; opening nano` });
    expect(screen.shown[0]).toMatchObject({ view: 'editor', props: { name: 'notes.txt' } });
    expect((await s.run('cat notes.txt')).stdoutPlain).toBe('typed in nano');
    s.stop();
  });

  it('is left out of help and the first Tab list, but has a man page', async () => {
    expect((await runLine('help', { tty: false })).stdoutPlain).toMatch(/^Editor: less more nano$/m);
    expect((await runLine('man vim', { tty: false })).stdoutPlain).toContain('vi, vim - open nano, since vesen has no vi');
  });
});

// What the editor keeps when Back, or leaving the page, might lose an unsaved buffer (Editor.svelte
// calls the view's keep): the next nano of that file offers it back, as nano's .save files do.
describe("nano's kept buffers", () => {
  const DAY = 86_400_000;

  /** A screen whose editor does `edit` with each view it is shown. */
  function keeping(edit: (view: EditorView, round: number) => void) {
    const shown: EditorView[] = [];
    const fullscreen = vi.fn(async (_view: string, props: unknown) => {
      const view = props as EditorView;
      shown.push(view);
      edit(view, shown.length);
      return EDITOR_CLOSED;
    });
    return { shown, fullscreen };
  }

  it('offers a kept buffer at the next nano of that file, by whatever name, and nowhere else', async () => {
    const editor = keeping((view, round) => {
      if (round === 1) view.keep?.(view.name, 'unsaved words\n');
    });
    const s = await session({ fullscreen: editor.fullscreen, storage: createStorage(null).local });
    await s.run('nano notes.txt');
    expect(editor.shown[0]?.kept).toBeUndefined();
    await s.run('nano ~/notes.txt');
    expect(editor.shown[1]?.kept).toBe('unsaved words\n');
    await s.run('cd /tmp; nano ../home/guest/notes.txt');
    expect(editor.shown[2]?.kept).toBe('unsaved words\n');
    await s.run('nano notes.txt');
    expect(editor.shown[3]?.kept).toBeUndefined();
    s.stop();
  });

  it('keeps a new buffer with no name for the next nano with none', async () => {
    const editor = keeping((view, round) => {
      if (round === 1) view.keep?.(null, 'scratch');
    });
    const s = await session({ fullscreen: editor.fullscreen, storage: createStorage(null).local });
    await s.run('nano');
    await s.run('nano notes.txt');
    await s.run('nano');
    expect(editor.shown.map((view) => view.kept)).toEqual([undefined, undefined, 'scratch']);
    s.stop();
  });

  it('forgets a kept buffer the editor lets go of, one the file already holds, and one over 30 days old', async () => {
    let now = Date.UTC(2026, 9, 6, 9, 0, 0);
    const editor = keeping((view, round) => {
      if (round === 1) view.keep?.(view.name, 'first\n');
      if (round === 2) view.keep?.(view.name, null);
      if (round === 4) view.save(view.name ?? '', 'second\n');
      if (round === 4) view.keep?.(view.name, 'second\n');
      if (round === 6) view.keep?.(view.name, 'third\n');
    });
    const s = await session({ fullscreen: editor.fullscreen, storage: createStorage(null).local, now: () => now });
    await s.run('nano a.txt');
    await s.run('nano a.txt');
    await s.run('nano a.txt');
    expect(editor.shown[1]?.kept).toBe('first\n');
    // Let go of in round 2.
    expect(editor.shown[2]?.kept).toBeUndefined();
    await s.run('nano a.txt');
    await s.run('nano a.txt');
    // The file holds what was kept: nothing to offer.
    expect(editor.shown[4]?.kept).toBeUndefined();
    await s.run('nano a.txt');
    now += 31 * DAY;
    await s.run('nano a.txt');
    expect(editor.shown[6]?.kept).toBeUndefined();
    s.stop();
  });

  it('forgets every kept buffer at reset, as it forgets the files', async () => {
    const editor = keeping((view, round) => {
      if (round === 1) view.keep?.(view.name, 'unsaved\n');
    });
    const s = await session({ fullscreen: editor.fullscreen, storage: createStorage(null).local });
    await s.run('nano notes.txt');
    await s.run('reset');
    await s.run('nano notes.txt');
    expect(editor.shown[1]?.kept).toBeUndefined();
    s.stop();
  });

  it('keeps the newest few, within a size a browser can store', async () => {
    const seen = new Set<string | null>();
    const editor = keeping((view) => {
      if (seen.has(view.name)) return;
      seen.add(view.name);
      view.keep?.(view.name, view.name === 'big.txt' ? 'x'.repeat(MAX_KEPT_CHARS + 1) : `${view.name ?? ''}\n`);
    });
    const s = await session({ fullscreen: editor.fullscreen, storage: createStorage(null).local });
    for (let i = 0; i <= MAX_KEPT; i += 1) await s.run(`nano f${i}`);
    await s.run('nano big.txt');
    await s.run('nano big.txt');
    for (let i = 0; i <= MAX_KEPT; i += 1) await s.run(`nano f${i}`);
    const offered = editor.shown.slice(-(MAX_KEPT + 1)).map((view) => view.kept);
    // The oldest gave way to the newest.
    expect(offered).toEqual([undefined, ...Array.from({ length: MAX_KEPT }, (_, i) => `f${i + 1}\n`)]);
    expect(editor.shown[MAX_KEPT + 2]?.kept).toBeUndefined();
    s.stop();
  });
});
