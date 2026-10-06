// The Cloudflare entry points, with the global fetch answered from the recordings.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExecutionContext } from '../src/env';
import worker from '../src/index';
import { fakeUpstream } from './support/fixtures';
import { memoryKv, request } from './support/worker';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function context(): { ctx: ExecutionContext; settled: () => Promise<unknown> } {
  const pending: Promise<unknown>[] = [];
  return {
    ctx: { waitUntil: (promise) => pending.push(promise), passThroughOnException: () => {} },
    settled: () => Promise.all(pending),
  };
}

describe('the Worker entry points', () => {
  it('route requests to the handler with config from env', async () => {
    vi.stubGlobal('fetch', fakeUpstream().fetch);
    const { ctx } = context();
    const env = { ALLOWED_ORIGINS: 'https://example.test' };
    expect((await worker.fetch(request('/v1/quote?symbol=AAPL', { origin: 'https://example.test' }), env, ctx)).status).toBe(200);
    expect((await worker.fetch(request('/v1/quote?symbol=AAPL'), env, ctx)).status).toBe(403);
  });

  it('refresh the snapshot in KV on the cron, and skip it when no namespace is bound', async () => {
    vi.stubGlobal('fetch', fakeUpstream().fetch);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const kv = memoryKv();
    const { ctx, settled } = context();

    worker.scheduled({ scheduledTime: Date.now(), cron: '*/15 * * * *' }, { SNAPSHOT: kv }, ctx);
    await settled();
    expect(kv.data.has('snapshot:v1')).toBe(true);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('written; refreshed 10, failed none'));

    worker.scheduled({ scheduledTime: Date.now(), cron: '*/15 * * * *' }, {}, ctx);
    expect(warn).toHaveBeenCalledOnce();
  });
});
