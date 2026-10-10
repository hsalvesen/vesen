import { render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import sudo, { SUDO_HINT } from '../../commands/shell/sudo';
import rm from '../../commands/files/rm';
import theme from '../../commands/portfolio/theme';
import sleep from '../../commands/shell/sleep';
import { createStorage } from '../../services/storage';
import { createScreen, type ScreenStore } from '../../stores/screen';
import { harness } from '../../testing/shell-harness';
import PromptLine from './PromptLine.svelte';
import { REVEAL_EVENT, SUBMIT_EVENT } from '../actions/stickToBottom';
import { ESCAPE_TAB_MS, PromptController, READ_HINT_ID, SECRET_MASK, TAB_CATALOGUE_WAIT_MS, TAB_EMPTY_WAIT_MS } from './promptController.svelte';
import { CATALOGUE_WAIT_MS } from '../../shell/registry';
import { defineCommand, type CatalogueLoader, type CommandSpec } from '../../shell/types';

const SECRET = 'hunter2-correct-horse';

let cleanup: (() => void)[] = [];

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  for (const stop of cleanup.splice(0)) stop();
  window.getSelection()?.removeAllRanges();
  document.body.querySelectorAll('[data-test-text]').forEach((node) => node.remove());
  vi.restoreAllMocks();
});

function setup(options: { touch?: boolean; dock?: boolean; platform?: 'mac' | 'other'; now?: () => number; catalogue?: CatalogueLoader } = {}) {
  const storage = createStorage(window).local;
  const h = harness({ specs: [sudo, rm, theme, sleep], storage, ...(options.catalogue ? { catalogue: options.catalogue } : {}) });
  const screen: ScreenStore = createScreen();
  const controller = new PromptController({
    shell: h.shell,
    screen,
    platform: options.platform ?? 'other',
    touch: options.touch ?? false,
    ...(options.dock ? { dock: true } : {}),
    ...(options.now ? { now: options.now } : {}),
  });
  const view = render(PromptLine, { props: { controller, shell: h.shell } });
  const input = view.container.querySelector('input.command-input') as HTMLInputElement;
  cleanup.push(() => {
    h.shell.abort();
    controller.destroy();
  });
  return { h, screen, controller, view, input };
}

/** Types `text` into the input, as the browser does: the value, the caret, then an input event. */
async function type(input: HTMLInputElement, text: string, caret = text.length): Promise<void> {
  input.value = text;
  input.setSelectionRange(caret, caret);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await tick();
}

/** Presses a key on the input; returns the event, to see whether its default was prevented. */
function press(input: HTMLInputElement, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const code = /^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : key === '.' ? 'Period' : key;
  const event = new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true, ...init });
  input.dispatchEvent(event);
  return event;
}

async function engineReady(controller: PromptController): Promise<void> {
  await vi.waitFor(() => expect(controller.completion).not.toBeNull());
}

describe('the input', () => {
  it('is a labelled combobox that never fills itself in, for password managers or autocorrect', () => {
    const { input } = setup();
    expect(input.getAttribute('role')).toBe('combobox');
    expect(input.getAttribute('aria-label')).toBe('Terminal command');
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(input.type).toBe('text');
    for (const [name, value] of [
      ['autocomplete', 'off'],
      ['autocapitalize', 'none'],
      ['autocorrect', 'off'],
      ['spellcheck', 'false'],
      ['enterkeyhint', 'go'],
      ['data-1p-ignore', ''],
      ['data-lpignore', 'true'],
      ['writingsuggestions', 'false'],
    ]) {
      expect(input.getAttribute(name as string), name).toBe(value);
    }
    expect(document.activeElement).toBe(input);
  });

  it('waits for a tap on touch, and shows the native input with no mirror', () => {
    const { input, view } = setup({ touch: true });
    expect(document.activeElement).not.toBe(input);
    expect(view.container.querySelector('.mirror')).toBeNull();
    expect(input.getAttribute('placeholder')).toBe('Type a command…');
  });

  it('draws the line in the mirror, with a block cursor on the character under the caret', async () => {
    const { input, view } = setup();
    await type(input, 'echo hi', 2);
    const mirror = view.container.querySelector('.mirror');
    expect(mirror?.getAttribute('aria-hidden')).toBe('true');
    expect(mirror?.textContent).toBe('echo hi');
    expect(mirror?.querySelector('.cursor')?.textContent).toBe('h');
    expect(mirror?.querySelector('.cursor')?.classList.contains('steady')).toBe(true);
    input.blur();
    await tick();
    expect(mirror?.querySelector('.cursor')?.classList.contains('hollow')).toBe(true);
  });

  it('straightens typed smart quotes and dashes, keeping the caret after them', async () => {
    const { input, controller } = setup();
    await type(input, 'echo “hi” —n');
    expect(input.value).toBe('echo "hi" --n');
    expect(controller.cursor).toBe(input.value.length);
  });

  it('makes a pasted block one line that never runs by itself', async () => {
    const { input, h } = setup();
    const paste = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(paste, 'clipboardData', { value: { getData: () => '$ cd docs\n$ ls\n' } });
    input.dispatchEvent(paste);
    await tick();
    expect(paste.defaultPrevented).toBe(true);
    expect(input.value).toBe('cd docs; ls');
    expect(h.commits).toEqual([]);
  });
});

