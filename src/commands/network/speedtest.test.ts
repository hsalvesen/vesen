// speedtest (F027, F028): time-bounded phases over streamed bodies, checked responses, a light
// run on phones and slow or metered connections, the shell's question before it spends the data,
// and ^C that stops reading at once. The meter runs on a fake clock and fake streams, so every
// figure is exact; the command runs over a mocked fetch. Nothing reaches the network.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runLine, session } from '../../../tests/harness';
import { lineText, type Block } from '../../output/model';
import type { Net, NetStream, StreamInit } from '../../services/types';
import { dataCostQuestion } from '../../shell/data-cost';
import speedtest, { PROFILES, requested } from './speedtest';
import { LATENCY_REQUESTS, PHASE_MS, lightBecause, measure, mbps, profile, resultRows, type MeterDeps } from './speedtest.run';

const MiB = 1024 * 1024;
const CHUNK = 64 * 1024;

class FakeNetError extends Error {
  constructor(readonly kind: 'abort' | 'cors' | 'http' | 'timeout', readonly status?: number) {
    super(kind);
  }
}

interface Link {
  /** Download speed, in bytes per millisecond: 12_500 is 100 Mbps. */
  readonly down: number;
  readonly up: number;
  /** Each latency request's round trip, in turn. */
  readonly pings: readonly number[];
}

/**
 * A fake connection on a fake clock: each read of a body moves the clock on by the time its chunk
 * takes on the link. Records what was opened, how many reads each body had, and what was cancelled.
 */
function fakeLink(link: Link, options: { upload?: 'blocked'; contentType?: string; onRead?: (reads: number) => void } = {}) {
  let now = 0;
  let pings = 0;
  let reads = 0;
  const opened: string[] = [];
  const cancelled: string[] = [];

  const stream = (url: string, bytes: number, headers: Record<string, string>, signal?: AbortSignal): NetStream => {
    let left = bytes;
    let done = false;
    return {
      url,
      status: 200,
      statusText: 'OK',
      type: 'cors',
      redirected: false,
      headers,
      cancel: () => {
        if (!done) cancelled.push(url);
        done = true;
      },
      read: async () => {
        if (signal?.aborted) throw new FakeNetError('abort');
        if (done || left === 0) return null;
        reads += 1;
        const size = Math.min(CHUNK, left);
        left -= size;
        now += size / link.down;
        options.onRead?.(reads);
        return new Uint8Array(size);
      },
    };
  };

  const net: Pick<Net, 'open' | 'isError'> = {
    isError: (error: unknown): error is never => error instanceof FakeNetError,
    async open(url: string, init: StreamInit = {}) {
      opened.push(url);
      if (init.method === 'POST') {
        if (options.upload === 'blocked') throw new FakeNetError('cors');
        // One round trip, the shortest, on top of sending the body.
        now += (init.body?.length ?? 0) / link.up + Math.min(...link.pings);
        return stream(url, 0, {}, init.signal);
      }
      const bytes = Number(new URL(url).searchParams.get('bytes'));
      if (bytes === 0) now += link.pings[pings++ % link.pings.length] ?? 0;
      return stream(url, bytes, { 'content-type': options.contentType ?? 'application/octet-stream', 'cf-meta-colo': 'SYD' }, init.signal);
    },
  };
  const status = vi.fn();
  const deps = (signal = new AbortController().signal): MeterDeps => ({
    net,
    now: () => now,
    signal,
    status,
    // The phases end by the fake clock alone.
    deadline: () => ({ signal: new AbortController().signal, cancel: () => {} }),
  });
  return { deps, opened, cancelled, status, reads: () => reads, now: () => now };
}

