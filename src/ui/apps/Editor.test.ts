// The editor (wave F): type, ^O and Enter to write out, ^X to leave; 'Save modified buffer?' with
// Y, N and ^C; [ File is unwritable ] from a refused write; ^S, ^W, ^K and ^U, ^C and ^G; and on
// a touch screen a toolbar of Save, Exit, Find, Cut and Paste over the native textarea. Every
// key is an ordinary key event: the editor's prompts are its own, never the terminal's.
import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import { EDITOR_CLOSED, type EditorView, type SaveResult } from '../../lib/nano';
import Editor from './Editor.svelte';

/** A file system of one: saves land in `files`, and names in `locked` refuse them. */
function open(extra: Partial<EditorView> = {}, locked: readonly string[] = []) {
  const files = new Map<string, string>();
  const save = vi.fn((name: string, text: string): SaveResult => {
    if (locked.includes(name)) return { ok: false, message: '[ File is unwritable ]' };
    files.set(name, text);
    const lines = text.split('\n').length - 1;
    return { ok: true, name, message: `[ Wrote ${lines} line${lines === 1 ? '' : 's'} ]` };
  });
  const close = vi.fn();
  const view: EditorView = { name: 'notes.txt', text: '', message: '[ New File ]', touch: false, save, ...extra };
  const result = render(Editor, { props: { props: view, close } });
  const area = () => screen.getByRole('textbox', { name: /Editing|New buffer/ }) as HTMLTextAreaElement;
  const title = () => result.container.querySelector('.title')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const status = () => result.container.querySelector('.status-line')?.textContent?.trim() ?? '';
  return { ...result, files, save, close, area, title, status };
}

async function type(area: HTMLTextAreaElement, value: string, caret = value.length): Promise<void> {
  await fireEvent.input(area, { target: { value } });
  area.setSelectionRange(caret, caret);
}

async function key(target: Element | Window, name: string, init: KeyboardEventInit = {}): Promise<void> {
  await fireEvent.keyDown(target, { key: name, ...init });
  await tick();
}

const ctrl = (target: Element, letter: string) => key(target, letter, { ctrlKey: true });

/** Answers the prompt at the bottom and presses Enter. */
async function answer(text?: string): Promise<void> {
  const box = screen.getByRole('textbox', { name: /File Name to Write|Search/ }) as HTMLInputElement;
  if (text !== undefined) await fireEvent.input(box, { target: { value: text } });
  await fireEvent.submit(box.form as HTMLFormElement);
  await tick();
}

