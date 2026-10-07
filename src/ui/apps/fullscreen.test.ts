// The pager and the editor in the whole app (wave F): while one shows, the shell under it is
// inert and the prompt and the dock take no keys, Esc included, which closes the app and never
// interrupts the line; when it closes, focus is back in the prompt. 'man ls' pages and q closes
// it; 'nano notes.txt' is typed in, written out and left, and cat shows the text.
import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../App.svelte';
import { createAppShell } from '../../app/shell';
import type { Shell } from '../../shell/index';
import { screen as transcript } from '../../stores/screen';

let shell: Shell;
let stopShell: () => void = () => {};

beforeEach(async () => {
  const app = createAppShell({ banner: () => [], yieldToHost: () => Promise.resolve() });
  shell = app.shell;
  stopShell = app.stop;
  await shell.registry.whenComplete();
});

afterEach(() => {
  shell.abort();
  stopShell();
  transcript.clear();
});

const prompt = () => screen.getByRole('combobox', { name: 'Terminal command' }) as HTMLInputElement;

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
  await tick();
}

async function type(line: string): Promise<void> {
  await fireEvent.input(prompt(), { target: { value: line } });
  await fireEvent.keyDown(prompt(), { key: 'Enter' });
  await settle();
}

/** The output of the entry for `line`, once it has finished. */
function outputOf(line: string): string {
  const entry = transcript.entries().find((candidate) => candidate.line === line && candidate.state !== 'running');
  return (entry?.blocks ?? []).map((block) => (block.type === 'lines' ? block.lines.map((l) => l.map((s) => s.text).join('')).join('\n') : '')).join('\n');
}

describe('a full-screen app over the terminal', () => {
  it('owns the keys while it shows, Esc closes it without interrupting the line, and the prompt has focus after', async () => {
    const { container } = render(App, { props: { shell } });
    await type('less README.md');
    await vi.waitFor(() => expect(container.querySelector('[data-pager]')).not.toBeNull());
    expect(container.querySelector('.shell')?.hasAttribute('inert')).toBe(true);
    expect(document.activeElement).not.toBe(prompt());

    // A letter is the pager's (or nothing), never the prompt's.
    await fireEvent.keyDown(document.activeElement ?? window, { key: 'x' });
    await fireEvent.keyDown(window, { key: 'j' });
    expect(prompt().value).toBe('');
    expect(document.activeElement).not.toBe(prompt());
    // Nor with nothing focused, when a key would otherwise go to the prompt.
    (document.activeElement as HTMLElement | null)?.blur();
    await fireEvent.keyDown(document.body, { key: 'y' });
    expect(document.activeElement).not.toBe(prompt());

    await fireEvent.keyDown(window, { key: 'Escape' });
    await vi.waitFor(() => expect(container.querySelector('[data-pager]')).toBeNull());
    await vi.waitFor(() => expect(transcript.entries().find((entry) => entry.line === 'less README.md')?.state).not.toBe('running'));
    expect(outputOf('less README.md')).toBe('');
    expect(container.querySelector('.shell')?.hasAttribute('inert')).toBe(false);
    await vi.waitFor(() => expect(document.activeElement).toBe(prompt()));
  });

  it("pages 'man ls', and q closes it", async () => {
    const { container } = render(App, { props: { shell } });
    await type('man ls');
    const pager = await vi.waitFor(() => {
      const found = container.querySelector('[data-pager]');
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    expect(pager.textContent).toMatch(/LS\(1\) +User Commands +LS\(1\)/);
    expect(pager.querySelector('.status')?.textContent).toContain('Manual page ls(1)');
    await fireEvent.keyDown(window, { key: 'q' });
    await vi.waitFor(() => expect(container.querySelector('[data-pager]')).toBeNull());
    await vi.waitFor(() => expect(document.activeElement).toBe(prompt()));
  });

  it("edits with 'nano notes.txt': type, ^O and Enter, ^X, and cat shows the text", async () => {
    const { container } = render(App, { props: { shell } });
    await type('nano notes.txt');
    const area = await vi.waitFor(() => {
      const found = container.querySelector('[data-editor] textarea');
      expect(found).not.toBeNull();
      return found as HTMLTextAreaElement;
    });
    await vi.waitFor(() => expect(document.activeElement).toBe(area));
    await fireEvent.input(area, { target: { value: 'written in nano' } });
    await fireEvent.keyDown(area, { key: 'o', ctrlKey: true });
    await tick();
    const name = screen.getByRole('textbox', { name: 'File Name to Write:' }) as HTMLInputElement;
    await fireEvent.submit(name.form as HTMLFormElement);
    await tick();
    expect(container.querySelector('[data-editor] .status')?.textContent).toBe('[ Wrote 1 line ]');
    await fireEvent.keyDown(area, { key: 'x', ctrlKey: true });
    await vi.waitFor(() => expect(container.querySelector('[data-editor]')).toBeNull());
    await vi.waitFor(() => expect(document.activeElement).toBe(prompt()));
    expect(prompt().value).toBe('');

    await type('cat notes.txt');
    await vi.waitFor(() => expect(outputOf('cat notes.txt')).toBe('written in nano'));
  });
});