describe('a running command', () => {
  it('never disables the input: what is typed waits as type-ahead, and Enter rings the bell', async () => {
    const { input, controller, view } = setup();
    await type(input, 'hang');
    press(input, 'Enter');
    await tick();
    expect(controller.mode).toBe('busy');
    // The line is the transcript's to show now; the prompt it was typed at keeps its room, unseen.
    expect(view.container.textContent).not.toContain('hang');
    expect(view.container.querySelector('.edit-row.busy .label')?.getAttribute('aria-hidden')).toBe('true');
    expect(input.disabled).toBe(false);
    expect(input.readOnly).toBe(false);
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('');

    await type(input, 'ls -a');
    const enter = press(input, 'Enter');
    expect(enter.defaultPrevented).toBe(true);
    expect(controller.bell).toBe(true);
    expect(input.value).toBe('ls -a');
    expect(controller.running?.line).toBe('hang');
  });

  it('gives the prompt back at once on ^C, though the command ignores it, keeping the type-ahead', async () => {
    const { input, controller, h } = setup();
    await type(input, 'hang');
    press(input, 'Enter');
    await type(input, 'next');
    const ctrlC = press(input, 'c', { ctrlKey: true });
    // At once: nothing waits on the command.
    expect(ctrlC.defaultPrevented).toBe(true);
    expect(controller.running).toBeNull();
    expect(controller.mode).toBe('edit');
    expect(input.value).toBe('next');
    await vi.waitFor(() => expect(h.commits[h.commits.length - 1]).toMatchObject({ line: 'hang', status: 130, interrupted: true }));
  });

  it('stops on ^C or Escape pressed with focus elsewhere on the page, and leaves other keys alone', async () => {
    const { input, controller } = setup();
    await type(input, 'hang');
    press(input, 'Enter');
    input.blur();
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    document.body.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(false);
    expect(controller.running).not.toBeNull();
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    document.body.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(true);
    expect(controller.running).toBeNull();
    expect(document.activeElement).not.toBe(input);
  });

  it('stops on Escape', async () => {
    const { input, controller } = setup();
    await type(input, 'hang');
    press(input, 'Enter');
    press(input, 'Escape');
    expect(controller.running).toBeNull();
  });

  it('says what is running, from the label its spec gives, for the status line', async () => {
    const { input, controller } = setup();
    await type(input, 'sleep 5');
    press(input, 'Enter');
    await vi.waitFor(() => expect(controller.status).toMatchObject({ line: 'sleep 5', label: 'sleeping 5' }));
    expect(controller.status?.startedAt).toBeGreaterThan(0);
    press(input, 'c', { ctrlKey: true });
    expect(controller.status).toBeNull();
  });
});

describe('Tab and the chips', () => {
  it('a tapped chip puts the same line on the prompt as choosing it in the Tab menu', async () => {
    const { input, controller } = setup();
    await engineReady(controller);
    for (const index of [0, 1, 2]) {
      await type(input, 'cat ');
      const chip = controller.chipList.chips[index];
      if (chip === undefined) throw new Error(`no chip ${index}`);
      controller.choose(chip);
      const tapped = input.value;
      expect(document.activeElement).toBe(input);

      await type(input, 'cat ');
      press(input, 'Tab');
      for (let i = 0; i <= index; i += 1) press(input, 'Tab');
      press(input, 'Enter');
      expect(input.value, chip.label).toBe(tapped);
    }
  });

  it('offers the folder’s entries as chips while typing', async () => {
    const { input, controller } = setup();
    await engineReady(controller);
    await type(input, 'cat ');
    expect(controller.chipList.chips.map((chip) => chip.label)).toEqual(['a.txt', 'b.txt', 'docs/']);
  });

  it('asks before listing over 100, and the answer is the next key', async () => {
    const { input, controller, h } = setup();
    await engineReady(controller);
    h.fs.mkdir('/home/guest/many');
    for (let i = 1; i <= 120; i += 1) h.fs.writeFile(`/home/guest/many/f${String(i).padStart(3, '0')}`, '');
    await type(input, 'cat many/f');
    press(input, 'Tab');
    await tick();
    expect(controller.question).toBe('Display all 120 possibilities? (y or n)');
    expect(press(input, 'n').defaultPrevented).toBe(true);
    expect(controller.question).toBeNull();
    expect(controller.listed).toBe(false);
    // Backspace says no, as readline's Rubout does, and deletes nothing.
    press(input, 'Tab');
    expect(press(input, 'Backspace').defaultPrevented).toBe(true);
    expect(controller.question).toBeNull();
    expect(input.value).toBe('cat many/f');
    // Any other key rings the bell, and the question stays; it neither types nor moves.
    press(input, 'Tab');
    for (const key of ['x', 'ArrowUp', 'ArrowLeft']) {
      expect(press(input, key).defaultPrevented, key).toBe(true);
      expect(controller.question, key).not.toBeNull();
    }
    expect(controller.bell).toBe(true);
    expect(input.value).toBe('cat many/f');
    press(input, 'y');
    await tick();
    expect(controller.listed).toBe(true);
    expect(controller.chipList.chips).toHaveLength(120);
    expect(input.value).toBe('cat many/f');
  });

  it('rings the bell for Tab at the > continuation, which completes nothing, and does not act unseen', async () => {
    const { input, controller } = setup();
    await engineReady(controller);
    await type(input, 'echo "a');
    press(input, 'Enter');
    expect(controller.ps2).not.toBeNull();
    expect(press(input, 'Tab').defaultPrevented).toBe(true);
    expect(controller.bell).toBe(true);
    expect(controller.tab.phase).toBe('idle');
    press(input, 'Tab');
    expect(input.value).toBe('');
  });

  it('holds composition edits until the input method is done', async () => {
    const { input, controller } = setup();
    await engineReady(controller);
    await type(input, 'ca');
    input.dispatchEvent(new CompositionEvent('compositionstart'));
    controller.pressTab();
    expect(input.value).toBe('ca');
    input.dispatchEvent(new CompositionEvent('compositionend'));
    expect(input.value).toBe('cat ');
  });
});

