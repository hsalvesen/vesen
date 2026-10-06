// The only Cloudflare-specific file: it turns env bindings into handler dependencies and wires
// the fetch and scheduled entry points. Moving to another host means replacing this file.

import { configFromEnv, type WorkerConfig } from './config';
import type { Env, ExecutionContext, ScheduledEvent } from './env';
import { handle, type HandlerDeps } from './handler';
import { createIsolateState } from './service';
import { kvSnapshotStore, refreshSnapshot } from './snapshot';

// Caches, rate limits and cooldowns live as long as the isolate.
const state = createIsolateState();

let configured: { key: string; config: WorkerConfig } | null = null;

function depsFor(env: Env): HandlerDeps {
  const key = [env.ALLOWED_ORIGINS, env.PROVIDER_ORDER, env.UPSTREAM_UA, env.FINNHUB_KEY].join('\n');
  if (configured?.key !== key) configured = { key, config: configFromEnv(env) };
  return {
    config: configured.config,
    state,
    fetch: (input, init) => fetch(input, init),
    now: () => Date.now(),
    snapshots: env.SNAPSHOT ? kvSnapshotStore(env.SNAPSHOT) : null,
  };
}

const worker = {
  fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    return handle(request, depsFor(env));
  },

  scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): void {
    const deps = depsFor(env);
    if (!deps.snapshots) {
      console.warn('snapshot: no SNAPSHOT KV namespace is bound; skipping');
      return;
    }
    ctx.waitUntil(
      refreshSnapshot(deps, deps.snapshots).then(
        (report) =>
          console.log(
            `snapshot ${event.cron}: ${report.written ? 'written' : 'not written'}; ` +
              `refreshed ${report.refreshed.length}, failed ${report.failed.join(' ') || 'none'}`,
          ),
        (error: unknown) => console.error(`snapshot ${event.cron}: ${error instanceof Error ? error.message : 'failed'}`),
      ),
    );
  },
};

export default worker;
