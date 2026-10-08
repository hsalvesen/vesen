// The alternate screen and the Shutdown app (F029): systemd's lines, a fade (at once under reduced
// motion), '● vesen is off' with Power on, and the in-app hint; never window.close. Back while an
// app shows closes it through its own close path.
import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EDITOR_CLOSED, type EditorView, type SaveResult } from '../lib/nano';
import { PAGER_CLOSED, type PagerView } from '../lib/pager';
import { POWER_ON, type ShutdownView } from '../shell/shutdown';
import type { FullscreenView } from '../shell/types';
import AppHost from './AppHost.svelte';

const view = (extra: Partial<ShutdownView> = {}): ShutdownView => ({
  kind: 'poweroff',
  lines: ['[  OK  ] Stopped target Network.', '[  OK  ] Reached target System Power Off.', 'reboot: Power down'],
  inApp: false,
  touch: false,
  ...extra,
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function settle(ms = 5000): Promise<void> {
  await vi.dynamicImportSettled();
  for (let elapsed = 0; elapsed < ms; elapsed += 100) {
    await vi.advanceTimersByTimeAsync(100);
    await tick();
  }
}

describe('AppHost and the Shutdown app', () => {
  it("shows systemd's lines, fades, then offers Power on, which closes with the result", async () => {
    vi.useFakeTimers();
    const close = vi.spyOn(window, 'close');
    const onclose = vi.fn();
    render(AppHost, { props: { request: { id: 7, view: 'shutdown', props: view() }, onclose } });
    expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBe('true');
    await vi.dynamicImportSettled();
    await vi.advanceTimersByTimeAsync(130);
    await tick();
    expect(screen.getByRole('log').textContent).toContain('Stopped target Network.');
    await settle();
    expect(screen.getByRole('status').textContent).toContain('vesen is off');
    expect(screen.getByText('or press any key')).toBeInTheDocument();
    expect(screen.queryByText('Close this page with ✕')).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: /Power on/ }));
    expect(onclose).toHaveBeenCalledWith(7, POWER_ON);
    expect(close).not.toHaveBeenCalled();
  });

  it('powers on at any key on a desktop', async () => {
    vi.useFakeTimers();
    const onclose = vi.fn();
    render(AppHost, { props: { request: { id: 1, view: 'shutdown', props: view() }, onclose } });
    await settle();
    // A modifier alone is not a key press.
    await fireEvent.keyDown(window, { key: 'Shift' });
    expect(onclose).not.toHaveBeenCalled();
    await fireEvent.keyDown(window, { key: 'a' });
    expect(onclose).toHaveBeenCalledWith(1, POWER_ON);
  });

  it('says how to close the page inside an in-app browser, where Power on is a tap', async () => {
    vi.useFakeTimers();
    const onclose = vi.fn();
    render(AppHost, { props: { request: { id: 4, view: 'shutdown', props: view({ inApp: true, touch: true }) }, onclose } });
    await settle();
    expect(screen.getByText('Close this page with ✕')).toBeInTheDocument();
    expect(screen.queryByText('or press any key')).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: /Power on/ }));
    expect(onclose).toHaveBeenCalledTimes(1);
  });

  it('comes straight back from a reboot, and skips the motion when asked to', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduced-motion') }));
    const onclose = vi.fn();
    render(AppHost, { props: { request: { id: 2, view: 'shutdown', props: view({ kind: 'reboot' }) }, onclose } });
    await vi.dynamicImportSettled();
    await tick();
    // Under reduced motion every line is there at once.
    expect(screen.getByRole('log').textContent).toContain('reboot: Power down');
    await settle(200);
    expect(onclose).toHaveBeenCalledWith(2, POWER_ON);
  });

  it('powers on when Back leaves its history entry', async () => {
    vi.useFakeTimers();
    const onclose = vi.fn();
    render(AppHost, { props: { request: { id: 5, view: 'shutdown', props: view() }, onclose } });
    await settle();
    history.back();
    expect(onclose).toHaveBeenCalledWith(5, POWER_ON);
  });

  it('lets the command go on when there is no such app', async () => {
    const onclose = vi.fn();
    render(AppHost, { props: { request: { id: 3, view: 'no-such-app' as FullscreenView, props: {} }, onclose } });
    await vi.waitFor(() => expect(screen.getByText(/could not load/)).toBeInTheDocument());
    await fireEvent.click(screen.getByRole('button', { name: 'Back to the terminal' }));
    expect(onclose).toHaveBeenCalledWith(3, undefined);
  });
});