const downloads = (opened: readonly string[]): number[] =>
  opened.filter((url) => url.includes('/__down') && !url.endsWith('bytes=0')).map((url) => Number(new URL(url).searchParams.get('bytes')) / MiB);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the meter', () => {
  it('measures latency, download and upload, each body counted as it streams', async () => {
    const link = fakeLink({ down: 12_500, up: 6_250, pings: [20, 24, 18, 22] });
    const result = await measure(profile('full'), link.deps());
    // 20, 24, 18, 22, 20, 24, 18, 22, 20, 24.
    expect(result.latency).toMatchObject({ samples: LATENCY_REQUESTS, min: 18, max: 24, avg: 21.2 });
    // The mean change from one ping to the next: 4, 6, 4, 2, 4, 6, 4, 2, 4.
    expect(result.latency?.jitter).toBe(4);
    expect(downloads(link.opened)).toEqual([1, 2, 5, 10, 25]);
    expect(result.download?.bytes).toBe(43 * MiB);
    expect(result.download?.mbps).toBeCloseTo(100, 5);
    // Upload is timed less one round trip (the shortest ping).
    expect(result.upload).toMatchObject({ bytes: (256 * 1024 + 3 * MiB), samples: 3 });
    expect(typeof result.upload === 'object' ? result.upload.mbps : 0).toBeCloseTo(50, 5);
    expect(result).toMatchObject({ profile: 'full', colo: 'SYD', bytesDown: 43 * MiB, bytesUp: 256 * 1024 + 3 * MiB });
    expect(link.status).toHaveBeenLastCalledWith(null);
  });

  it("ends each phase when its 8 s run out, keeping what arrived and starting nothing more", async () => {
    // 10 Mbps: 1, 2 and 5 MiB take 6.7 s, so the 10 MiB body is cut off at 8 s and 25 never starts.
    const link = fakeLink({ down: 1250, up: 1250, pings: [30] });
    const result = await measure(profile('full'), link.deps());
    expect(downloads(link.opened)).toEqual([1, 2, 5, 10]);
    expect(link.cancelled.filter((url) => url.includes('bytes=10485760'))).toHaveLength(1);
    const download = result.download;
    expect(download?.samples).toBe(4);
    expect(download?.bytes).toBeGreaterThan(8 * MiB);
    expect(download?.bytes).toBeLessThan(18 * MiB);
    expect(download?.mbps).toBeCloseTo(10, 0);
    // Every phase stopped within its budget, give or take one chunk.
    const phases = 3 * PHASE_MS;
    expect(link.now()).toBeLessThan(phases + (2 * CHUNK) / 1250);
  });

  it('runs the light profile: 1 and 5 MiB down, 256 KiB up', async () => {
    const link = fakeLink({ down: 12_500, up: 12_500, pings: [10] });
    const result = await measure(profile('light'), link.deps());
    expect(downloads(link.opened)).toEqual([1, 5]);
    expect(result).toMatchObject({ profile: 'light', bytesUp: 256 * 1024 });
    expect(PROFILES.light.download.reduce((a, b) => a + b, 0)).toBe(6 * MiB);
  });

  it('says upload is unavailable when the browser blocks it, never a made-up figure', async () => {
    const link = fakeLink({ down: 12_500, up: 12_500, pings: [10] }, { upload: 'blocked' });
    const result = await measure(profile('light'), link.deps());
    expect(result.upload).toBe('blocked');
    expect(result.download?.mbps).toBeCloseTo(100, 5);
    expect(resultRows(result).map((row) => row.map(lineText).join(': '))).toContain('Upload: unavailable (blocked by the browser or the network)');
  });

  it('stops at a response that is not test data', async () => {
    const link = fakeLink({ down: 12_500, up: 12_500, pings: [10] }, { contentType: 'text/html; charset=utf-8' });
    await expect(measure(profile('light'), link.deps())).rejects.toThrow('speed.cloudflare.com sent text/html, not test data');
  });

  it('stops reading at once on ^C, mid-download', async () => {
    const stop = new AbortController();
    let readsAtStop = 0;
    const link = fakeLink(
      { down: 12_500, up: 12_500, pings: [10] },
      {
        onRead: (reads) => {
          // The third chunk of the first body: ^C.
          if (reads === 3) {
            readsAtStop = reads;
            stop.abort(new Error('^C'));
          }
        },
      },
    );
    await expect(measure(profile('full'), link.deps(stop.signal))).rejects.toThrow('^C');
    expect(link.reads()).toBe(readsAtStop);
    expect(link.cancelled).toEqual(['https://speed.cloudflare.com/__down?bytes=1048576']);
    expect(downloads(link.opened)).toEqual([1]);
  });

  it('words a speed in Mbps', () => {
    expect(mbps(12_500_000, 1000)).toBe(100);
    expect(mbps(1, 0)).toBe(0.008);
  });
});

describe('the light run, and the question before it', () => {
  it('is the default with Data Saver, on a cellular or slow connection, and on a touch screen', () => {
    expect(lightBecause({ touch: false, saveData: true, cellular: false })).toBe('Data Saver is on');
    expect(lightBecause({ touch: false, saveData: false, cellular: true })).toBe('a cellular or slow connection');
    expect(lightBecause({ touch: true, saveData: false, cellular: false })).toBe('a touch screen');
    expect(lightBecause({ touch: false, saveData: false, cellular: false })).toBeNull();
  });

  it('reads --full, --light and --dry-run from the line, as the flag parser does', () => {
    expect(requested(['speedtest'])).toBeNull();
    expect(requested(['speedtest', '--fu'])).toBe('full');
    expect(requested(['speedtest', '--light', '--full'])).toBe('full');
    expect(requested(['speedtest', '--dry-run', '--full'])).toBe('dry-run');
    expect(requested(['speedtest', '--', '--full'])).toBeNull();
  });

  it('asks about the data the run would spend, only where its spec says to', () => {
    const phone = { touch: true, saveData: false, cellular: false };
    expect(dataCostQuestion(speedtest, ['speedtest'], phone)).toBe('speedtest downloads about 6 MB. Continue?');
    expect(dataCostQuestion(speedtest, ['speedtest', '--full'], phone)).toBe('speedtest downloads about 45 MB. Continue?');
    expect(dataCostQuestion(speedtest, ['speedtest', '--dry-run'], phone)).toBeNull();
    expect(dataCostQuestion(speedtest, ['speedtest'], { touch: false, saveData: false, cellular: false })).toBeNull();
    expect(dataCostQuestion(speedtest, ['speedtest'], { touch: false, saveData: true, cellular: false })).not.toBeNull();
  });
});

