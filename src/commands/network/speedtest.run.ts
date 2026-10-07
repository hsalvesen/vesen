// The body of speedtest; its spec, in speedtest.ts, loads this the first time it runs.
//
// Three phases, each with its own 8 s budget, against speed.cloudflare.com:
// - latency: ten tiny requests, timed whole: average, minimum, maximum and jitter;
// - download: bodies of growing size (1, 2, 5, 10, 25 MiB, or 1 and 5 in the light run), each
//   counted byte by byte as it streams, timed from its first byte, and cut off where the budget
//   ends, so a slow link still gets a figure in time;
// - upload: plain CORS POSTs, each checked, and timed less one round trip. When the browser or
//   the network blocks them, upload says unavailable, never a made-up number.
// Every response is checked: an HTTP error or a body that is not test data stops the run.

import { combineSignals, deadline, type Deadline } from '../../lib/signals';
import { out, type Line } from '../../output/model';
import type { Net, NetStream } from '../../services/types';
import { megabytes } from '../../shell/data-cost';
import type { CommandContext, CommandDoc, ExitCode } from '../../shell/types';
import { PROFILES, type ProfileName } from './speedtest';

/** What --help, help and man say about speedtest, besides its spec (speedtest.ts). */
export const doc: CommandDoc = {
  description:
    'Measures latency, download and upload against Cloudflare\'s speed test, with 8 seconds for each. On a phone, a cellular or slow connection, or with Data Saver on, it runs light (about 6 MB) and asks first; --full runs up to 45 MB. Ctrl+C, or Stop on a phone, ends it at once.',
  man: [
    {
      heading: 'HOW IT MEASURES',
      body:
        'Latency is ten tiny requests, each timed whole. Download reads bodies of growing size as they stream, counting the bytes that arrive from the first one, and stops where its 8 seconds end; the figure is all the bytes over all the time. Upload sends plain POSTs and times each less one round trip. When the browser or the network blocks uploads, upload says unavailable.',
    },
  ],
};

export const SERVER = 'speed.cloudflare.com';
const DOWN = `https://${SERVER}/__down`;
const UP = `https://${SERVER}/__up`;

/** Each phase's budget. */
export const PHASE_MS = 8000;
export const LATENCY_REQUESTS = 10;
/** How often the status line's figure is refreshed while a body streams. */
const STATUS_EVERY_MS = 250;

export interface Profile {
  readonly name: ProfileName;
  readonly download: readonly number[];
  readonly upload: readonly number[];
}

export const profile = (name: ProfileName): Profile => ({ name, ...PROFILES[name] });

/** What a run needs; tests pass a fake net and clock. */
export interface MeterDeps {
  readonly net: Pick<Net, 'open' | 'isError'>;
  /** Milliseconds, for timing. */
  readonly now: () => number;
  /** ^C. */
  readonly signal: AbortSignal;
  readonly status: (text: string | null) => void;
  /** A phase's deadline; a real timer unless a test passes its own. */
  readonly deadline?: (ms: number) => Deadline;
}

export interface Latency {
  readonly avg: number;
  readonly min: number;
  readonly max: number;
  readonly jitter: number;
  readonly samples: number;
}

export interface Throughput {
  readonly mbps: number;
  readonly bytes: number;
  readonly samples: number;
}

export interface SpeedResult {
  readonly profile: ProfileName;
  readonly latency: Latency | null;
  readonly download: Throughput | null;
  /** 'blocked' when the browser or the network refused every upload; 'timeout' when none finished in time. */
  readonly upload: Throughput | 'blocked' | 'timeout';
  /** Cloudflare's data centre, when its response says. */
  readonly colo: string | null;
  readonly bytesDown: number;
  readonly bytesUp: number;
}

/** A response that is not what the speed test sends: the run stops. */
export class BadResponse extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BadResponse';
  }
}

