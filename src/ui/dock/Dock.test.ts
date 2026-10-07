// The dock with a real prompt controller and shell: its layouts by visible height and keyboard,
// the hardware keyboard, the history sheet, and chips that run, insert and stop.
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { specFiles } from '../../commands/index';
import { createScreen } from '../../stores/screen';
import { hardwareKeyboard, keyBar } from '../../stores/prefs';
import { visibleArea } from '../../stores/viewport';
import { harness } from '../../testing/shell-harness';
import PromptLine from '../prompt/PromptLine.svelte';
import { PromptController } from '../prompt/promptController.svelte';
import Dock from './Dock.svelte';
import { LONG_PRESS_MS } from './press';

let cleanup: (() => void)[] = [];

beforeEach(() => {
  visibleArea.set({ height: 800, keyboardOpen: false });
  keyBar.set('auto');
  hardwareKeyboard.set(false);
});

afterEach(() => {
  for (const stop of cleanup.splice(0)) stop();
  vi.useRealTimers();
});

async function setup() {
  const h = harness({ specs: specFiles() });
  const transcript = createScreen();
  const controller = new PromptController({ shell: h.shell, screen: transcript, platform: 'other', touch: true, dock: true });
  const prompt = render(PromptLine, { props: { controller, shell: h.shell } });
  const dock = render(Dock, { props: { controller } });
  const input = prompt.container.querySelector('input.command-input') as HTMLInputElement;
  cleanup.push(() => {
    h.shell.abort();
    controller.destroy();
  });
  await vi.waitFor(() => expect(controller.completion).not.toBeNull());
  await tick();
  return { h, controller, input, dock: dock.container.querySelector('.dock') as HTMLElement, transcript };
}

const keyLabels = (root: HTMLElement) => Array.from(root.querySelectorAll('.key-bar .key')).map((key) => key.textContent);
const chipLabels = (root: HTMLElement) => Array.from(root.querySelectorAll('.chip .label')).map((chip) => chip.textContent);

async function tap(element: Element): Promise<void> {
  await fireEvent.pointerDown(element, { pointerType: 'touch' });
  await fireEvent.pointerUp(element, { pointerType: 'touch' });
  await fireEvent.click(element, { detail: 1 });
  await tick();
}

