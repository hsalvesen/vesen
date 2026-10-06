import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commandHistory, history } from '../stores/history';
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

const lastEntry = () => get(history).at(-1);

beforeEach(() => {
  history.set([]);
  commandHistory.set([]);
});

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  document.body.querySelectorAll('[data-test-text]').forEach((node) => node.remove());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Ctrl+C', () => {
  it('leaves the event alone when text is selected in the page, so the browser copies it', async () => {
    render(Input);
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
    expect(get(history)).toEqual([]);
    expect(prompt().value).toBe('echo hello');
  });

  it('leaves the event alone when text is selected in the prompt', async () => {
    render(Input);
    await type('echo hello');
    prompt().focus();
    prompt().setSelectionRange(0, 4);

    const event = ctrlC();
    prompt().dispatchEvent(event);
    await settle();

    expect(event.defaultPrevented).toBe(false);
    expect(get(history)).toEqual([]);
  });

  it('with nothing selected, abandons the line with ^C and keeps it out of history', async () => {
    render(Input);
    await type('echo hello');

    const event = ctrlC();
    prompt().dispatchEvent(event);
    await settle();

    expect(event.defaultPrevented).toBe(true);
    expect(lastEntry()).toEqual({ command: 'echo hello^C', outputs: [] });
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
    render(Input);
    await type('stock AAPL');
    await fireEvent.keyDown(prompt(), { key: 'Enter' });
    await settle();

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(screen.getByText('stock AAPL')).toBeInTheDocument();
    expect(get(history)).toEqual([]);

    prompt().dispatchEvent(ctrlC());
    await settle();

    expect(lastEntry()?.command).toBe('stock AAPL');
    expect(lastEntry()?.outputs[0]).toContain('Stock request cancelled');
    expect(get(commandHistory)).toEqual(['stock AAPL']);
    expect(screen.queryByText('stock AAPL')).not.toBeInTheDocument();
  });

  it('is interrupted by Escape too', async () => {
    render(Input);
    await type('curl example.com');
    await fireEvent.keyDown(prompt(), { key: 'Enter' });
    await settle();

    await fireEvent.keyDown(prompt(), { key: 'Escape' });
    await settle();

    expect(lastEntry()?.outputs[0]).toContain('Request cancelled');
  });

  it('keeps the prompt enabled and takes type-ahead, but ignores Enter until it finishes', async () => {
    render(Input);
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
    expect(get(history)).toEqual([]);

    prompt().dispatchEvent(ctrlC());
    await settle();

    expect(get(history)).toHaveLength(1);
    expect(lastEntry()?.command).toBe('weather Oslo');
    expect(prompt().value).toBe('ls');
  });
});