interface Phase {
  readonly signal: AbortSignal;
  /** Milliseconds left of the phase's budget. */
  left(): number;
  over(): boolean;
  end(): void;
}

function startPhase(deps: MeterDeps): Phase {
  const started = deps.now();
  const timer = (deps.deadline ?? deadline)(PHASE_MS);
  const signal = combineSignals(deps.signal, timer.signal);
  const left = (): number => PHASE_MS - (deps.now() - started);
  return { signal, left, over: () => signal.aborted || left() <= 0, end: () => timer.cancel() };
}

/** Mbps for bytes over milliseconds. */
export const mbps = (bytes: number, ms: number): number => (bytes * 8) / (Math.max(ms, 1) / 1000) / 1e6;

const formatMbps = (value: number): string => (value >= 100 ? value.toFixed(0) : value.toFixed(1));

/** Throws the visitor's ^C as it is; anything else the caller decides about. */
function stopIfInterrupted(deps: MeterDeps, error: unknown): void {
  if (deps.signal.aborted) throw error;
}

/** True for a request that ended because its phase's time ran out, not because it failed. */
function outOfTime(deps: MeterDeps, phase: Phase, error: unknown): boolean {
  return phase.over() && deps.net.isError(error) && (error.kind === 'abort' || error.kind === 'timeout');
}

/** Stops at a body that is not test data, such as a captive portal's page, without reading it. */
function checkTestData(stream: NetStream): void {
  const type = stream.headers['content-type'];
  if (type === undefined || /octet-stream/i.test(type)) return;
  stream.cancel();
  throw new BadResponse(`${SERVER} sent ${type.split(';')[0]}, not test data`);
}

/** Reads a body to its end, or until the phase's time runs out; the bytes read. */
async function drain(deps: MeterDeps, phase: Phase, stream: NetStream, onBytes?: (bytes: number) => void): Promise<number> {
  let bytes = 0;
  for (;;) {
    if (phase.signal.aborted || phase.over()) {
      stream.cancel();
      stopIfInterrupted(deps, deps.signal.reason);
      return bytes;
    }
    let chunk: Uint8Array | null;
    try {
      chunk = await stream.read();
    } catch (error) {
      stopIfInterrupted(deps, error);
      if (outOfTime(deps, phase, error)) return bytes;
      throw error;
    }
    if (chunk === null) return bytes;
    bytes += chunk.byteLength;
    onBytes?.(bytes);
  }
}

async function measureLatency(deps: MeterDeps, found: { colo: string | null; bytes: number }): Promise<Latency | null> {
  const phase = startPhase(deps);
  const samples: number[] = [];
  try {
    for (let i = 0; i < LATENCY_REQUESTS && !phase.over(); i += 1) {
      deps.status(`measuring latency, ${i + 1} of ${LATENCY_REQUESTS}…`);
      const started = deps.now();
      try {
        const stream = await deps.net.open(`${DOWN}?bytes=0`, { signal: phase.signal, timeoutMs: Math.max(1, phase.left()), cache: 'no-store' });
        found.colo ??= stream.headers['cf-meta-colo'] ?? null;
        found.bytes += await drain(deps, phase, stream);
      } catch (error) {
        stopIfInterrupted(deps, error);
        if (outOfTime(deps, phase, error)) break;
        throw error;
      }
      if (!phase.over()) samples.push(deps.now() - started);
    }
  } finally {
    phase.end();
  }
  if (samples.length === 0) return null;
  const jitter = samples.length < 2 ? 0 : samples.slice(1).reduce((total, sample, i) => total + Math.abs(sample - (samples[i] ?? sample)), 0) / (samples.length - 1);
  return {
    avg: samples.reduce((total, sample) => total + sample, 0) / samples.length,
    min: Math.min(...samples),
    max: Math.max(...samples),
    jitter,
    samples: samples.length,
  };
}