describe('Tab while the catalogue is on its way', () => {
  const hush = defineCommand({ name: 'hush', category: 'text', summary: 'say nothing', run: () => 0 });

  /** A catalogue that arrives when the test says. */
  function later(): { load: CatalogueLoader; arrive: (specs: readonly CommandSpec[]) => void } {
    let arrive: (specs: readonly CommandSpec[]) => void = () => {};
    const load: CatalogueLoader = () =>
      new Promise((resolve) => {
        arrive = resolve;
      });
    return { load, arrive: (specs) => arrive(specs) };
  }

  it('completes from it when it lands within the wait', async () => {
    const catalogue = later();
    const { input, controller } = setup({ catalogue: catalogue.load });
    await engineReady(controller);
    await type(input, 'hu');
    press(input, 'Tab');
    // Nothing yet: the Tab is waiting, and a second press does not start another wait.
    expect(input.value).toBe('hu');
    press(input, 'Tab');
    catalogue.arrive([hush]);
    await vi.waitFor(() => expect(input.value).toBe('hush '));
  });

  it('lists what there is after the wait, and fills the list in when the rest lands', async () => {
    const catalogue = later();
    const { input, controller } = setup({ catalogue: catalogue.load });
    await engineReady(controller);
    await type(input, 'h');
    const pressed = performance.now();
    press(input, 'Tab');
    await vi.waitFor(() => expect(controller.listed).toBe(true), { timeout: 2000 });
    expect(performance.now() - pressed).toBeGreaterThanOrEqual(TAB_CATALOGUE_WAIT_MS - 50);
    const values = (): string[] => (controller.tab.phase === 'listed' ? controller.tab.result.candidates.map((c) => c.value) : []);
    expect(values()).toEqual(['hang', 'head']);
    catalogue.arrive([hush]);
    await vi.waitFor(() => expect(values()).toEqual(['hang', 'head', 'hush']));
    expect(input.value).toBe('h');
  });

  it('waits on, without the bell, when there is nothing to show yet, and completes when the rest lands', async () => {
    const catalogue = later();
    const { input, controller } = setup({ catalogue: catalogue.load });
    await engineReady(controller);
    const bell = vi.spyOn(controller, 'ringBell');
    await type(input, 'hu');
    press(input, 'Tab');
    await new Promise((resolve) => setTimeout(resolve, TAB_CATALOGUE_WAIT_MS + 150));
    // Past the short wait: no bell, no "No completions", the line as it was.
    expect(bell).not.toHaveBeenCalled();
    expect(controller.announce.trim()).not.toBe('No completions');
    expect(input.value).toBe('hu');
    catalogue.arrive([hush]);
    await vi.waitFor(() => expect(input.value).toBe('hush '));
    expect(bell).not.toHaveBeenCalled();
  });

  it("does the same for the dock's tab key", async () => {
    const catalogue = later();
    const { input, controller } = setup({ catalogue: catalogue.load, touch: true, dock: true });
    await engineReady(controller);
    const bell = vi.spyOn(controller, 'ringBell');
    await type(input, 'hu');
    controller.pressKey('Tab');
    await new Promise((resolve) => setTimeout(resolve, TAB_CATALOGUE_WAIT_MS + 150));
    expect(bell).not.toHaveBeenCalled();
    catalogue.arrive([hush]);
    await vi.waitFor(() => expect(input.value).toBe('hush '));
  });

  it('rings once the catalogue fails, or once a line would have stopped waiting for it', async () => {
    let fail: () => void = () => {};
    const failing: CatalogueLoader = () =>
      new Promise((_, reject) => {
        fail = () => reject(new Error('offline'));
      });
    const first = setup({ catalogue: failing });
    await engineReady(first.controller);
    const bell = vi.spyOn(first.controller, 'ringBell');
    await type(first.input, 'hu');
    press(first.input, 'Tab');
    await new Promise((resolve) => setTimeout(resolve, TAB_CATALOGUE_WAIT_MS + 150));
    expect(bell).not.toHaveBeenCalled();
    fail();
    await vi.waitFor(() => expect(bell).toHaveBeenCalledTimes(1));
    expect(first.input.value).toBe('hu');

    // A catalogue that never comes: the bell after as long as a line waits for a command.
    expect(TAB_EMPTY_WAIT_MS).toBe(CATALOGUE_WAIT_MS);
    vi.useFakeTimers();
    try {
      const second = setup({ catalogue: later().load });
      await vi.waitFor(() => expect(second.controller.completion).not.toBeNull());
      const rang = vi.spyOn(second.controller, 'ringBell');
      await type(second.input, 'hu');
      press(second.input, 'Tab');
      vi.advanceTimersByTime(TAB_EMPTY_WAIT_MS - 1);
      expect(rang).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(rang).toHaveBeenCalledTimes(1);
      expect(second.input.value).toBe('hu');
    } finally {
      vi.useRealTimers();
    }
  });

  it('forgets the Tab once the line is edited, even back to what it was', async () => {
    const catalogue = later();
    const { input, controller } = setup({ catalogue: catalogue.load });
    await engineReady(controller);
    await type(input, 'hu');
    press(input, 'Tab');
    await new Promise((resolve) => setTimeout(resolve, TAB_CATALOGUE_WAIT_MS + 150));
    await type(input, 'h');
    await type(input, 'hu');
    catalogue.arrive([hush]);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(input.value).toBe('hu');
  });

  it('does not wait for a path', async () => {
    const catalogue = later();
    const { input, controller } = setup({ catalogue: catalogue.load });
    await engineReady(controller);
    await type(input, 'cat a.');
    press(input, 'Tab');
    expect(input.value).toBe('cat a.txt ');
  });
});

