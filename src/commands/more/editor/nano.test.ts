// nano, and vi and vim, which open it (wave F): what the editor is handed for a new, an existing,
// an unwritable and an unreadable file, and its writes, which go through the file system as the
// visitor, so permissions apply and the file is there for cat afterwards.
import { describe, expect, it, vi } from 'vitest';
import { runLine, session } from '../../../../tests/harness';
import { EDITOR_CLOSED, type EditorView, type SaveResult } from '../../../lib/nano';
import { createAppRunner } from '../../../shell/apps';
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