async function measureDownload(deps: MeterDeps, sizes: readonly number[], found: { bytes: number }): Promise<Throughput | null> {
  const phase = startPhase(deps);
  let bytes = 0;
  let ms = 0;
  let samples = 0;
  try {
    for (const size of sizes) {
      if (phase.over()) break;
      let stream: NetStream;
      try {
        stream = await deps.net.open(`${DOWN}?bytes=${size}`, { signal: phase.signal, timeoutMs: Math.max(1, phase.left()), cache: 'no-store' });
      } catch (error) {
        stopIfInterrupted(deps, error);
        if (outOfTime(deps, phase, error)) break;
        throw error;
      }
      checkTestData(stream);
      const started = deps.now();
      let shown = started;
      const read = await drain(deps, phase, stream, (sofar) => {
        const at = deps.now();
        if (at - shown < STATUS_EVERY_MS) return;
        shown = at;
        deps.status(`downloading ${megabytes(size)} MB: ${formatMbps(mbps(bytes + sofar, ms + at - started))} Mbps…`);
      });
      found.bytes += read;
      if (read === 0) break;
      bytes += read;
      ms += deps.now() - started;
      samples += 1;
    }
  } finally {
    phase.end();
  }
  return samples === 0 ? null : { mbps: mbps(bytes, ms), bytes, samples };
}

async function measureUpload(deps: MeterDeps, sizes: readonly number[], roundTrip: number, found: { bytes: number }): Promise<SpeedResult['upload']> {
  const phase = startPhase(deps);
  let bytes = 0;
  let ms = 0;
  let samples = 0;
  let missing: 'blocked' | 'timeout' = 'timeout';
  try {
    for (const size of sizes) {
      if (phase.over()) break;
      deps.status(`uploading ${size >= 1e6 ? `${megabytes(size)} MB` : `${Math.round(size / 1024)} KB`}…`);
      const started = deps.now();
      try {
        // Text, so the POST is a simple request with no preflight.
        const stream = await deps.net.open(UP, { method: 'POST', body: '0'.repeat(size), signal: phase.signal, timeoutMs: Math.max(1, phase.left()), cache: 'no-store' });
        stream.cancel();
      } catch (error) {
        stopIfInterrupted(deps, error);
        // Out of time, or blocked: what was measured stands, and nothing is made up.
        if (!outOfTime(deps, phase, error)) missing = 'blocked';
        break;
      }
      if (phase.over()) break;
      found.bytes += size;
      bytes += size;
      ms += Math.max(1, deps.now() - started - roundTrip);
      samples += 1;
    }
  } finally {
    phase.end();
  }
  return samples === 0 ? missing : { mbps: mbps(bytes, ms), bytes, samples };
}

/** Runs the three phases of `run`. Throws a NetError or BadResponse when nothing can be measured. */
export async function measure(run: Profile, deps: MeterDeps): Promise<SpeedResult> {
  const found = { colo: null as string | null, bytes: 0 };
  const latency = await measureLatency(deps, found);
  const download = await measureDownload(deps, run.download, found);
  const up = { bytes: 0 };
  const upload = await measureUpload(deps, run.upload, latency?.min ?? 0, up);
  deps.status(null);
  return { profile: run.name, latency, download, upload, colo: found.colo, bytesDown: found.bytes, bytesUp: up.bytes };
}

/** Why the light run is the default here, or null when the full one is. */
export function lightBecause(here: { readonly touch: boolean; readonly saveData: boolean; readonly cellular: boolean }): string | null {
  if (here.saveData) return 'Data Saver is on';
  if (here.cellular) return 'a cellular or slow connection';
  if (here.touch) return 'a touch screen';
  return null;
}

const sum = (sizes: readonly number[]): number => sizes.reduce((total, size) => total + size, 0);