describe('the dock', () => {
  it('drives the same actions as the keys: tab completes, lists and cycles; ↑ and ↓ walk history', async () => {
    const { input, controller, h } = setup({ touch: true, dock: true });
    await engineReady(controller);
    await type(input, 'cat d');
    controller.pressKey('Tab');
    expect(input.value).toBe('cat docs/');
    await type(input, 'cat ');
    controller.pressKey('Tab');
    expect(controller.listed).toBe(true);
    controller.pressKey('Tab');
    controller.pressKey('Tab');
    expect(input.value).toBe('cat b.txt');
    // Escape puts back what was typed before the menu, as the key does.
    controller.pressKey('Escape');
    expect(input.value).toBe('cat ');

    await h.shell.run('pwd');
    await type(input, '');
    controller.pressKey('ArrowUp');
    expect(input.value).toBe('pwd');
    controller.pressKey('ArrowDown');
    expect(input.value).toBe('');
  });

  it('moves the cursor with ← and →, and types symbols over the selection', async () => {
    const { input, controller } = setup({ touch: true, dock: true });
    await type(input, 'ls docs', 2);
    controller.insertText(' |');
    expect(input.value).toBe('ls | docs');
    expect(controller.cursor).toBe(4);
    controller.pressKey('ArrowLeft');
    controller.pressKey('ArrowLeft');
    expect(controller.cursor).toBe(2);
    controller.pressKey('ArrowRight');
    expect(controller.cursor).toBe(3);
    input.setSelectionRange(5, 9);
    controller.insertText('~');
    expect(input.value).toBe('ls | ~');
  });

  it('puts the keyboard away with ⌄, and an Escape from the key bar never arms leaving', async () => {
    const { input, controller } = setup({ touch: true, dock: true });
    controller.focus({ keyboard: true });
    expect(document.activeElement).toBe(input);
    controller.pressKey('Escape');
    expect(press(input, 'Tab').defaultPrevented).toBe(true);
    controller.blur();
    expect(document.activeElement).not.toBe(input);
  });

  it('runs a candidate that finishes the line, and a long press only puts it there', async () => {
    const { input, controller, h } = setup({ touch: true, dock: true });
    await engineReady(controller);
    await type(input, 'theme w');
    const wombat = controller.chipList.chips.find((chip) => chip.label === 'wombat');
    if (wombat === undefined) throw new Error('no wombat chip');
    controller.choose(wombat, { insert: true });
    expect(input.value).toBe('theme wombat ');
    expect(h.commits).toHaveLength(0);
    await type(input, 'theme w');
    controller.choose(wombat);
    await vi.waitFor(() => expect(h.commits.map((c) => c.line)).toEqual(['theme wombat']));
    expect(input.value).toBe('');
  });

  it('keeps the last line, its words and its status for the follow-ups', async () => {
    const { controller } = setup({ touch: true, dock: true });
    await engineReady(controller);
    controller.submit('theme ls', 'chip');
    await vi.waitFor(() => expect(controller.last).toEqual({ line: 'theme ls', argv: ['theme', 'ls'], status: 0 }));
    expect(controller.chipList.chips.slice(0, 2).map((chip) => chip.line)).toEqual(['theme swamphen', 'theme wombat']);
    controller.submit('nosuch', 'chip');
    await vi.waitFor(() => expect(controller.last?.status).toBe(127));
  });

  it('shows cancel ^C among the chips while a command runs in the dock, and leaves it to the status line without one', async () => {
    for (const dock of [true, false]) {
      const { controller } = setup({ touch: true, dock });
      await engineReady(controller);
      controller.submit('sleep 5', 'chip');
      await tick();
      expect(controller.chipList.chips.map((chip) => chip.label), String(dock)).toEqual(dock ? ['cancel ^C'] : []);
      controller.interrupt();
    }
  });
});

describe('the ghost', () => {
  it('offers the rest of a matching line from history, under the cursor, and Right takes it', async () => {
    const { input, controller, view, h } = setup();
    await engineReady(controller);
    await h.run('echo hello');
    await type(input, 'ec');
    expect(controller.ghost).toMatchObject({ text: 'ho hello', source: 'history', acceptable: true });
    const mirror = view.container.querySelector('.mirror');
    expect(mirror?.querySelector('.cursor')?.textContent).toBe('h');
    expect(mirror?.querySelector('.ghost')?.textContent).toBe('o hello');
    expect(press(input, 'ArrowRight').defaultPrevented).toBe(true);
    expect(input.value).toBe('echo hello');
    expect(controller.ghost).toBeNull();
  });

  it('Alt+F takes one word of it, and the ghost is gone mid-line', async () => {
    const { input, controller, h } = setup();
    await engineReady(controller);
    await h.run('echo hello world');
    await type(input, 'echo');
    press(input, 'f', { altKey: true });
    expect(input.value).toBe('echo hello');
    await type(input, 'echo hello', 2);
    expect(controller.ghost).toBeNull();
    expect(press(input, 'ArrowRight').defaultPrevented).toBe(false);
  });

  it('is never drawn on touch, where there is no mirror', async () => {
    const { input, controller, h } = setup({ touch: true });
    await engineReady(controller);
    await h.run('echo hello');
    await type(input, 'ec');
    expect(controller.ghost).toBeNull();
  });
});

