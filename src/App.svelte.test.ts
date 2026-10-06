import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App.svelte';
import { outputBlocks } from './interfaces/command';
import type { Shell } from './shell/index';
import { screen as transcript } from './stores/screen';
import { bannerBlocks } from './commands/lib/banner';
import { legacyAppShell } from './utils/legacyShell';

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
  await tick();
}

let shell: Shell;
let stopShell: () => void = () => {};

beforeEach(() => {
  const app = legacyAppShell({ banner: () => bannerBlocks({ version: '0.0.0-test', columns: 80, touch: false }), yieldToHost: () => Promise.resolve() });
  shell = app.shell;
  stopShell = app.stop;
});

afterEach(() => {
  shell.abort();
  stopShell();
  vi.unstubAllGlobals();
  // The transcript is a module store, so each test starts from an empty screen.
  transcript.clear();
});

const renderApp = () => render(App, { props: { shell } });
const banner = () => bannerBlocks({ version: '0.0.0-test', columns: 80, touch: false });

describe('App', () => {
  it('is a column of the screen frame, holding the transcript and the CRT overlay, then the dock slot', () => {
    const { container } = renderApp();
    const shell = container.querySelector('.shell');
    const [frame, dock] = Array.from(shell?.children ?? []);

    expect(frame?.className).toContain('screen-frame');
    expect(frame?.querySelector(':scope > main')).not.toBeNull();
    expect(frame?.querySelector(':scope > .crt-overlay')).not.toBeNull();
    expect(dock?.className).toContain('dock-slot');
    expect(dock?.children).toHaveLength(0);
    // Somewhere to tap to type: the prompt row and the space under it.
    expect(container.querySelectorAll('main [data-prompt-area]')).toHaveLength(2);
  });

  it('has one hidden heading, a labelled input and a polite log that is busy while a command runs', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
    // What app/bootstrap.ts puts in the transcript before the app mounts.
    transcript.push({ prompt: shell.renderPrompt(), line: 'banner', blocks: outputBlocks(banner()) });
    const { container } = renderApp();

    const headings = container.querySelectorAll('h1');
    expect(headings).toHaveLength(1);
    expect(headings[0]?.textContent).toBe('Vesen terminal');
    expect(headings[0]?.classList.contains('sr-only')).toBe(true);

    const prompt = screen.getByRole('combobox', { name: 'Terminal command' });
    expect(prompt.getAttribute('enterkeyhint')).toBe('go');

    const log = screen.getByRole('log');
    expect(log.getAttribute('aria-live')).toBe('polite');
    expect(log.getAttribute('aria-relevant')).toBe('additions');
    expect(log.getAttribute('aria-busy')).toBe('false');
    expect(log.textContent).toContain('to see all available commands.');

    await fireEvent.input(prompt, { target: { value: 'stock AAPL' } });
    await fireEvent.keyDown(prompt, { key: 'Enter' });
    await settle();
    expect(log.getAttribute('aria-busy')).toBe('true');

    await fireEvent.click(screen.getByRole('button', { name: 'Cancel running command' }));
    await settle();
    expect(log.getAttribute('aria-busy')).toBe('false');
    vi.useRealTimers();
  });


  it('cancels a running command when the processing line is tapped', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
    renderApp();
    const prompt = screen.getByRole('combobox');

    await fireEvent.input(prompt, { target: { value: 'stock AAPL' } });
    await fireEvent.keyDown(prompt, { key: 'Enter' });
    await settle();
    // The spinner draws its first frame straight away.
    const cancel = screen.getByRole('button', { name: 'Cancel running command' });
    // The status line says what the command is doing, and how to stop it.
    expect(cancel).toHaveTextContent(/fetching AAPL… \((tap|Ctrl\+C) to cancel\)/);

    // A tap must not be cancelled at pointerdown: WebKit on iOS then never sends the click.
    expect(await fireEvent.pointerDown(cancel)).toBe(true);
    // Cancelling mousedown keeps focus, and the phone keyboard, on the prompt.
    expect(await fireEvent.mouseDown(cancel)).toBe(false);

    await fireEvent.click(cancel);
    await settle();

    expect(screen.queryByRole('button', { name: 'Cancel running command' })).not.toBeInTheDocument();
    // The prompt returns at once with ^C, as in a terminal.
    expect(screen.getByText('^C')).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('runs a tapped did-you-mean as if it were typed', async () => {
    renderApp();
    const prompt = screen.getByRole('combobox');
    await fireEvent.input(prompt, { target: { value: 'pwdd' } });
    await fireEvent.keyDown(prompt, { key: 'Enter' });
    const suggestion = await screen.findByRole('button', { name: 'pwd' });
    expect(screen.getByText('vesen: pwdd: command not found')).toBeInTheDocument();

    await fireEvent.click(suggestion);
    await vi.waitFor(() => expect(screen.getByText('/home/guest')).toBeInTheDocument());
  });

  it('shows ~/documents in the prompt after cd, and earlier prompts keep their folder (F023)', async () => {
    const { container } = renderApp();
    const prompt = screen.getByRole('combobox');
    await fireEvent.input(prompt, { target: { value: 'cd documents' } });
    await fireEvent.keyDown(prompt, { key: 'Enter' });
    await vi.waitFor(() => expect(container.querySelectorAll('.entry')).toHaveLength(1));
    await fireEvent.input(prompt, { target: { value: 'pwd' } });
    await fireEvent.keyDown(prompt, { key: 'Enter' });
    await vi.waitFor(() => expect(container.querySelectorAll('.entry')).toHaveLength(2));
    await settle();

    const text = (element: Element | null | undefined) => element?.textContent?.replace(/\s+/g, '') ?? '';
    const prompts = Array.from(container.querySelectorAll('.entry .prompt'), (element) => text(element));
    expect(prompts).toEqual(['guest@vesen:~$', 'guest@vesen:~/documents$']);
    expect(text(container.querySelector('[data-prompt-area] .prompt'))).toBe('guest@vesen:~/documents$');
  });

  it('turns the live $ red after a failure', async () => {
    const { container } = renderApp();
    const dollar = () => {
      const spans = container.querySelectorAll('[data-prompt-area] .prompt span');
      return spans[spans.length - 1]?.getAttribute('style') ?? '';
    };
    expect(dollar()).toContain('--role-fg-strong');
    const prompt = screen.getByRole('combobox');
    await fireEvent.input(prompt, { target: { value: 'cd nowhere' } });
    await fireEvent.keyDown(prompt, { key: 'Enter' });
    await vi.waitFor(() => expect(dollar()).toContain('--role-error'));
  });
});

