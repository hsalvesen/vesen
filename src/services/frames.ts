// Fetches the owner's frames file for sudo's show (lib/frames.ts has the format) from this
// origin when the Rick app (ui/apps/Rick.svelte) opens; the boot warmed the browser's cache for
// it at idle (services/warm-show.ts), so this is usually answered from there, and nothing is
// fetched on `sudo --help`. Anything but a 200 with a well-formed file under the size cap gives
// null, and the show's stage stays empty; no error ever leaves here.

import { FRAMES_MAX_CHARS, parseFramesFile, type FramesFile } from '../lib/frames';

/** Fetches a frames file; null where there is none to play. */
export type FramesLoader = (url: string) => Promise<FramesFile | null>;

/** The least fetch needs to give: a status and a body, the way the browser's fetch does. */
export interface FramesResponse {
  readonly status: number;
  readonly headers?: { get(name: string): string | null };
  text(): Promise<string>;
}

export type FramesFetch = (url: string, init: { credentials: 'same-origin'; signal?: AbortSignal }) => Promise<FramesResponse>;

/** Loads `url` with `fetchFn` (the browser's fetch by default) and parses it. */
export async function loadFrames(url: string, fetchFn?: FramesFetch, signal?: AbortSignal): Promise<FramesFile | null> {
  if (url === '') return null;
  const doFetch = fetchFn ?? (typeof fetch === 'function' ? (fetch as FramesFetch) : null);
  if (doFetch === null) return null;
  try {
    const response = await doFetch(url, { credentials: 'same-origin', ...(signal ? { signal } : {}) });
    if (response.status !== 200) return null;
    const length = Number(response.headers?.get('content-length') ?? '0');
    if (Number.isFinite(length) && length > FRAMES_MAX_CHARS) return null;
    const text = await response.text();
    return parseFramesFile(text);
  } catch {
    return null;
  }
}