describe('readline keys', () => {
  it('cut and paste through the kill ring', async () => {
    const { input, controller } = setup();
    await type(input, 'echo hello world');
    press(input, 'Backspace', { altKey: true });
    expect(input.value).toBe('echo hello ');
    press(input, 'u', { ctrlKey: true });
    expect(input.value).toBe('');
    expect(controller.ring.entries).toEqual(['echo hello world']);
    press(input, 'y', { ctrlKey: true });
    expect(input.value).toBe('echo hello world');
    press(input, 'a', { ctrlKey: true });
    expect(controller.cursor).toBe(0);
    press(input, 'k', { ctrlKey: true });
    expect(input.value).toBe('');
  });

  it('Ctrl+W cuts back to a space on a Mac, and is the browser’s elsewhere', async () => {
    const mac = setup({ platform: 'mac' });
    await type(mac.input, 'cd /home/guest/docs');
    expect(press(mac.input, 'w', { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(mac.input.value).toBe('cd ');
    mac.view.unmount();
    const other = setup({ platform: 'other' });
    await type(other.input, 'cd /home/guest/docs');
    expect(press(other.input, 'w', { ctrlKey: true }).defaultPrevented).toBe(false);
  });

  it('Up steps back through lines starting with what is typed, and Down brings the draft back', async () => {
    const { input, h } = setup();
    for (const line of ['echo one', 'pwd', 'echo two']) await h.run(line);
    await type(input, 'echo');
    press(input, 'ArrowUp');
    expect(input.value).toBe('echo two');
    press(input, 'ArrowUp');
    expect(input.value).toBe('echo one');
    press(input, 'ArrowDown');
    press(input, 'ArrowDown');
    expect(input.value).toBe('echo');
  });

  it('Alt+. inserts the last word of the line before', async () => {
    const { input, h } = setup();
    await h.run('cat a.txt b.txt');
    await type(input, 'ls ');
    press(input, '.', { altKey: true, key: '≥' } as KeyboardEventInit);
    expect(input.value).toBe('ls b.txt');
  });

  it('Ctrl+R searches back through history; Ctrl+R again goes older; Enter runs; failure is said', async () => {
    const { input, controller, h, view } = setup();
    for (const line of ['echo alpha', 'pwd', 'echo beta']) await h.run(line);
    const before = h.commits.length;
    await type(input, 'draft');
    expect(press(input, 'r', { ctrlKey: true }).defaultPrevented).toBe(true);
    await type(input, 'echo');
    expect(controller.searchView).toMatchObject({ label: '(reverse-i-search)', line: 'echo beta' });
    await tick();
    expect(view.container.querySelector('.edit-row .read-prompt')?.textContent).toBe('(reverse-i-search)`');
    // The query, then the line found, with the block cursor on the quote that closes the query.
    expect(view.container.querySelector('.mirror')?.textContent).toBe("echo': echo beta");
    expect(view.container.querySelector('.mirror .cursor')?.textContent).toBe("'");
    press(input, 'r', { ctrlKey: true });
    expect(controller.searchView?.line).toBe('echo alpha');
    await type(input, 'echoz');
    expect(controller.searchView?.label).toBe('(failed reverse-i-search)');
    press(input, 'Escape');
    expect(controller.search).toBeNull();
    expect(input.value).toBe('draft');

    press(input, 'r', { ctrlKey: true });
    await type(input, 'alp');
    press(input, 'Enter');
    await vi.waitFor(() => expect(h.commits.length).toBe(before + 1));
    expect(h.commits[h.commits.length - 1]?.line).toBe('echo alpha');
  });

  it('a moving key in a search puts the line found on the prompt to edit', async () => {
    const { input, controller, h } = setup();
    await h.run('echo found');
    press(input, 'r', { ctrlKey: true });
    await type(input, 'fou');
    press(input, 'ArrowRight');
    expect(controller.search).toBeNull();
    expect(input.value).toBe('echo found');
  });

  it('Ctrl+L clears the screen and keeps the line', async () => {
    const { input, screen } = setup();
    screen.push({ prompt: [], line: 'old', blocks: [] });
    await type(input, 'echo kept');
    expect(press(input, 'l', { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(screen.entries()).toEqual([]);
    expect(input.value).toBe('echo kept');
  });

  it('Ctrl+C prints the line with ^C at an idle prompt, and copies a selection instead', async () => {
    const { input, screen } = setup();
    await type(input, 'echo hello');
    input.setSelectionRange(0, 4);
    expect(press(input, 'c', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(screen.entries()).toEqual([]);

    const text = document.createElement('p');
    text.dataset.testText = '';
    text.textContent = 'some earlier output';
    document.body.append(text);
    input.setSelectionRange(10, 10);
    const range = document.createRange();
    range.selectNodeContents(text);
    window.getSelection()?.addRange(range);
    expect(press(input, 'c', { ctrlKey: true }).defaultPrevented).toBe(false);
    window.getSelection()?.removeAllRanges();

    expect(press(input, 'c', { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(screen.entries()[0]).toMatchObject({ line: 'echo hello^C', status: 130 });
    expect(input.value).toBe('');
  });

  it('on a Mac, Ctrl+C interrupts with text selected too, since Cmd+C copies', async () => {
    const { input, screen, controller } = setup({ platform: 'mac' });
    await type(input, 'echo hello');
    input.setSelectionRange(0, 4);
    expect(press(input, 'c', { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(screen.entries()[0]).toMatchObject({ line: 'echo hello^C', status: 130 });

    // And a command runs on with output selected and focus elsewhere: Ctrl+C stops it.
    await type(input, 'hang');
    press(input, 'Enter');
    input.blur();
    const text = document.createElement('p');
    text.dataset.testText = '';
    text.textContent = 'some earlier output';
    document.body.append(text);
    const range = document.createRange();
    range.selectNodeContents(text);
    window.getSelection()?.addRange(range);
    const ctrlC = new KeyboardEvent('keydown', { key: 'c', code: 'KeyC', ctrlKey: true, bubbles: true, cancelable: true });
    document.body.dispatchEvent(ctrlC);
    expect(ctrlC.defaultPrevented).toBe(true);
    expect(controller.running).toBeNull();
  });

  it('a cutting key in a search acts on the line found; Ctrl+R with nothing typed looks for the last query', async () => {
    const { input, controller, h } = setup();
    for (const line of ['echo alpha', 'pwd']) await h.run(line);
    press(input, 'r', { ctrlKey: true });
    await type(input, 'alp');
    expect(press(input, 'k', { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(controller.search).toBeNull();
    expect(input.value).toBe('echo ');
    expect(controller.ring.entries[0]).toBe('alpha');

    press(input, 'u', { ctrlKey: true });
    press(input, 'r', { ctrlKey: true });
    press(input, 'r', { ctrlKey: true });
    expect(controller.searchView).toMatchObject({ line: 'echo alpha' });
    expect(input.value).toBe('alp');
    // Ctrl+J ends the search on the line found, and is not the browser's (its downloads).
    expect(press(input, 'j', { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(controller.search).toBeNull();
    expect(input.value).toBe('echo alpha');
  });

  it('reads Escape, then a key, as that key with Alt: Esc . inserts the last argument', async () => {
    let now = 10_000;
    const { input, h } = setup({ now: () => now });
    await h.run('cat a.txt b.txt');
    await type(input, 'ls ');
    press(input, 'Escape');
    expect(press(input, '.').defaultPrevented).toBe(true);
    expect(input.value).toBe('ls b.txt');
    // A key with nothing bound to its Alt chord types as ever, and later Escape has worn off.
    press(input, 'Escape');
    expect(press(input, 'x').defaultPrevented).toBe(false);
    press(input, 'Escape');
    now += ESCAPE_TAB_MS + 1;
    expect(press(input, '.').defaultPrevented).toBe(false);
  });

  it('says a line started, whatever started it, so the transcript follows its output', async () => {
    const { input, controller } = setup({ touch: true, dock: true });
    const starts: string[] = [];
    document.addEventListener(SUBMIT_EVENT, () => starts.push('submit'));
    const reveals: string[] = [];
    document.addEventListener(REVEAL_EVENT, () => reveals.push('reveal'));
    await type(input, 'pwd');
    press(input, 'Enter');
    controller.submit('ls', 'chip');
    expect(starts).toEqual(['submit', 'submit']);
    controller.reveal();
    controller.insert('echo inserted');
    expect(reveals).toEqual(['reveal', 'reveal']);
  });

  it('Ctrl+D on an empty line runs exit', async () => {
    const { input, h } = setup();
    press(input, 'd', { ctrlKey: true });
    await vi.waitFor(() => expect(h.commits[h.commits.length - 1]?.line).toBe('exit'));
  });

  it('Escape then Tab within a second leaves the terminal; later, Tab completes again', async () => {
    let now = 10_000;
    const { input } = setup({ now: () => now });
    press(input, 'Escape');
    expect(press(input, 'Shift', { shiftKey: true }).defaultPrevented).toBe(false);
    expect(press(input, 'Tab', { shiftKey: true }).defaultPrevented).toBe(false);
    press(input, 'Escape');
    now += ESCAPE_TAB_MS + 1;
    expect(press(input, 'Tab').defaultPrevented).toBe(true);
    press(input, 'Escape');
    press(input, 'a');
    expect(press(input, 'Tab').defaultPrevented).toBe(true);
  });
});

describe('the > continuation', () => {
  it('collects lines until the quote closes, then runs them as one', async () => {
    const { input, controller, h, view } = setup();
    await type(input, "echo 'one");
    press(input, 'Enter');
    await tick();
    expect(controller.ps2).toMatchObject({ reason: 'quote', lines: ["echo 'one"] });
    expect(view.container.querySelector('.edit-row .ps2')?.textContent).toBe('> ');
    expect(h.commits).toEqual([]);
    await type(input, "two'");
    press(input, 'Enter');
    await vi.waitFor(() => expect(h.commits).toHaveLength(1));
    expect(h.commits[0]?.line).toBe("echo 'one\ntwo'");
    expect(controller.ps2).toBeNull();
  });

  it('joins a trailing pipe with a space and a backslash with nothing', async () => {
    const { input, h } = setup();
    await type(input, 'echo a |');
    press(input, 'Enter');
    await type(input, 'cat');
    press(input, 'Enter');
    await vi.waitFor(() => expect(h.commits).toHaveLength(1));
    expect(h.commits[0]?.line).toBe('echo a | cat');
    await type(input, 'ec\\');
    press(input, 'Enter');
    await type(input, 'ho b');
    press(input, 'Enter');
    await vi.waitFor(() => expect(h.commits).toHaveLength(2));
    expect(h.commits[1]?.line).toBe('echo b');
  });
});

describe('a command reading a line', () => {
  it('asks rm -i’s question at the prompt, keeping the type-ahead for afterwards', async () => {
    const { input, controller, h, view } = setup();
    await type(input, 'rm -i a.txt');
    press(input, 'Enter');
    await vi.waitFor(() => expect(controller.read).not.toBeNull());
    await tick();
    expect(view.container.querySelector('.read-prompt')?.textContent).toBe("rm: remove regular file 'a.txt'? ");
    expect(input.getAttribute('aria-label')).toBe("rm: remove regular file 'a.txt'?");
    await type(input, 'y');
    press(input, 'Enter');
    await vi.waitFor(() => expect(h.commits).toHaveLength(1));
    expect(h.fs.exists('/home/guest/a.txt')).toBe(false);
  });
});

/**
 * Types `text` the way a keyboard does: a beforeinput for each character, and, unless the prompt
 * took it for itself, the browser's own insertion and an input event.
 */
function typeKeys(input: HTMLInputElement, text: string): void {
  for (const data of Array.from(text)) {
    const event = new InputEvent('beforeinput', { inputType: 'insertText', data, bubbles: true, cancelable: true });
    if (!input.dispatchEvent(event)) continue;
    const from = input.selectionStart ?? input.value.length;
    input.setRangeText(data, from, input.selectionEnd ?? from, 'end');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

/** A key's beforeinput: Backspace's deleteContentBackward, say. Returns whether it went ahead. */
function beforeInput(input: HTMLInputElement, inputType: string, data: string | null = null): boolean {
  return input.dispatchEvent(new InputEvent('beforeinput', { inputType, data, bubbles: true, cancelable: true }));
}

/** The input now in the prompt: a fresh one replaces it after an exposed password. */
const currentInput = (view: { container: Element }) => view.container.querySelector('input.command-input') as HTMLInputElement;

async function sudoPrompt(input: HTMLInputElement, controller: PromptController): Promise<void> {
  await type(input, 'sudo ls');
  press(input, 'Enter');
  await vi.waitFor(() => expect(controller.mode).toBe('secret'));
  await tick();
}

describe('sudo’s password', () => {
  it('is masked, and reaches no history, screen, storage or kill ring', async () => {
    const { input, controller, h, view } = setup();
    await sudoPrompt(input, controller);
    expect(view.container.textContent).toContain('[sudo] password for guest:');
    expect(view.container.querySelector('.hint')?.textContent).toBe(SUDO_HINT);
    expect(input.type).toBe('text');
    expect(input.closest('.input-box')?.classList.contains('secret')).toBe(true);
    expect(controller.chipList.chips.map((chip) => chip.label)).toEqual(['Cancel']);

    typeKeys(input, SECRET);
    // The mirror draws the cursor alone; nothing typed is shown.
    expect(view.container.querySelector('.mirror')?.textContent).toBe(' ');
    press(input, 'u', { ctrlKey: true });
    expect(controller.ring.entries).toEqual([]);
    press(input, 'y', { ctrlKey: true });
    expect(input.value).toBe('');
    typeKeys(input, SECRET);
    press(input, 'Enter');
    await vi.waitFor(() => expect(h.commits).toHaveLength(1));
    await tick();

    expect(h.commits[0]?.status).toBe(1);
    expect(JSON.stringify(h.commits)).not.toContain(SECRET);
    expect(JSON.stringify(h.shell.history.list())).not.toContain(SECRET);
    expect(JSON.stringify(controller.history)).not.toContain(SECRET);
    expect(JSON.stringify({ ...localStorage })).not.toContain(SECRET);
    expect(JSON.stringify({ ...sessionStorage })).not.toContain(SECRET);
    expect(controller.ring.entries.join('')).not.toContain(SECRET);
    expect(input.value).toBe('');
    expect(controller.text).toBe('');
    expect(document.body.innerHTML).not.toContain(SECRET);
  });

  it('never reaches the input’s value, which screen readers read out and undo keeps: only bullets do', async () => {
    const { input, controller, h } = setup();
    await sudoPrompt(input, controller);
    const values: string[] = [];
    input.addEventListener('input', () => values.push(input.value));
    typeKeys(input, SECRET);
    expect(input.value).toBe(SECRET_MASK.repeat(SECRET.length));
    // Editing works on the password itself, through the mask's caret.
    input.setSelectionRange(0, 0);
    expect(beforeInput(input, 'deleteContentForward')).toBe(false);
    input.setSelectionRange(SECRET.length - 1, SECRET.length - 1);
    expect(beforeInput(input, 'deleteContentBackward')).toBe(false);
    expect(beforeInput(input, 'insertText', 'X')).toBe(false);
    expect(beforeInput(input, 'insertFromPaste', 'pasted')).toBe(false);
    const paste = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(paste, 'clipboardData', { value: { getData: () => 'P' } });
    input.dispatchEvent(paste);
    // Two characters gone, then X, pasted and P: only ever bullets, one for each.
    expect(input.value).toBe(SECRET_MASK.repeat(SECRET.length - 2 + 1 + 6 + 1));
    expect(controller.text).toBe(input.value);
    press(input, 'Enter');
    await vi.waitFor(() => expect(h.commits).toHaveLength(1));
    expect(values.join('')).toBe('');
    expect(input.value).not.toContain('hunter');
  });

  it('is described by its dim hint, so a screen reader says it is a joke and nothing is kept', async () => {
    const { input, controller } = setup();
    expect(input.getAttribute('aria-describedby')).toBe('prompt-keys');
    await sudoPrompt(input, controller);
    const ids = (input.getAttribute('aria-describedby') ?? '').split(' ');
    const said = ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
    expect(said).toContain(SUDO_HINT);
    expect(ids).toContain(READ_HINT_ID);
  });

  it('is emptied when the prompt loses focus or the page is hidden', async () => {
    const { input, controller } = setup();
    await sudoPrompt(input, controller);
    typeKeys(input, SECRET);
    input.blur();
    expect(input.value).toBe('');
    expect(controller.text).toBe('');
    input.focus();
    typeKeys(input, SECRET);
    window.dispatchEvent(new Event('pagehide'));
    expect(input.value).toBe('');
    expect(controller.mode).toBe('secret');
  });

  it('takes what an input method composed, and puts a fresh input in place of the one that held it', async () => {
    const { input, controller, h, view } = setup();
    await sudoPrompt(input, controller);
    input.dispatchEvent(new CompositionEvent('compositionstart'));
    input.value = 'pw';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new CompositionEvent('compositionend'));
    expect(input.value).toBe(SECRET_MASK.repeat(2));
    press(input, 'Enter');
    await vi.waitFor(() => expect(h.commits).toHaveLength(1));
    await tick();
    // The old input's undo history may hold what was composed: it is gone, and the caret with
    // it moved to the new one.
    const fresh = currentInput(view);
    expect(fresh).not.toBe(input);
    expect(input.isConnected).toBe(false);
    expect(fresh.value).toBe('');
    expect(document.activeElement).toBe(fresh);
    await type(fresh, 'echo works');
    press(fresh, 'Enter');
    await vi.waitFor(() => expect(h.commits[h.commits.length - 1]?.line).toBe('echo works'));
  });

  it('never gives back what was typed ahead of it, which may be the password', async () => {
    const { input, controller, h, view } = setup();
    await type(input, 'sudo ls');
    press(input, 'Enter');
    // Typed while the command was still starting: as a visitor in a hurry types a password.
    await type(input, SECRET);
    await vi.waitFor(() => expect(controller.mode).toBe('secret'));
    expect(input.value).toBe('');
    const cancel = controller.chipList.chips[0];
    if (cancel === undefined) throw new Error('no Cancel chip');
    controller.choose(cancel);
    await vi.waitFor(() => expect(h.commits).toHaveLength(1));
    await tick();
    expect(h.commits[0]).toMatchObject({ status: 130, interrupted: true });
    expect(controller.mode).toBe('edit');
    expect(controller.text).toBe('');
    expect(controller.snapshotLine()).toBe('');
    // And the input it was typed into, with its undo history, is a fresh one.
    expect(currentInput(view)).not.toBe(input);
    expect(currentInput(view).value).toBe('');
  });
});

describe('history', () => {
  it('brings back a line continued at > as it was typed, and runs exactly that line', async () => {
    const { input, controller, h, view } = setup();
    await type(input, 'echo "a');
    press(input, 'Enter');
    await type(input, 'b"');
    press(input, 'Enter');
    await vi.waitFor(() => expect(h.commits).toHaveLength(1));
    expect(h.commits[0]?.line).toBe('echo "a\nb"');

    press(input, 'ArrowUp');
    await tick();
    // The input holds one line: the last; the one before waits at the > prompt, shown above.
    expect(input.value).toBe('b"');
    expect(controller.ps2?.lines).toEqual(['echo "a']);
    expect(view.container.querySelector('.frozen')?.textContent).toContain('echo "a');
    await type(input, 'b"X');
    press(input, 'Enter');
    await vi.waitFor(() => expect(h.commits).toHaveLength(2));
    expect(h.commits[1]?.line).toBe('echo "a\nb"X');

    // Down past it gives back the empty line, and the > lines go with it.
    press(input, 'ArrowUp');
    expect(controller.ps2).not.toBeNull();
    press(input, 'ArrowDown');
    expect(input.value).toBe('');
    expect(controller.ps2).toBeNull();
  });

  it('never puts a line break in the input from a search, the ghost or Alt+.', async () => {
    const { input, controller, h } = setup();
    await h.run('echo "x\ny"');
    press(input, 'r', { ctrlKey: true });
    await type(input, 'echo');
    press(input, 'ArrowRight');
    expect(input.value).toBe('y"');
    expect(controller.ps2?.lines).toEqual(['echo "x']);
    press(input, 'c', { ctrlKey: true });
    await type(input, 'echo');
    expect(controller.ghost).toBeNull();
    await type(input, 'ls ');
    press(input, '.', { altKey: true });
    expect(input.value).toBe('ls ');
  });

  it('keeps stepping after the cursor moves on a recalled line, as Up and Down do in bash', async () => {
    const { input, h } = setup();
    for (const line of ['echo one', 'echo two', 'echo three']) await h.run(line);
    await type(input, 'echo');
    press(input, 'ArrowUp');
    press(input, 'ArrowUp');
    expect(input.value).toBe('echo two');
    press(input, 'b', { altKey: true });
    press(input, 'Home');
    press(input, 'e', { ctrlKey: true });
    press(input, 'ArrowUp');
    expect(input.value).toBe('echo one');
    press(input, 'ArrowDown');
    press(input, 'ArrowDown');
    expect(input.value).toBe('echo three');
    press(input, 'ArrowDown');
    expect(input.value).toBe('echo');
  });

  it('brings the line being typed back with Down after a recalled line was edited', async () => {
    const { input, h } = setup();
    await h.run('echo "quoted arg here"');
    await type(input, 'echo');
    press(input, 'ArrowUp');
    expect(input.value).toBe('echo "quoted arg here"');
    await type(input, 'echo "quoted arg here"X');
    press(input, 'ArrowDown');
    expect(input.value).toBe('echo');
  });

  it('Ctrl+D’s exit is not kept in history, as bash never keeps it', async () => {
    const { input, h, controller } = setup();
    await h.run('pwd');
    press(input, 'd', { ctrlKey: true });
    await vi.waitFor(() => expect(h.commits[h.commits.length - 1]?.line).toBe('exit'));
    expect(controller.history).toEqual(['pwd']);
  });
});

describe('composition', () => {
  it('drops a Tab edit made while composing once the line has run', async () => {
    const { input, controller, h } = setup({ touch: true, dock: true });
    await engineReady(controller);
    await type(input, 'ca');
    input.dispatchEvent(new CompositionEvent('compositionstart'));
    controller.pressKey('Tab');
    expect(input.value).toBe('ca');
    // Enter from a keyboard that sends only a line break.
    beforeInput(input, 'insertLineBreak');
    await vi.waitFor(() => expect(h.commits.map((c) => c.line)).toEqual(['ca']));
    input.dispatchEvent(new CompositionEvent('compositionend'));
    expect(input.value).toBe('');
  });

  it('drops a Tab edit made while composing when the input method commits something else', async () => {
    const { input, controller } = setup({ touch: true, dock: true });
    await engineReady(controller);
    await type(input, 'ca');
    input.dispatchEvent(new CompositionEvent('compositionstart'));
    controller.pressKey('Tab');
    await type(input, 'calendar');
    input.dispatchEvent(new CompositionEvent('compositionend'));
    expect(input.value).toBe('calendar');
  });

  it('drops a Tab edit made while composing when a chip runs a line first', async () => {
    const { input, controller, h } = setup({ touch: true, dock: true });
    await engineReady(controller);
    await type(input, 'theme wo');
    input.dispatchEvent(new CompositionEvent('compositionstart'));
    controller.pressKey('Tab');
    const wombat = controller.chipList.chips.find((chip) => chip.label === 'wombat');
    if (wombat === undefined) throw new Error('no wombat chip');
    controller.choose(wombat);
    await vi.waitFor(() => expect(h.commits.map((c) => c.line)).toEqual(['theme wombat']));
    input.dispatchEvent(new CompositionEvent('compositionend'));
    expect(input.value).toBe('');
  });

  it('answers Display all N possibilities? from a keyboard that composes every letter', async () => {
    const { input, controller, h } = setup({ touch: true, dock: true });
    await engineReady(controller);
    h.fs.mkdir('/home/guest/many');
    for (let i = 1; i <= 120; i += 1) h.fs.writeFile(`/home/guest/many/f${String(i).padStart(3, '0')}`, '');
    await type(input, 'cat many/f');
    controller.pressKey('Tab');
    expect(controller.question).toBe('Display all 120 possibilities? (y or n)');
    // Gboard: keydown 229, then the letter as composition.
    expect(press(input, 'Unidentified', { keyCode: 229 } as KeyboardEventInit).defaultPrevented).toBe(false);
    input.dispatchEvent(new CompositionEvent('compositionstart'));
    input.value = 'cat many/fy';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(controller.question).toBeNull();
    expect(input.value).toBe('cat many/f');
    input.dispatchEvent(new CompositionEvent('compositionend'));
    await tick();
    expect(controller.listed).toBe(true);
    expect(controller.chipList.chips).toHaveLength(120);
    expect(input.value).toBe('cat many/f');
  });
});