/** The run, as a table: server, latency, jitter, download, upload and the data used. */
export function resultRows(result: SpeedResult): Line[][] {
  const cell = (text: string, strong = false): Line => [out.span(text, strong ? { fg: 'fg-strong', bold: true } : undefined)];
  const row = (label: string, value: string, strong = false): Line[] => [[out.span(label, { fg: 'accent' })], cell(value, strong)];
  const latency = result.latency;
  const rows: Line[][] = [row('Server', `${SERVER}${result.colo === null ? '' : ` (${result.colo})`}`)];
  if (latency !== null) {
    rows.push(row('Latency', `${Math.round(latency.avg)} ms (min ${Math.round(latency.min)}, max ${Math.round(latency.max)})`, true));
    rows.push(row('Jitter', `${latency.jitter.toFixed(1)} ms`));
  } else {
    rows.push(row('Latency', 'not measured in time'));
  }
  rows.push(row('Download', result.download === null ? 'not measured in time' : `${formatMbps(result.download.mbps)} Mbps`, result.download !== null));
  const upload = result.upload;
  rows.push(
    typeof upload === 'object'
      ? row('Upload', `${formatMbps(upload.mbps)} Mbps`, true)
      : row('Upload', upload === 'blocked' ? 'unavailable (blocked by the browser or the network)' : 'not measured in time'),
  );
  const used = (result.bytesDown + result.bytesUp) / 1e6;
  rows.push(row('Data used', `${used < 10 ? used.toFixed(1) : used.toFixed(0)} MB (${result.profile} run)`));
  return rows;
}

function failure(ctx: CommandContext, error: unknown): string {
  if (error instanceof BadResponse) return error.message;
  if (!ctx.net.isError(error)) throw error;
  switch (error.kind) {
    case 'offline':
      return 'you appear to be offline';
    case 'timeout':
    case 'abort':
      return `${SERVER} did not answer in time`;
    case 'http':
      return `${SERVER} answered HTTP ${error.status ?? 'error'}`;
    default:
      return `could not reach ${SERVER} (blocked by the browser or the network)`;
  }
}

export async function run(ctx: CommandContext): Promise<ExitCode> {
  const [extra] = ctx.args;
  if (extra !== undefined) return ctx.usage(`extra operand '${extra}'`);
  const because = lightBecause({ touch: ctx.tty.touch, ...ctx.sys.connection() });
  const name: ProfileName = ctx.opts.full === true ? 'full' : ctx.opts.light === true || because !== null ? 'light' : 'full';
  const chosen = profile(name);
  const down = megabytes(sum(chosen.download));
  const up = sum(chosen.upload);
  const plan = `A ${name} run: up to ${down} MB down and ${up >= 1e6 ? `${megabytes(up)} MB` : `${Math.round(up / 1024)} KB`} up, ${PHASE_MS / 1000} s for each of latency, download and upload${
    ctx.opts.full === true || ctx.opts.light === true ? '' : because === null ? '' : `, because of ${because}`
  }.`;

  if (ctx.opts['dry-run'] === true) {
    await ctx.stdout.write(`${plan}\n`);
    if (name === 'light') await ctx.stdout.write('speedtest --full runs the full one.\n');
    return 0;
  }
  // It spends real data, so a script, ~/.bashrc or $( ) never starts it.
  if (!ctx.tty.interactive) return ctx.fail('only at the prompt: it downloads megabytes');

  await ctx.stderr.line(out.span(plan, { fg: 'muted' }));
  let result: SpeedResult;
  try {
    result = await measure(chosen, { net: ctx.net, now: () => ctx.clock.now(), signal: ctx.signal, status: (text) => ctx.tty.status(text) });
  } catch (error) {
    if (ctx.signal.aborted) throw error;
    return ctx.fail(failure(ctx, error));
  }
  if (result.latency === null && result.download === null) return ctx.fail(`${SERVER} did not answer in time`);
  await ctx.stdout.block(out.table(resultRows(result)));
  if (name === 'light' && ctx.stdout.isTTY) await ctx.stdout.line(out.span('A light run. speedtest --full measures longer, with up to 45 MB.', { fg: 'muted' }));
  return 0;
}
