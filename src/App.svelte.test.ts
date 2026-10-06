import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App.svelte';
import { outputBlocks } from './interfaces/command';
import type { Shell } from './shell/index';
import { screen as transcript } from './stores/screen';
import { systemCommands } from './utils/commands/system';
import { legacyAppShell } from './utils/legacyShell';

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
  await tick();
}

let shell: Shell;
let stopShell: () => void = () => {};

beforeEach(() => {
  const app = legacyAppShell({ banner: () => systemCommands.banner(), yieldToHost: () => Promise.resolve() });
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
    transcript.push({ prompt: shell.renderPrompt(), line: 'banner', blocks: outputBlocks(systemCommands.banner()) });
    const { container } = renderApp();

    const headings = container.querySelectorAll('h1');
    expect(headings).toHaveLength(1);
    expect(headings[0]?.textContent).toBe('Vesen terminal');
    expect(headings[0]?.classList.contains('sr-only')).toBe(true);

    const prompt = screen.getByRole('textbox', { name: 'Terminal command' });
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
    const prompt = screen.getByRole('textbox');

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
    const prompt = screen.getByRole('textbox');
    await fireEvent.input(prompt, { target: { value: 'pwdd' } });
    await fireEvent.keyDown(prompt, { key: 'Enter' });
    const suggestion = await screen.findByRole('button', { name: 'pwd' });
    expect(screen.getByText('vesen: pwdd: command not found')).toBeInTheDocument();

    await fireEvent.click(suggestion);
    await vi.waitFor(() => expect(screen.getByText('/home/guest')).toBeInTheDocument());
  });

  it('shows ~/documents in the prompt after cd, and earlier prompts keep their folder (F023)', async () => {
    const { container } = renderApp();
    const prompt = screen.getByRole('textbox');
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
    const prompt = screen.getByRole('textbox');
    await fireEvent.input(prompt, { target: { value: 'cd nowhere' } });
    await fireEvent.keyDown(prompt, { key: 'Enter' });
    await vi.waitFor(() => expect(dollar()).toContain('--role-error'));
  });
});
