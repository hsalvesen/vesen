import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lineText, type Block } from '../output/model';
import type { Shell } from '../shell/index';
import { screen as transcript } from '../stores/screen';
import { commandHistory } from '../utils/legacyStores';
import { legacyAppShell } from '../utils/legacyShell';
import Input from './Input.svelte';

/** Lets pending promise callbacks and Svelte updates run, without moving any timer. */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
  await tick();
}

function prompt(): HTMLInputElement {
  return screen.getByRole('textbox') as HTMLInputElement;
}

async function type(text: string): Promise<void> {
  await fireEvent.input(prompt(), { target: { value: text } });
}

function ctrlC(): KeyboardEvent {
  return new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true, cancelable: true });
}

const lastEntry = () => {
  const entries = transcript.entries();
  return entries[entries.length - 1];
};
const entries = () => transcript.entries();
const promptOf = (entry: ReturnType<typeof lastEntry>) => entry?.prompt?.map((span) => span.text).join('');

/** The text of an entry's output, which the shell records as blocks. */
const outputText = (output: unknown): string =>
  (output as Block[]).map((block) => (block.type === 'lines' ? block.lines.map(lineText).join('\n') : '')).join('\n');

let shell: Shell;
let stopShell: () => void = () => {};

/** Mounts the prompt over a fresh shell. */
function renderInput() {
  return render(Input, { props: { shell } });
}

beforeEach(() => {
  transcript.clear();
  commandHistory.set([]);
  const app = legacyAppShell({ banner: () => 'BANNER', yieldToHost: () => Promise.resolve() });
  shell = app.shell;
  stopShell = app.stop;
});

afterEach(() => {
  shell.abort();
  stopShell();
  window.getSelection()?.removeAllRanges();
  document.body.querySelectorAll('[data-test-text]').forEach((node) => node.remove());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Ctrl+C', () => {
  it('leaves the event alone when text is selected in the page, so the browser copies it', async () => {
    renderInput();
    await type('echo hello');
    const text = document.createElement('p');
    text.dataset.testText = '';
    text.textContent = 'some earlier output';
    document.body.append(text);
    const range = document.createRange();
    range.selectNodeContents(text);
    window.getSelection()?.addRange(range);

    const event = ctrlC();
    prompt().dispatchEvent(event);
    await settle();

    expect(event.defaultPrevented).toBe(false);
    expect(entries()).toEqual([]);
    expect(prompt().value).toBe('echo hello');
  });

  it('leaves the event alone when text is selected in the prompt', async () => {
    renderInput();
    await type('echo hello');
    prompt().focus();
    prompt().setSelectionRange(0, 4);

    const event = ctrlC();
    prompt().dispatchEvent(event);
    await settle();

    expect(event.defaultPrevented).toBe(false);
    expect(entries()).toEqual([]);
  });

  it('with nothing selected, abandons the line with ^C and keeps it out of history', async () => {
    renderInput();
    await type('echo hello');

    const event = ctrlC();
    prompt().dispatchEvent(event);
    await settle();

    expect(event.defaultPrevented).toBe(true);
    expect(lastEntry()).toMatchObject({ line: 'echo hello^C', blocks: [] });
    expect(promptOf(lastEntry())).toBe('guest@vesen:~$');
    expect(prompt().value).toBe('');
    expect(get(commandHistory)).toEqual([]);
  });
});

describe('a running command', () => {
  beforeEach(() => {
    // A proxy that never answers and ignores the abort signal.
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
  });

  it('is interrupted at once by Ctrl+C, without waiting for the request', async () => {
    renderInput();
    await type('stock AAPL');
    await fireEvent.keyDown(prompt(), { key: 'Enter' });
    // The network commands load on first use, then make the request.
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    await settle();

    expect(screen.getByText('stock AAPL')).toBeInTheDocument();
    expect(entries()).toEqual([]);

    prompt().dispatchEvent(ctrlC());
    await vi.waitFor(() => expect(lastEntry()?.line).toBe('stock AAPL'));

    // The prompt returns at once with ^C, and the late output of the request is dropped.
    expect(outputText(lastEntry()?.blocks)).toBe('^C');
    expect(get(commandHistory)).toEqual(['stock AAPL']);
    expect(screen.queryByText('stock AAPL')).not.toBeInTheDocument();
  });

  it('is interrupted by Escape too', async () => {
    renderInput();
    await type('curl example.com');
    await fireEvent.keyDown(prompt(), { key: 'Enter' });
    await settle();

    await fireEvent.keyDown(prompt(), { key: 'Escape' });
    await vi.waitFor(() => expect(lastEntry()?.line).toBe('curl example.com'));

    expect(outputText(lastEntry()?.blocks)).toBe('^C');
  });

  it('keeps the prompt enabled and takes type-ahead, but ignores Enter until it finishes', async () => {
    renderInput();
    await type('weather Oslo');
    await fireEvent.keyDown(prompt(), { key: 'Enter' });
    await settle();

    expect(prompt().disabled).toBe(false);
    expect(prompt().readOnly).toBe(false);
    expect(prompt().value).toBe('');

    await type('ls');
    const enterWhileBusy = await fireEvent.keyDown(prompt(), { key: 'Enter' });
    await settle();
    expect(enterWhileBusy).toBe(false); // the default was prevented
    expect(entries()).toEqual([]);

    prompt().dispatchEvent(ctrlC());
    await vi.waitFor(() => expect(entries()).toHaveLength(1));
    expect(lastEntry()?.line).toBe('weather Oslo');
    expect(prompt().value).toBe('ls');
  });
});