// Back while an app shows (apps/history-entry.ts): each app holds one history entry, so Back
// closes the app through its own close path instead of leaving vesen; nano with changes asks to
// save, at every Back until answered, and keeps its entry (and its buffer) while it asks; an app
// that closes itself takes its entry off once.
// happy-dom's history goes back within the document at once, with its popstate.
describe('Back while an app shows', () => {
  const vesenEntry = (): boolean => typeof (history.state as { vesenApp?: unknown } | null)?.vesenApp === 'string';

  const pagerView = (): PagerView => ({
    title: 'notes.txt',
    lines: Array.from({ length: 100 }, (_, i) => [{ text: `line ${i + 1}` }]),
    mode: 'less',
    touch: false,
    columns: 80,
    rows: 11,
  });

  const written = (name: string): SaveResult => ({ ok: true, name, message: '[ Wrote 1 line ]' });

  const editorView = (save: EditorView['save'] = written): EditorView => ({ name: 'draft.txt', text: '', message: '[ New File ]', touch: false, save });

  async function show(request: { id: number; view: FullscreenView; props: unknown }) {
    const onclose = vi.fn();
    const pushes = vi.spyOn(history, 'pushState');
    const backs = vi.spyOn(history, 'back');
    const result = render(AppHost, { props: { request, onclose } });
    await vi.dynamicImportSettled();
    await tick();
    return { ...result, onclose, pushes, backs };
  }

  afterEach(() => {
    vi.restoreAllMocks();
    history.replaceState(null, '');
  });

  it('adds one entry with no URL of its own; Back closes the pager as q does, and does not go back again', async () => {
    const { onclose, pushes, backs } = await show({ id: 11, view: 'pager', props: pagerView() });
    expect(pushes).toHaveBeenCalledTimes(1);
    expect(pushes.mock.calls[0]![1]).toBe('');
    expect(pushes.mock.calls[0]![2]).toBeUndefined();
    expect(vesenEntry()).toBe(true);

    history.back();
    expect(onclose).toHaveBeenCalledTimes(1);
    expect(onclose).toHaveBeenCalledWith(11, PAGER_CLOSED);
    // Only the visitor's Back: nothing went back again, and nothing was pushed again.
    expect(backs).toHaveBeenCalledTimes(1);
    expect(pushes).toHaveBeenCalledTimes(1);
    expect(vesenEntry()).toBe(false);
  });

  it("takes the pager's help away first, as q does", async () => {
    const { onclose, container } = await show({ id: 12, view: 'pager', props: pagerView() });
    await fireEvent.keyDown(window, { key: 'h' });
    await tick();
    expect(container.querySelector('.status')?.textContent).toContain('HELP');
    history.back();
    await tick();
    expect(onclose).not.toHaveBeenCalled();
    expect(container.querySelector('.status')?.textContent).not.toContain('HELP');
    // Its entry is back, so the next Back closes it.
    expect(vesenEntry()).toBe(true);
    history.back();
    expect(onclose).toHaveBeenCalledWith(12, PAGER_CLOSED);
  });

  it('takes its entry off once when the app closes itself', async () => {
    const { onclose, backs } = await show({ id: 13, view: 'pager', props: pagerView() });
    await fireEvent.keyDown(window, { key: 'q' });
    expect(onclose).toHaveBeenCalledWith(13, PAGER_CLOSED);
    expect(backs).toHaveBeenCalledTimes(1);
    expect(vesenEntry()).toBe(false);
  });

  it('takes its entry off when the app is taken down from outside (^C)', async () => {
    const { onclose, backs, unmount } = await show({ id: 14, view: 'pager', props: pagerView() });
    unmount();
    expect(backs).toHaveBeenCalledTimes(1);
    expect(vesenEntry()).toBe(false);
    expect(onclose).not.toHaveBeenCalled();
  });

  it("asks 'Save modified buffer?' in nano with changes, keeping the text and the entry, and asks again at every Back", async () => {
    const save = vi.fn(written);
    const keep = vi.fn();
    const { onclose, container } = await show({ id: 15, view: 'editor', props: { ...editorView(save), keep } });
    const area = screen.getByRole('textbox', { name: 'Editing draft.txt' }) as HTMLTextAreaElement;
    await fireEvent.input(area, { target: { value: 'unsaved words' } });
    await tick();

    history.back();
    await tick();
    expect(onclose).not.toHaveBeenCalled();
    expect(container.querySelector('.question')?.textContent).toBe('Save modified buffer?');
    expect(area.value).toBe('unsaved words');
    expect(vesenEntry()).toBe(true);
    // Kept meanwhile, should a Back leave the page instead.
    expect(keep).toHaveBeenLastCalledWith('draft.txt', 'unsaved words');

    history.back();
    await tick();
    expect(onclose).not.toHaveBeenCalled();
    expect(container.querySelector('.question')?.textContent).toBe('Save modified buffer?');
    expect(area.value).toBe('unsaved words');
    expect(vesenEntry()).toBe(true);

    // Y and the file name: saved, closed, what was kept forgotten, and the entry gone.
    await fireEvent.keyDown(window, { key: 'y' });
    await tick();
    const name = screen.getByRole('textbox', { name: 'File Name to Write:' }) as HTMLInputElement;
    await fireEvent.submit(name.form as HTMLFormElement);
    expect(save).toHaveBeenCalledWith('draft.txt', 'unsaved words\n');
    expect(keep).toHaveBeenLastCalledWith('draft.txt', null);
    expect(onclose).toHaveBeenCalledWith(15, EDITOR_CLOSED);
    expect(vesenEntry()).toBe(false);
  });

  it('closes nano without changes, as ^X does', async () => {
    const { onclose } = await show({ id: 16, view: 'editor', props: editorView() });
    history.back();
    expect(onclose).toHaveBeenCalledWith(16, EDITOR_CLOSED);
  });

  it('closes with no result when the app could not load', async () => {
    const { onclose } = await show({ id: 17, view: 'no-such-app' as FullscreenView, props: {} });
    await vi.waitFor(() => expect(screen.getByText(/could not load/)).toBeInTheDocument());
    history.back();
    expect(onclose).toHaveBeenCalledWith(17, undefined);
  });
});
