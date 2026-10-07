import { describe, expect, it, vi } from 'vitest';
import { createLineReader, type ReadRequest } from './reader';

describe('the line reader', () => {
  it('puts a read in its store and settles it with the answer', async () => {
    const reader = createLineReader();
    const seen: (ReadRequest | null)[] = [];
    reader.request.subscribe((value) => seen.push(value));
    const answer = reader.read({ prompt: 'name? ', hint: 'a hint' });
    const request = reader.request.get();
    expect(request).toMatchObject({ prompt: 'name? ', secret: false, hint: 'a hint' });
    reader.answer(request?.id ?? -1, 'guest');
    await expect(answer).resolves.toBe('guest');
    expect(reader.request.get()).toBeNull();
    expect(seen.map((value) => value?.prompt ?? null)).toEqual([null, 'name? ', null]);
  });

  it('ignores an answer to a read that is over', async () => {
    const reader = createLineReader();
    const first = reader.read({ prompt: 'one? ' });
    const firstId = reader.request.get()?.id ?? -1;
    const second = reader.read({ prompt: 'two? ' });
    // A second read ends the first with no answer.
    await expect(first).resolves.toBeNull();
    reader.answer(firstId, 'late');
    expect(reader.request.get()?.prompt).toBe('two? ');
    reader.answer(reader.request.get()?.id ?? -1, null);
    await expect(second).resolves.toBeNull();
  });

  it('ends with null when the job is interrupted, and clears the store', async () => {
    const reader = createLineReader();
    const controller = new AbortController();
    const answer = reader.read({ prompt: 'Password: ', secret: true, signal: controller.signal });
    expect(reader.request.get()?.secret).toBe(true);
    controller.abort();
    await expect(answer).resolves.toBeNull();
    expect(reader.request.get()).toBeNull();
    // Already interrupted: nothing is asked.
    await expect(reader.read({ prompt: 'again? ', signal: controller.signal })).resolves.toBeNull();
    expect(reader.request.get()).toBeNull();
  });

  it('opens its URL inside the answer, before the command hears it, unless the answer is ^D', async () => {
    const preflight = vi.fn((): 'opened' => 'opened');
    const reader = createLineReader(preflight);
    const opened = vi.fn();
    const answer = reader.read({ prompt: 'p ', opens: 'https://example.com/', opened });
    reader.answer(reader.request.get()?.id ?? -1, 'x');
    expect(preflight).toHaveBeenCalledWith('https://example.com/');
    expect(opened).toHaveBeenCalledWith('opened');
    await answer;

    const eof = reader.read({ prompt: 'p ', opens: 'https://example.com/', opened });
    reader.answer(reader.request.get()?.id ?? -1, null);
    await eof;
    expect(preflight).toHaveBeenCalledTimes(1);
  });
});