describe('Dock', () => {
  it('with the keyboard put away: the starters, then ⌨ Type a command… ↑ clear', async () => {
    const { dock, input } = await setup();
    expect(document.activeElement).not.toBe(input);
    expect(dock.dataset.dockMode).toBe('full');
    expect(chipLabels(dock)).toEqual(['help', 'cat README.md', 'fastfetch', 'ls', 'theme ls', 'cathode ls']);
    expect(keyLabels(dock)).toEqual(['⌨ Type a command…', '↑', 'clear']);
    await tap(screen.getByRole('button', { name: 'Type a command' }));
    expect(document.activeElement).toBe(input);
  });

  it('lays itself out by the visible height while typing: two rows, one row, the keys only', async () => {
    const { dock, input } = await setup();
    input.focus();
    await tick();
    expect(dock.querySelector('.chip-row')).not.toBeNull();
    expect(keyLabels(dock)).toEqual(['tab', '↑', '↓', '^C', 'clear', '•••', '⌄']);

    visibleArea.set({ height: 400, keyboardOpen: true });
    await tick();
    expect(dock.dataset.dockMode).toBe('compact');
    const row = dock.querySelector('.one-row') as HTMLElement;
    expect(keyLabels(row)).toEqual(['tab', '↑', '^C']);
    expect(row.querySelector('.chip-row')).not.toBeNull();

    visibleArea.set({ height: 250, keyboardOpen: true });
    await tick();
    expect(dock.dataset.dockMode).toBe('minimal');
    // The chips are not drawn; they are still there for screen readers, visually hidden.
    expect(dock.querySelector('.chip-row')?.closest('.sr-only')).not.toBeNull();
    expect(keyLabels(dock)).toEqual(['tab', '↑', '↓', '^C', 'clear', '•••', '⌄']);
  });

  it('shows Tab’s list in the minimal dock: the compact row while the list or its menu is open', async () => {
    const { dock, input } = await setup();
    input.focus();
    visibleArea.set({ height: 250, keyboardOpen: true });
    input.value = 'c';
    input.setSelectionRange(1, 1);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();
    expect(dock.querySelector('.one-row')).toBeNull();
    await tap(screen.getByRole('button', { name: 'Tab: complete' }));
    // Several commands start with c: the first press lists them, where they can be seen.
    const row = dock.querySelector('.one-row') as HTMLElement;
    expect(row).not.toBeNull();
    expect(row.querySelector('.chip-row')?.closest('.sr-only')).toBeNull();
    expect(chipLabels(row)).toContain('cat');
    expect(keyLabels(row)).toEqual(['tab', '↑', '^C']);
    // The next press steps through them, still in view, the choice marked.
    await tap(screen.getByRole('button', { name: 'Tab: complete' }));
    expect(dock.querySelector('.one-row .chip.selected')).not.toBeNull();
  });

  it('never points the input at a listbox that is not there', async () => {
    const { dock, input } = await setup();
    for (const keyboardOpen of [false, true]) {
      if (keyboardOpen) input.focus();
      visibleArea.set({ height: 250, keyboardOpen });
      await tick();
      const controls = input.getAttribute('aria-controls');
      expect(controls, String(keyboardOpen)).not.toBeNull();
      expect(dock.querySelector(`#${controls}`), String(keyboardOpen)).not.toBeNull();
    }
  });

  it('puts the key bar away after a hardware key, keeps the chips, and keys on brings it back', async () => {
    const { dock, input } = await setup();
    input.focus();
    await tick();
    // Typed letters on an iPhone's own keyboard, and Enter, say nothing.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13 }));
    await tick();
    expect(keyLabels(dock)).toHaveLength(7);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    await tick();
    expect(keyLabels(dock)).toEqual([]);
    expect(dock.querySelector('.chip-row')).not.toBeNull();
    keyBar.set('on');
    await tick();
    expect(keyLabels(dock)).toHaveLength(7);
    keyBar.set('off');
    hardwareKeyboard.set(false);
    await tick();
    expect(keyLabels(dock)).toEqual([]);
  });

  it('runs a starter in one tap without opening the keyboard', async () => {
    const { h, input } = await setup();
    await tap(screen.getByRole('option', { name: 'Run: ls' }));
    await vi.waitFor(() => expect(h.commits.map((c) => c.line)).toContain('ls'));
    expect(document.activeElement).not.toBe(input);
  });

  it("builds a line by tapping: 'the', then theme, set and wombat, which runs it", async () => {
    const { h, input, controller } = await setup();
    input.focus();
    input.value = 'the';
    input.setSelectionRange(3, 3);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();
    await tap(screen.getByRole('option', { name: 'Insert: theme' }));
    expect(input.value).toBe('theme ');
    await tap(screen.getByRole('option', { name: 'Insert: set' }));
    expect(input.value).toBe('theme set ');
    await tap(screen.getByRole('option', { name: 'Run: theme set wombat' }));
    await vi.waitFor(() => expect(h.commits.map((c) => c.line)).toContain('theme set wombat'));
    expect(h.appearance.currentTheme()).toBe('wombat');
    expect(document.activeElement).toBe(input);
    expect(controller.text).toBe('');
  });

  it('offers what follows a run, and a did-you-mean after a command was not found', async () => {
    const { dock, controller } = await setup();
    controller.submit('theme ls', 'chip');
    await vi.waitFor(() => expect(chipLabels(dock)[0]).toBe('theme set swamphen'));
    expect(chipLabels(dock)).toContain('theme set wombat');
    controller.submit('hlep', 'chip');
    await vi.waitFor(() => expect(chipLabels(dock)[0]).toBe('help'));
    expect(dock.querySelector('.chip')?.getAttribute('aria-label')).toBe('Run: help');
  });

  it('collapses to one cancel chip while a command runs, which stops it', async () => {
    const { h, dock, controller } = await setup();
    controller.submit('sleep 5', 'chip');
    await vi.waitFor(() => expect(chipLabels(dock)).toEqual(['cancel ^C']));
    await tap(screen.getByRole('option', { name: 'Cancel the running command (Control C)' }));
    await vi.waitFor(() => expect(h.commits.find((c) => c.line === 'sleep 5')?.status).toBe(130));
  });

  it('opens the history sheet when ↑ is held; a tap there puts the line at the prompt', async () => {
    const { input, controller } = await setup();
    controller.submit('pwd', 'chip');
    await vi.waitFor(() => expect(controller.running).toBeNull());
    input.focus();
    await tick();
    vi.useFakeTimers();
    const up = screen.getByRole('button', { name: 'Previous command (hold for history)' });
    await fireEvent.pointerDown(up, { pointerType: 'touch' });
    vi.advanceTimersByTime(LONG_PRESS_MS);
    await tick();
    const sheet = screen.getByRole('dialog', { name: 'History' });
    expect(sheet.contains(document.activeElement)).toBe(true);
    await fireEvent.pointerUp(up, { pointerType: 'touch' });
    vi.useRealTimers();
    await tap(within(sheet).getByRole('button', { name: 'Insert: pwd' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(input.value).toBe('pwd');
    expect(document.activeElement).toBe(input);
  });

  it('gives focus back to the ↑ key when the sheet closes, if the prompt did not have it', async () => {
    const { input, controller } = await setup();
    controller.submit('pwd', 'chip');
    await vi.waitFor(() => expect(controller.running).toBeNull());
    expect(document.activeElement).not.toBe(input);
    vi.useFakeTimers();
    const up = screen.getByRole('button', { name: 'Previous command (hold for history)' });
    await fireEvent.pointerDown(up, { pointerType: 'touch' });
    vi.advanceTimersByTime(LONG_PRESS_MS);
    await tick();
    await fireEvent.pointerUp(up, { pointerType: 'touch' });
    vi.useRealTimers();
    const sheet = screen.getByRole('dialog', { name: 'History' });
    expect(sheet.contains(document.activeElement)).toBe(true);
    await fireEvent.keyDown(sheet, { key: 'Escape' });
    await tick();
    expect(screen.queryByRole('dialog')).toBeNull();
    // Not the top of the page: the key the sheet was opened from, and no keyboard.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Previous command (hold for history)' }));
  });

  it('walks history with ↑ with the keyboard away, without opening it', async () => {
    const { input, controller } = await setup();
    controller.submit('pwd', 'chip');
    await vi.waitFor(() => expect(controller.running).toBeNull());
    await tap(screen.getByRole('button', { name: 'Previous command (hold for history)' }));
    expect(input.value).toBe('pwd');
    expect(document.activeElement).not.toBe(input);
    expect(screen.getByRole('option', { name: 'Run: pwd' })).toBeInTheDocument();
  });
});