describe('sudo', () => {
  it('asks for a password however the line is typed: leading spaces and quotes make no difference', async () => {
    for (const line of ['sudo ls', '   sudo ls', "'sudo' ls"]) {
      const { unmount } = renderInput();
      await type(line);
      await fireEvent.keyDown(prompt(), { key: 'Enter' });
      await settle();
      // A password field is no longer a textbox to assistive technology.
      expect(document.querySelector('input.command-input')?.getAttribute('type'), line).toBe('password');
      expect(lastEntry()).toMatchObject({ line, blocks: [] });
      unmount();
    }
    expect(get(commandHistory)).toEqual(['sudo ls', "'sudo' ls"]);
  });

  it('runs sudo --help like any command', async () => {
    renderInput();
    await type('sudo --help');
    await fireEvent.keyDown(prompt(), { key: 'Enter' });
    await vi.waitFor(() => expect(lastEntry()?.line).toBe('sudo --help'));
    expect(prompt().type).toBe('text');
  });
});

describe('focus', () => {
  it('starts in the prompt with a mouse and keyboard', () => {
    renderInput();
    expect(document.activeElement).toBe(prompt());
  });

  it('waits for a tap on touch, where focus would open the keyboard over the page', () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) => ({ matches: query === '(pointer: coarse)' }) as MediaQueryList,
    );
    renderInput();
    expect(document.activeElement).not.toBe(prompt());
  });

  it('comes back to the prompt after a command only if it was there at submit', async () => {
    renderInput();
    await type('echo one');
    await fireEvent.keyDown(prompt(), { key: 'Enter' });
    await vi.waitFor(() => expect(lastEntry()?.line).toBe('echo one'));
    expect(document.activeElement).toBe(prompt());

    prompt().blur();
    await type('echo two');
    await fireEvent.keyDown(prompt(), { key: 'Enter' });
    await vi.waitFor(() => expect(lastEntry()?.line).toBe('echo two'));
    expect(document.activeElement).not.toBe(prompt());
  });

  it('stays put away when the visitor dismissed the keyboard while a command ran', async () => {
    let answer: (response: Response) => void = () => {};
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => (answer = resolve))));
    renderInput();
    prompt().focus();
    await type('curl https://example.com');
    await fireEvent.keyDown(prompt(), { key: 'Enter' });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());

    prompt().blur();
    answer(new Response('# readme'));
    await vi.waitFor(() => expect(lastEntry()?.line).toBe('curl https://example.com'));
    await settle();
    expect(document.activeElement).not.toBe(prompt());
  });

  it('stays put away when the visitor dismissed the keyboard and then tapped cancel', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
    renderInput();
    prompt().focus();
    await type('curl https://example.com');
    await fireEvent.keyDown(prompt(), { key: 'Enter' });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());

    prompt().blur();
    shell.abort();
    await vi.waitFor(() => expect(lastEntry()?.line).toBe('curl https://example.com'));
    await settle();
    expect(document.activeElement).not.toBe(prompt());
  });
});

describe('keys meant for other controls', () => {
  const key = (target: EventTarget, init: KeyboardEventInit): KeyboardEvent => {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);
    return event;
  };

  it('holds Tab in the prompt for completion, but lets Escape then Tab leave the terminal', async () => {
    renderInput();
    prompt().focus();
    expect(key(prompt(), { key: 'Tab' }).defaultPrevented).toBe(true);

    key(prompt(), { key: 'Escape' });
    expect(key(prompt(), { key: 'Tab' }).defaultPrevented).toBe(false);

    // Shift+Tab: the Shift press in between does not count as another key.
    key(prompt(), { key: 'Escape' });
    key(prompt(), { key: 'Shift', shiftKey: true });
    expect(key(prompt(), { key: 'Tab', shiftKey: true }).defaultPrevented).toBe(false);

    // Any other key in between, or waiting too long, goes back to completing.
    key(prompt(), { key: 'Escape' });
    key(prompt(), { key: 'a' });
    expect(key(prompt(), { key: 'Tab' }).defaultPrevented).toBe(true);

    const now = vi.spyOn(performance, 'now').mockReturnValue(10_000);
    key(prompt(), { key: 'Escape' });
    now.mockReturnValue(11_001);
    expect(key(prompt(), { key: 'Tab' }).defaultPrevented).toBe(true);
  });

  it('leaves Enter on a button to the button', async () => {
    renderInput();
    const button = document.createElement('button');
    button.dataset.testText = '';
    document.body.append(button);
    await type('echo hello');

    const enter = key(button, { key: 'Enter' });
    await settle();
    expect(enter.defaultPrevented).toBe(false);
    expect(entries()).toEqual([]);
    expect(prompt().value).toBe('echo hello');

    expect(key(button, { key: 'ArrowUp' }).defaultPrevented).toBe(false);
    expect(key(button, { key: 'Tab' }).defaultPrevented).toBe(false);
  });

  it('leaves Enter on the cancel button to it while a command runs', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
    renderInput();
    await type('curl https://example.com');
    await fireEvent.keyDown(prompt(), { key: 'Enter' });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());

    const button = document.createElement('button');
    button.dataset.testText = '';
    document.body.append(button);
    expect(key(button, { key: 'Enter' }).defaultPrevented).toBe(false);
    shell.abort();
    await vi.waitFor(() => expect(lastEntry()?.line).toBe('curl https://example.com'));
  });
});
