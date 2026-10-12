// The frames loader (sudo's show): a 200 with a well-formed file gives its frames; anything else
// (a 404, a malformed body, a body over the cap, a fetch that fails, no URL) gives null and never
// throws, so the show's stage stays empty.
import { describe, expect, it, vi } from 'vitest';
import { FRAMES_MAX_CHARS } from '../lib/frames';
import { loadFrames, type FramesFetch } from './frames';

const FILE = 'vesen-frames fps=2 cols=2 rows=1\nab\n===\ncd\n';
const URL = '/audio/incident-report.frames';

/** A fetch that answers every request the same way, recording what it was asked. */
function answering(status: number, body: string, headers: Record<string, string> = {}) {
  const calls: { url: string; init: unknown }[] = [];
  const fetchFn: FramesFetch = async (url, init) => {
    calls.push({ url, init });
    return {
      status,
      headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
      text: () => Promise.resolve(body),
    };
  };
  return { fetchFn, calls };
}

describe('loadFrames', () => {
  it('fetches the file from this origin and parses a 200', async () => {
    const { fetchFn, calls } = answering(200, FILE, { 'content-length': String(FILE.length) });
    const file = await loadFrames(URL, fetchFn);
    expect(file).toMatchObject({ fps: 2, cols: 2, rows: 1 });
    expect(file?.frames.map((frame) => frame.text)).toEqual(['ab', 'cd']);
    expect(calls).toEqual([{ url: URL, init: { credentials: 'same-origin' } }]);
  });

  it('is null for a 404, however the body reads', async () => {
    expect(await loadFrames(URL, answering(404, FILE).fetchFn)).toBeNull();
    expect(await loadFrames(URL, answering(404, '<!doctype html>').fetchFn)).toBeNull();
  });

  it('is null for a malformed body, even with a 200', async () => {
    expect(await loadFrames(URL, answering(200, '<!doctype html>\n<html>').fetchFn)).toBeNull();
    expect(await loadFrames(URL, answering(200, '').fetchFn)).toBeNull();
  });

  it('is null for a body the server says is over the cap, without reading it', async () => {
    const text = vi.fn(() => Promise.resolve(FILE));
    const fetchFn: FramesFetch = async () => ({ status: 200, headers: { get: () => String(FRAMES_MAX_CHARS + 1) }, text });
    expect(await loadFrames(URL, fetchFn)).toBeNull();
    expect(text).not.toHaveBeenCalled();
  });

  it('is null when fetch fails or the body cannot be read, and for no URL', async () => {
    expect(await loadFrames(URL, () => Promise.reject(new TypeError('Failed to fetch')))).toBeNull();
    const fetchFn: FramesFetch = async () => ({ status: 200, text: () => Promise.reject(new Error('cut short')) });
    expect(await loadFrames(URL, fetchFn)).toBeNull();
    const asked = answering(200, FILE);
    expect(await loadFrames('', asked.fetchFn)).toBeNull();
    expect(asked.calls).toEqual([]);
  });

  it('passes the signal it is given', async () => {
    const { fetchFn, calls } = answering(200, FILE);
    const controller = new AbortController();
    await loadFrames(URL, fetchFn, controller.signal);
    expect(calls[0]?.init).toEqual({ credentials: 'same-origin', signal: controller.signal });
  });
});