/** Answers the speed test's endpoints quickly, with small bodies: what a slow fixture would send. */
function serveSpeedTest() {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const headers = { 'content-type': 'application/octet-stream', 'access-control-allow-origin': '*' };
    if (init?.method === 'POST') return new Response('', { status: 200, headers });
    const bytes = Math.min(Number(new URL(url).searchParams.get('bytes')), CHUNK);
    return new Response(new Uint8Array(bytes), { status: 200, headers });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const tableText = (blocks: readonly Block[]): string[] =>
  blocks.flatMap((block) => (block.type === 'table' ? block.rows.map((row) => lineText(row[0] ?? [])) : []));

describe('speedtest at the prompt', () => {
  it('asks first on a phone, and a no spends nothing', async () => {
    const fetchMock = serveSpeedTest();
    const result = await runLine('speedtest', { touch: true, answer: () => 'n' });
    expect(result.prompts).toEqual(['speedtest downloads about 6 MB. Continue? [y/N] ']);
    expect(result.status).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('runs the light test on a yes, and prints the table', async () => {
    const fetchMock = serveSpeedTest();
    const result = await runLine('speedtest', { touch: true, answer: () => 'y' });
    expect(result.status, result.stderrPlain).toBe(0);
    expect(tableText(result.blocks)).toEqual(['Server', 'Latency', 'Jitter', 'Download', 'Upload', 'Data used']);
    expect(result.stderrPlain).toContain('A light run: up to 6 MB down and 256 KB up, 8 s for each of latency, download and upload, because of a touch screen.');
    expect(result.stdoutPlain).toContain('(light run)');
    const sizes = fetchMock.mock.calls.map(([url]) => String(url)).filter((url) => url.includes('/__down') && !url.endsWith('bytes=0'));
    expect(sizes).toEqual(['https://speed.cloudflare.com/__down?bytes=1048576', 'https://speed.cloudflare.com/__down?bytes=5242880']);
    const uploads = fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');
    expect(uploads).toHaveLength(1);
    expect(fetchMock.mock.calls.every(([, init]) => init?.cache === 'no-store')).toBe(true);
  });

  it('asks nothing on a desktop, and runs the full test', async () => {
    serveSpeedTest();
    const result = await runLine('speedtest');
    expect(result.prompts).toEqual([]);
    expect(result.status).toBe(0);
    expect(result.stdoutPlain).toContain('(full run)');
  });

  it('says what a run would use with --dry-run, and fetches nothing', async () => {
    const fetchMock = serveSpeedTest();
    const phone = await runLine('speedtest --dry-run', { touch: true });
    expect(phone).toMatchObject({ status: 0, prompts: [] });
    expect(phone.stdoutPlain).toBe(
      'A light run: up to 6 MB down and 256 KB up, 8 s for each of latency, download and upload, because of a touch screen.\nspeedtest --full runs the full one.',
    );
    expect((await runLine('speedtest --dry-run --full', { tty: false })).stdoutPlain).toBe(
      'A full run: up to 45 MB down and 3 MB up, 8 s for each of latency, download and upload.',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('runs only at the prompt, never from $( ) or a script', async () => {
    const fetchMock = serveSpeedTest();
    const s = await session();
    const result = await s.run('X=$(speedtest); echo $?');
    s.stop();
    expect(result.stdoutPlain).toBe('1');
    expect(result.stderrPlain).toBe('speedtest: only at the prompt: it downloads megabytes');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('says plainly when the speed test cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    const result = await runLine('speedtest');
    expect(result).toMatchObject({ status: 1, stderrPlain: expect.stringContaining('speedtest: could not reach speed.cloudflare.com (blocked by the browser or the network)') });
  });

  it('stops on an HTTP error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('slow down', { status: 429 })));
    const result = await runLine('speedtest');
    expect(result.stderrPlain).toContain('speedtest: speed.cloudflare.com answered HTTP 429');
    expect(result.status).toBe(1);
  });
});