describe('Tab completion and the completion row', () => {
  const promptBox = () => screen.getByRole('combobox', { name: 'Terminal command' }) as HTMLInputElement;
  const press = async (key: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(promptBox(), { key, ...init });
  const type = async (value: string) => {
    await fireEvent.input(promptBox(), { target: { value } });
    promptBox().setSelectionRange(value.length, value.length);
  };

  /** Renders the app and waits for the engine's chunk. */
  async function ready() {
    const view = renderApp();
    await vi.waitFor(() => expect(view.container.querySelector('[data-completion="ready"]')).not.toBeNull());
    return view;
  }

  it("completes 'cat doc', then 'li', to cat documents/linux.txt", async () => {
    await ready();
    await type('cat doc');
    await press('Tab');
    expect(promptBox().value).toBe('cat documents/');
    await type('cat documents/li');
    await press('Tab');
    expect(promptBox().value).toBe('cat documents/linux.txt ');
    expect(promptBox().selectionStart).toBe(24);
  });

  it('extends, lists on the second Tab, cycles on the next, and Escape puts back what was typed', async () => {
    await ready();
    await type('ca');
    await press('Tab');
    expect(promptBox().value).toBe('cat');
    await press('Tab');
    await settle();
    expect(screen.getByRole('listbox', { name: 'Completions' })).toBeInTheDocument();
    expect(screen.getAllByRole('option').map((o) => o.textContent?.startsWith('cath') ? 'cathode' : 'cat')).toEqual(['cat', 'cathode']);

    await press('Tab');
    await settle();
    expect(promptBox().value).toBe('cat');
    expect(screen.getAllByRole('option')[0]?.getAttribute('aria-selected')).toBe('true');
    expect(promptBox().getAttribute('aria-activedescendant')).toBe('completion-list-0');
    await press('Tab');
    await settle();
    expect(promptBox().value).toBe('cathode');
    await press('Tab', { shiftKey: true });
    await settle();
    expect(promptBox().value).toBe('cat');

    const escape = await press('Escape');
    await settle();
    expect(escape).toBe(false);
    expect(promptBox().value).toBe('cat');
    expect(screen.queryByRole('listbox', { name: 'Completions' })).toBeNull();
  });

  it('Enter in the menu takes the choice without running it', async () => {
    await ready();
    await type('theme set k');
    await press('Tab');
    await press('Tab');
    await press('Tab');
    await settle();
    expect(promptBox().value).toBe('theme set kookaburra');
    await press('Enter');
    await settle();
    expect(promptBox().value).toBe('theme set kookaburra ');
    expect(transcript.entries()).toEqual([]);
  });

  it('shows chips while typing; a click puts the choice on the line as Tab would and keeps focus', async () => {
    await ready();
    promptBox().focus();
    await type('theme set k');
    await settle();
    const options = screen.getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['kangaroo', 'kookaburra']);
    expect(options[1]?.querySelector('.swatch')).not.toBeNull();
    expect(await fireEvent.mouseDown(options[1] as HTMLElement)).toBe(false);
    await fireEvent.click(options[1] as HTMLElement);
    await settle();
    expect(promptBox().value).toBe('theme set kookaburra ');
    expect(document.activeElement).toBe(promptBox());
  });

  it("rings the visual bell and says 'No completions' when nothing completes", async () => {
    const { container } = await ready();
    await type('zzz');
    await press('Tab');
    await settle();
    expect(container.querySelector('.input-box.bell')).not.toBeNull();
    expect(container.querySelector('.completion-row [aria-live="polite"]')?.textContent?.trim()).toBe('No completions');
    expect(promptBox().value).toBe('zzz');
  });

  it("asks 'Display all N possibilities? (y or n)' over 100, and y lists them", async () => {
    const { container } = await ready();
    await shell.run('mkdir many; touch many/f{001..150}');
    transcript.clear();
    await type('cat many/f');
    await press('Tab');
    await settle();
    expect(container.querySelector('.question')?.textContent).toBe('Display all 150 possibilities? (y or n)');
    expect(await press('y')).toBe(false);
    await settle();
    expect(container.querySelector('.question')).toBeNull();
    expect(screen.getAllByRole('option')).toHaveLength(150);
    expect(promptBox().value).toBe('cat many/f');
  });

  it('offers the starters on an empty line on a touch screen, which run in one tap without the keyboard', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('coarse'), media: query, addEventListener() {}, removeEventListener() {} }));
    await ready();
    await settle();
    const names = screen.getAllByRole('option').map((o) => o.getAttribute('aria-label'));
    expect(names).toEqual(['Run help', 'Run cat README.md', 'Run fastfetch', 'Run ls', 'Run theme ls', 'Run cathode ls']);
    await fireEvent.click(screen.getByRole('option', { name: 'Run ls' }));
    await vi.waitFor(() => expect(transcript.entries().map((e) => e.line)).toEqual(['ls']));
    expect(document.activeElement).not.toBe(promptBox());
  });
});
