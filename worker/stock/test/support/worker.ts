// Builds handler dependencies around a fake upstream, and requests as a browser would send them.
import { configFromEnv } from '../../src/config';
import type { Env, KVNamespace } from '../../src/env';
import type { HandlerDeps } from '../../src/handler';
import { createIsolateState } from '../../src/service';
import { kvSnapshotStore, type SnapshotStore } from '../../src/snapshot';
import { fakeUpstream, type FakeUpstream } from './fixtures';

export const VESEN = 'https://www.vesen.app';

export interface TestWorker {
  readonly deps: HandlerDeps;
  readonly upstream: FakeUpstream;
}

export function testWorker(options: { env?: Env; snapshots?: SnapshotStore | null; upstream?: FakeUpstream } = {}): TestWorker {
  const upstream = options.upstream ?? fakeUpstream();
  return {
    upstream,
    deps: {
      config: configFromEnv(options.env ?? {}),
      state: createIsolateState(),
      fetch: upstream.fetch,
      now: () => Date.now(),
      snapshots: options.snapshots ?? null,
    },
  };
}

export function request(
  path: string,
  options: { origin?: string | null; ip?: string; method?: string } = {},
): Request {
  const headers = new Headers({ 'CF-Connecting-IP': options.ip ?? '203.0.113.7' });
  const origin = options.origin === undefined ? VESEN : options.origin;
  if (origin !== null) headers.set('Origin', origin);
  return new Request(`https://vesen-stock.example.workers.dev${path}`, { method: options.method ?? 'GET', headers });
}

/** An in-memory KV namespace with the methods the Worker uses. */
export function memoryKv(): KVNamespace & { readonly data: Map<string, string>; writes: number } {
  const data = new Map<string, string>();
  return {
    data,
    writes: 0,
    async get(key) {
      return data.get(key) ?? null;
    },
    async put(key, value) {
      this.writes += 1;
      data.set(key, value);
    },
    async list(options) {
      const keys = [...data.keys()].filter((name) => name.startsWith(options?.prefix ?? '')).map((name) => ({ name }));
      return { keys, list_complete: true };
    },
  };
}

export function kvStore(kv = memoryKv()): { kv: ReturnType<typeof memoryKv>; store: SnapshotStore } {
  return { kv, store: kvSnapshotStore(kv) };
}
