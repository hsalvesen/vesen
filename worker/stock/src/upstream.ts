// One upstream GET under a deadline. Every provider call goes through here, so each one is
// bounded in time and size, carries the vesen User-Agent and is counted for Server-Timing.

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Shared by every upstream call that serves one request (or one scheduled run). */
export interface UpstreamContext {
  readonly fetch: FetchLike;
  readonly now: () => number;
  /** Epoch milliseconds after which no new attempt starts and running ones are cut off. */
  readonly deadline: number;
  readonly userAgent: string;
  /** Running totals for the Server-Timing header. */
  readonly metrics: { upstreamMs: number; calls: number };
}

export type UpstreamResult =
  | { readonly ok: true; readonly status: number; readonly body: string }
  | { readonly ok: false; readonly reason: 'timeout' | 'network' | 'too_large' | 'no_time' };

/** Attempts that would get less time than this are skipped rather than started. */
export const MIN_ATTEMPT_MS = 250;

const MAX_BODY_BYTES = 512 * 1024;

export async function getText(
  url: string,
  ctx: UpstreamContext,
  options: { timeoutMs: number; headers?: Readonly<Record<string, string>> },
): Promise<UpstreamResult> {
  const started = ctx.now();
  const timeoutMs = Math.min(options.timeoutMs, ctx.deadline - started);
  if (timeoutMs < MIN_ATTEMPT_MS) return { ok: false, reason: 'no_time' };

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve('timeout');
    }, timeoutMs);
  });

  const attempt = (async (): Promise<UpstreamResult> => {
    const response = await ctx.fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': ctx.userAgent, Accept: 'application/json, text/plain;q=0.8', ...options.headers },
      signal: controller.signal,
      redirect: 'manual',
    });
    const declared = Number(response.headers.get('content-length') ?? '0');
    if (declared > MAX_BODY_BYTES) {
      controller.abort();
      return { ok: false, reason: 'too_large' };
    }
    const body = await response.text();
    if (body.length > MAX_BODY_BYTES) return { ok: false, reason: 'too_large' };
    return { ok: true, status: response.status, body };
  })();

  ctx.metrics.calls += 1;
  try {
    // Racing the timer settles on time even if a fetch ignores its signal.
    const outcome = await Promise.race([attempt, timedOut]);
    return outcome === 'timeout' ? { ok: false, reason: 'timeout' } : outcome;
  } catch {
    return { ok: false, reason: controller.signal.aborted ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timer);
    ctx.metrics.upstreamMs += ctx.now() - started;
    attempt.catch(() => {});
  }
}

/** Parses JSON without throwing; anything unreadable is undefined. */
export function parseJson(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
}