describe('Editor', () => {
  it("shows the file's name and nano's first word on it, with the shortcuts along the bottom", () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
    const { title, status, area } = open();
    expect(title()).toBe('vesen nano notes.txt');
    expect(status()).toBe('[ New File ]');
    expect(area().value).toBe('');
    const keys = Array.from(document.querySelectorAll('.shortcut')).map((shortcut) => shortcut.textContent?.replace(/\s+/g, ' '));
    expect(keys).toEqual(['^G Help', '^O Write Out', '^W Where Is', '^K Cut', '^C Location', '^X Exit', '^S Save', '^F Find', '^U Paste']);
    expect(screen.queryByRole('toolbar')).toBeNull();
    vi.restoreAllMocks();
  });

  it('offers ^F for Where Is off a Mac, where Ctrl+W closes the tab, and ^W still finds', async () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Win32');
    try {
      const { area } = open({ text: 'x needle y' });
      const keys = Array.from(document.querySelectorAll('.shortcut')).map((shortcut) => shortcut.textContent?.replace(/\s+/g, ' '));
      expect(keys).toEqual(['^G Help', '^O Write Out', '^F Where Is', '^K Cut', '^C Location', '^X Exit', '^S Save', '^U Paste']);
      expect(keys.some((key) => key?.startsWith('^W'))).toBe(false);
      // Where the browser lets ^W through, it is still Where Is.
      await ctrl(area(), 'w');
      expect(screen.getByRole('textbox', { name: 'Search:' })).toBeInTheDocument();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('puts the caret in the text, where +LINE,COLUMN asks', async () => {
    const { area } = open({ text: 'one\ntwo\nthree\n', line: 2, column: 3 });
    await vi.waitFor(() => expect(document.activeElement).toBe(area()));
    expect(area().selectionStart).toBe(6);
  });

  it('types, writes out with ^O and Enter, and leaves with ^X', async () => {
    const { area, title, status, save, files, close } = open();
    await type(area(), 'hello');
    expect(title()).toBe('vesen nano notes.txt Modified');
    await ctrl(area(), 'o');
    const box = screen.getByRole('textbox', { name: 'File Name to Write:' }) as HTMLInputElement;
    expect(box.value).toBe('notes.txt');
    expect(document.activeElement).toBe(box);
    await answer();
    // nano ends the file with a newline.
    expect(save).toHaveBeenCalledWith('notes.txt', 'hello\n');
    expect(files.get('notes.txt')).toBe('hello\n');
    expect(status()).toBe('[ Wrote 1 line ]');
    expect(title()).toBe('vesen nano notes.txt');
    expect(area().value).toBe('hello\n');
    await ctrl(area(), 'x');
    expect(close).toHaveBeenCalledWith(EDITOR_CLOSED);
  });

  it("asks 'Save modified buffer?' on ^X, and N leaves without saving", async () => {
    const { area, save, close } = open();
    await type(area(), 'draft');
    await ctrl(area(), 'x');
    expect(screen.getByText('Save modified buffer?')).toBeInTheDocument();
    expect(Array.from(document.querySelectorAll('.shortcut')).map((s) => s.textContent?.replace(/\s+/g, ' '))).toEqual(['Y Yes', 'N No', '^C Cancel']);
    // Letters answer the question; they never reach the text.
    await key(window, 'n');
    expect(save).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledWith(EDITOR_CLOSED);
    expect(area().value).toBe('draft');
  });

  it('Y asks for the file name, writes, then leaves', async () => {
    const { area, files, close } = open({ name: null, message: '' });
    expect(screen.getByRole('textbox', { name: 'New buffer' })).toBeInTheDocument();
    await type(area(), 'a\nb\n');
    await ctrl(area(), 'x');
    await key(window, 'y');
    expect((screen.getByRole('textbox', { name: 'File Name to Write:' }) as HTMLInputElement).value).toBe('');
    await answer('list.txt');
    expect(files.get('list.txt')).toBe('a\nb\n');
    expect(close).toHaveBeenCalledWith(EDITOR_CLOSED);
  });

  it('^C cancels the question and the prompt, and an empty name cancels the write', async () => {
    const { area, status, close, save } = open();
    await type(area(), 'x');
    await ctrl(area(), 'x');
    await key(window, 'c', { ctrlKey: true });
    expect(status()).toBe('[ Cancelled ]');
    await ctrl(area(), 'o');
    await key(screen.getByRole('textbox', { name: 'File Name to Write:' }), 'Escape');
    expect(status()).toBe('[ Cancelled ]');
    expect(screen.queryByRole('textbox', { name: 'File Name to Write:' })).toBeNull();
    await ctrl(area(), 'o');
    await answer('');
    expect(status()).toBe('[ Cancelled ]');
    expect(save).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });

  it('says [ File is unwritable ] when a write is refused, and stays, still modified', async () => {
    const { area, status, title, close } = open({ name: '/etc/hostname', text: 'vesen\n', message: "[ File '/etc/hostname' is unwritable ]" }, ['/etc/hostname']);
    expect(status()).toBe("[ File '/etc/hostname' is unwritable ]");
    await type(area(), 'mine\n');
    await ctrl(area(), 's');
    expect(status()).toBe('[ File is unwritable ]');
    expect(title()).toContain('Modified');
    await ctrl(area(), 'x');
    await key(window, 'y');
    await answer();
    expect(status()).toBe('[ File is unwritable ]');
    expect(close).not.toHaveBeenCalled();
  });

  it('^S saves under the current name without asking, and asks for a new buffer', async () => {
    const { area, save } = open();
    await type(area(), 'one');
    await ctrl(area(), 's');
    expect(save).toHaveBeenCalledWith('notes.txt', 'one\n');
    expect(screen.queryByRole('textbox', { name: 'File Name to Write:' })).toBeNull();
    // Cmd+S on a Mac too.
    await type(area(), 'one\ntwo');
    await key(area(), 's', { metaKey: true });
    expect(save).toHaveBeenLastCalledWith('notes.txt', 'one\ntwo\n');
  });

  it('cuts lines with ^K, collecting cuts in a row, and pastes them with ^U', async () => {
    const { area, status } = open({ text: 'one\ntwo\nthree\nfour\n' });
    area().setSelectionRange(4, 4);
    await ctrl(area(), 'k');
    await ctrl(area(), 'k');
    expect(area().value).toBe('one\nfour\n');
    await key(area(), 'ArrowDown');
    area().setSelectionRange(9, 9);
    await ctrl(area(), 'u');
    expect(area().value).toBe('one\nfour\ntwo\nthree\n');
    // A cut after something else starts again.
    area().setSelectionRange(0, 0);
    await ctrl(area(), 'k');
    await ctrl(area(), 'u');
    await ctrl(area(), 'u');
    expect(area().value).toBe('one\none\nfour\ntwo\nthree\n');
    expect(status()).toBe('');
  });

  it('says the cut buffer is empty, and where the caret is with ^C', async () => {
    const { area, status } = open({ text: 'one\ntwo\n' });
    await ctrl(area(), 'u');
    expect(status()).toBe('[ Cutbuffer is empty ]');
    area().setSelectionRange(5, 5);
    await ctrl(area(), 'c');
    expect(status()).toBe('[ line 2/3 (66%), col 2/4 (50%), char 5/8 (62%) ]');
  });

  it('finds text with ^W, selecting it, going round past the end, and says when it is not there', async () => {
    const { area, status } = open({ text: 'alpha beta alpha' });
    await ctrl(area(), 'w');
    await answer('ALPHA');
    expect([area().selectionStart, area().selectionEnd]).toEqual([11, 16]);
    expect(document.activeElement).toBe(area());
    // Enter on an empty search looks for the last one again: [alpha] in the prompt.
    await ctrl(area(), 'f');
    expect(screen.getByText('Search [ALPHA]:')).toBeInTheDocument();
    await answer();
    expect(area().selectionStart).toBe(0);
    expect(status()).toBe('[ Search Wrapped ]');
    await ctrl(area(), 'w');
    await answer('gamma');
    expect(status()).toBe('[ "gamma" not found ]');
  });

  it('shows its keys with ^G, and Esc goes back to the text', async () => {
    const { area } = open();
    await ctrl(area(), 'g');
    expect(screen.getByRole('document', { name: 'nano help' })).toHaveTextContent(/\^K Cut cut the line the caret is on/);
    expect(area().readOnly).toBe(true);
    await key(window, 'Escape');
    expect(screen.queryByRole('document', { name: 'nano help' })).toBeNull();
    expect(area().readOnly).toBe(false);
  });

  it('types a tab with Tab, rather than leaving the text', async () => {
    const { area } = open({ text: 'ab' });
    area().setSelectionRange(1, 1);
    await key(area(), 'Tab');
    expect(area().value).toBe('a\tb');
    expect(area().selectionStart).toBe(2);
  });

  it('asks before the page is left with unsaved changes, and not otherwise', async () => {
    const { area } = open();
    const quiet = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(quiet);
    expect(quiet.defaultPrevented).toBe(false);
    await type(area(), 'unsaved');
    await tick();
    const warned = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(warned);
    expect(warned.defaultPrevented).toBe(true);
  });
});

describe('Editor on a touch screen', () => {
  it('has a toolbar of Save, Exit, Find, Cut and Paste instead of the shortcuts, over a native textarea', async () => {
    const { area } = open({ touch: true });
    const toolbar = screen.getByRole('toolbar', { name: 'Editor' });
    expect(Array.from(toolbar.querySelectorAll('button')).map((button) => button.textContent)).toEqual(['Save', 'Exit', 'Find', 'Cut', 'Paste']);
    expect(document.querySelector('.shortcuts')).toBeNull();
    expect(area().tagName).toBe('TEXTAREA');
    // On a phone the keyboard opens with a tap on the text, not before.
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(document.activeElement).not.toBe(area());
  });

  it('saves, cuts, pastes and leaves with the buttons, answering the question with buttons too', async () => {
    const { area, files, close, status } = open({ touch: true, text: 'one\ntwo\n' });
    area().setSelectionRange(0, 0);
    await fireEvent.click(screen.getByRole('button', { name: 'Cut' }));
    await tick();
    expect(area().value).toBe('two\n');
    area().setSelectionRange(4, 4);
    await fireEvent.click(screen.getByRole('button', { name: 'Paste' }));
    await tick();
    expect(area().value).toBe('two\none\n');
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(files.get('notes.txt')).toBe('two\none\n');
    expect(status()).toBe('[ Wrote 2 lines ]');
    await type(area(), 'two\none\nthree\n');
    await fireEvent.click(screen.getByRole('button', { name: 'Exit' }));
    expect(Array.from(screen.getByRole('toolbar').querySelectorAll('button')).map((button) => button.textContent)).toEqual(['Yes', 'No', 'Cancel']);
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(status()).toBe('[ Cancelled ]');
    await fireEvent.click(screen.getByRole('button', { name: 'Exit' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    await tick();
    // The name, with Save and Cancel beside it, since a phone has no Enter to spare.
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await tick();
    expect(files.get('notes.txt')).toBe('two\none\nthree\n');
    expect(close).toHaveBeenCalledWith(EDITOR_CLOSED);
  });

  it('finds with the Find button', async () => {
    const { area } = open({ touch: true, text: 'x needle y' });
    await fireEvent.click(screen.getByRole('button', { name: 'Find' }));
    await tick();
    await fireEvent.input(screen.getByRole('textbox', { name: 'Find:' }), { target: { value: 'needle' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Find' }));
    await tick();
    expect([area().selectionStart, area().selectionEnd]).toEqual([2, 8]);
    // The last search is offered again, as on a keyboard.
    await fireEvent.click(screen.getByRole('button', { name: 'Find' }));
    await tick();
    expect(screen.getByRole('textbox', { name: 'Find [needle]:' })).toBeInTheDocument();
  });

  it("keeps the prompt's label short beside its buttons: 'Write to:' and 'Find:'", async () => {
    const { container } = open({ touch: true, name: null });
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await tick();
    expect(screen.getByRole('textbox', { name: 'Write to:' })).toBeInTheDocument();
    const row = container.querySelector('form.prompt');
    expect(Array.from(row?.querySelectorAll('button') ?? []).map((button) => button.textContent)).toEqual(['Save', 'Cancel']);
  });
});

// Back may leave the page whatever nano does (a phone's browser can skip an entry put back with no
// tap), so the buffer is kept through the view's `keep` while Back asks and whenever the page is
// put away, and the next nano of the file offers it back.
describe('Editor and what it keeps', () => {
  const question = () => document.querySelector('.question')?.textContent ?? null;
  const backOf = (component: unknown) => (component as { back: () => void }).back;

  it('keeps the buffer while Back asks, asks again at every Back, and forgets it once N discards it', async () => {
    const keep = vi.fn();
    const { area, close, component, status } = open({ keep });
    await type(area(), 'unsaved words');
    await tick();
    const back = backOf(component);

    back();
    await tick();
    expect(question()).toBe('Save modified buffer?');
    expect(keep).toHaveBeenLastCalledWith('notes.txt', 'unsaved words');
    // Back again does not cancel the question, so a run of Backs never ends it either way.
    back();
    await tick();
    back();
    await tick();
    expect(question()).toBe('Save modified buffer?');
    expect(status()).not.toBe('[ Cancelled ]');
    expect(close).not.toHaveBeenCalled();
    expect(area().value).toBe('unsaved words');

    await key(window, 'n');
    expect(keep).toHaveBeenLastCalledWith('notes.txt', null);
    expect(close).toHaveBeenCalledWith(EDITOR_CLOSED);
  });

  it('forgets what it kept once the buffer is saved, under whatever name', async () => {
    const keep = vi.fn();
    const { area, files, component } = open({ keep });
    await type(area(), 'words');
    await tick();
    backOf(component)();
    await tick();
    await key(window, 'y');
    await answer('other.txt');
    expect(files.get('other.txt')).toBe('words\n');
    expect(keep.mock.calls).toEqual([
      ['notes.txt', 'words'],
      ['notes.txt', null],
    ]);
  });

  it('keeps the buffer when the page is put away with changes, and not without', async () => {
    const keep = vi.fn();
    const { area } = open({ keep });
    window.dispatchEvent(new Event('pagehide'));
    expect(keep).not.toHaveBeenCalled();
    await type(area(), 'half a thought');
    await tick();
    window.dispatchEvent(new Event('pagehide'));
    expect(keep).toHaveBeenLastCalledWith('notes.txt', 'half a thought');
    keep.mockClear();
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    try {
      document.dispatchEvent(new Event('visibilitychange'));
    } finally {
      visibility.mockRestore();
    }
    expect(keep).toHaveBeenLastCalledWith('notes.txt', 'half a thought');
    keep.mockClear();
    window.dispatchEvent(new Event('beforeunload', { cancelable: true }));
    expect(keep).toHaveBeenLastCalledWith('notes.txt', 'half a thought');
  });

  it("offers what was kept first: Y puts it back, modified, and it is forgotten once saved", async () => {
    const keep = vi.fn();
    const { area, title, status, files } = open({ text: 'saved\n', message: '[ Read 1 line ]', kept: 'saved\nand more\n', keep });
    expect(question()).toBe('Restore unsaved changes from before?');
    expect(area().value).toBe('saved\n');
    await key(window, 'y');
    expect(question()).toBeNull();
    expect(area().value).toBe('saved\nand more\n');
    expect(title()).toContain('Modified');
    expect(status()).toBe('[ Restored unsaved changes ]');
    expect(keep).not.toHaveBeenCalled();
    await ctrl(area(), 's');
    expect(files.get('notes.txt')).toBe('saved\nand more\n');
    expect(keep).toHaveBeenLastCalledWith('notes.txt', null);
  });

  it('N forgets what was kept, and ^C or Back leaves it for next time', async () => {
    const keep = vi.fn();
    const first = open({ text: 'saved\n', kept: 'other\n', keep });
    await key(window, 'n');
    expect(first.area().value).toBe('saved\n');
    expect(keep).toHaveBeenCalledWith('notes.txt', null);
    first.unmount();

    keep.mockClear();
    const second = open({ text: 'saved\n', kept: 'other\n', keep });
    await key(window, 'c', { ctrlKey: true });
    expect(second.status()).toBe('[ Cancelled ]');
    expect(second.area().value).toBe('saved\n');
    // Unchanged, ^X leaves at once, and what was kept stays kept.
    await ctrl(second.area(), 'x');
    expect(second.close).toHaveBeenCalledWith(EDITOR_CLOSED);
    expect(keep).not.toHaveBeenCalled();
    second.unmount();

    const third = open({ text: 'saved\n', kept: 'other\n', keep });
    const back = backOf(third.component);
    back();
    await tick();
    expect(question()).toBeNull();
    back();
    expect(third.close).toHaveBeenCalledWith(EDITOR_CLOSED);
    expect(keep).not.toHaveBeenCalled();
  });

  it('answers the offer with the buttons on a touch screen', async () => {
    const { area } = open({ touch: true, text: '', kept: 'from before\n', keep: vi.fn() });
    expect(Array.from(screen.getByRole('toolbar').querySelectorAll('button')).map((button) => button.textContent)).toEqual(['Yes', 'No', 'Cancel']);
    await fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    await tick();
    expect(area().value).toBe('from before\n');
  });
});
