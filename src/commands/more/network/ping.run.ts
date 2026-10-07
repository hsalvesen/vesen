// The body of ping; its spec, in ping.ts, loads this the first time ping runs.
//
// A browser cannot send ICMP echo requests, so each probe is an HTTPS request instead: a no-cors
// GET of https://HOST/favicon.ico (https://ADDRESS/ for an address), past the HTTP cache, timed
// from asking to the answer's headers. The browser lets a page time any site that way, though
// not read what it says. The name is resolved first, over DNS over HTTPS, so a name that does
// not exist fails as ping fails, instead of looking like a host that does not answer.
//
// The statistics are ping's: requests sent and answered, the loss, and min/avg/max/mdev, where
// mdev is the standard deviation of the round trips. ^C prints them too, as ping does: the
// kernel stops taking a job's output the moment ^C aborts it, so they are written from the abort
// event itself, which a terminal's output takes at once.

import { out } from '../../../output/model';
import type { CommandContext, CommandDoc, ExitCode } from '../../../shell/types';
import { DnsUnreachable, RCODE, RR_TYPES, addressesIn, ask, hostName, ipVersion, isPrivateAddress } from '../../lib/dns';

/** What --help, help and man say about ping, besides its spec (ping.ts). */
export const doc: CommandDoc = {
  description:
    "Times how long HOST takes to answer, COUNT times (4 unless -c says), a second apart (-i), and prints ping's statistics at the end, or when ^C stops it. ICMP is not available in a browser, so each probe is an HTTPS request to the host (its favicon, past the cache), and its time is the HTTPS round trip: a little longer than an ICMP echo would take, and the first includes setting up the connection. The name is looked up first over DNS over HTTPS (Cloudflare, then Google), and /etc/hosts.",
  man: [
    {
      heading: 'WHAT IT CAN AND CANNOT REACH',
      body: "A page on the internet may not reach this device or a private network, so localhost, 10.x, 192.168.x and the like are refused. A host that does not serve HTTPS never answers, and an address answers only if its server accepts a request with no name. A request the browser cannot make looks the same as one the host refused: both are 'unreachable over HTTPS'.",
    },
    {
      heading: 'EXIT STATUS',
      body: '0 when at least one request was answered. 1 when none was. 2 for bad usage, or a name that cannot be resolved.',
    },
  ],
};

/** The fewest seconds between requests, as ping allows a user who is not root. */
export const MIN_INTERVAL_S = 0.2;
export const MAX_COUNT = 1000;
const DEFAULT_TIMEOUT_S = 5;
const MAX_TIMEOUT_S = 30;
/** Kept in hand at the end of the budget, to print the statistics. */
const FINISH_MS = 500;

interface Options {
  readonly count: number;
  readonly intervalMs: number;
  readonly timeoutMs: number;
  readonly quiet: boolean;
}

/** A positive number of seconds from a flag, or null. */
function seconds(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function readOptions(ctx: CommandContext): Options | string {
  let count = 4;
  if (ctx.opts.c !== undefined) {
    const n = Number(ctx.opts.c);
    if (!Number.isInteger(n)) return `invalid argument: '${String(ctx.opts.c)}'`;
    if (n < 1 || n > MAX_COUNT) return `invalid argument: '${n}': out of range: 1 <= value <= ${MAX_COUNT}`;
    count = n;
  }
  let intervalMs = 1000;
  if (ctx.opts.i !== undefined) {
    const s = seconds(ctx.opts.i);
    if (s === null) return `option argument contains garbage: ${String(ctx.opts.i)}`;
    if (s < MIN_INTERVAL_S) return `cannot flood; minimal interval allowed for user is ${MIN_INTERVAL_S * 1000}ms`;
    intervalMs = Math.round(s * 1000);
  }
  let timeoutMs = DEFAULT_TIMEOUT_S * 1000;
  if (ctx.opts.W !== undefined) {
    const s = seconds(ctx.opts.W);
    if (s === null || s > MAX_TIMEOUT_S) return `bad linger time: ${String(ctx.opts.W)}`;
    timeoutMs = Math.round(s * 1000);
  }
  return { count, intervalMs, timeoutMs, quiet: ctx.opts.q === true };
}

interface Target {
  /** As the output names it: the host as typed, lower case. */
  readonly name: string;
  readonly address: string;
  readonly url: string;
}

/** The address /etc/hosts gives `name`, or null. */
function fromHostsFile(ctx: CommandContext, name: string): string | null {
  let text: string;
  try {
    text = ctx.fs.readFile('/etc/hosts');
  } catch {
    return null;
  }
  for (const line of text.split('\n')) {
    const [address, ...names] = line.replace(/#.*/, '').trim().split(/\s+/);
    if (address !== undefined && names.some((alias) => alias.toLowerCase() === name)) return address;
  }
  return null;
}

/** Where the requests go, or what ping says instead. */
async function findTarget(ctx: CommandContext, word: string): Promise<Target | string> {
  const literal = word.replace(/^\[(.*)\]$/, '$1');
  const version = ipVersion(literal);
  if (version !== null) return { name: literal, address: literal, url: `https://${version === 6 ? `[${literal}]` : literal}/` };
  const name = hostName(word);
  if (name === null) return `${word}: Name or service not known`;
  const listed = fromHostsFile(ctx, name);
  if (listed !== null) return { name, address: listed, url: `https://${name}/favicon.ico` };
  try {
    for (const type of [RR_TYPES.A, RR_TYPES.AAAA]) {
      const { answer } = await ask({ net: ctx.net, clock: ctx.clock, signal: ctx.signal }, name, type);
      if (answer.status === RCODE.nxDomain) return `${word}: Name or service not known`;
      if (answer.status !== RCODE.noError) return `${word}: Temporary failure in name resolution`;
      const [address] = addressesIn(answer, type);
      if (address !== undefined) return { name, address, url: `https://${name}/favicon.ico` };
    }
  } catch (error) {
    if (!(error instanceof DnsUnreachable)) throw error;
    return `${word}: Temporary failure in name resolution${error.offline ? ' (the browser is offline)' : ''}`;
  }
  return `${word}: No address associated with hostname`;
}

/** A round trip as ping prints one: three significant figures, at most three decimals. */
export function formatRtt(ms: number): string {
  if (ms >= 99.95) return String(Math.round(ms));
  if (ms >= 9.995) return ms.toFixed(1);
  if (ms >= 1) return ms.toFixed(2);
  return ms.toFixed(3);
}

/** A number as C's %g prints it: six significant figures, no trailing zeros. */
function g(value: number): string {
  return String(Number(value.toPrecision(6)));
}

export interface Tally {
  transmitted: number;
  received: number;
  readonly rtts: number[];
}

/** ping's summary: what was sent and answered, the loss, and min/avg/max/mdev of the round trips. */
export function statistics(name: string, tally: Tally, elapsedMs: number): string[] {
  const { transmitted, received, rtts } = tally;
  const loss = transmitted === 0 ? 0 : ((transmitted - received) * 100) / transmitted;
  const lines = [`--- ${name} ping statistics ---`, `${transmitted} requests transmitted, ${received} received, ${g(loss)}% loss, time ${Math.round(elapsedMs)}ms`];
  if (rtts.length > 0) {
    const min = Math.min(...rtts);
    const max = Math.max(...rtts);
    const avg = rtts.reduce((sum, rtt) => sum + rtt, 0) / rtts.length;
    const meanSquare = rtts.reduce((sum, rtt) => sum + rtt * rtt, 0) / rtts.length;
    const mdev = Math.sqrt(Math.max(0, meanSquare - avg * avg));
    lines.push(`rtt min/avg/max/mdev = ${[min, avg, max, mdev].map((value) => value.toFixed(3)).join('/')} ms`);
  }
  return lines;
}

export async function run(ctx: CommandContext): Promise<ExitCode> {
  const options = readOptions(ctx);
  if (typeof options === 'string') return ctx.fail(options, 2);
  const [word, extra] = ctx.args;
  if (word === undefined) return ctx.fail('usage error: Destination address required', 2);
  if (extra !== undefined) return ctx.usage(`extra operand '${extra}'`);

  const target = await findTarget(ctx, word);
  if (typeof target === 'string') return ctx.fail(target, 2);
  if (isPrivateAddress(target.address)) {
    const here = /^(?:127\.|::1$|0\.)/.test(target.address);
    return ctx.fail(
      here
        ? `${target.name} (${target.address}) is this device: a browser tab cannot time a round trip to itself`
        : `${target.name} (${target.address}) is a private address, which a page on the internet may not reach`,
      2,
    );
  }

  await ctx.stdout.write(`PING ${target.name} (${target.address}) over HTTPS\n`);
  await ctx.stdout.line(out.span(`ICMP is not available in a browser: each probe times an HTTPS request to ${target.url}`, { fg: 'muted' }));

  const tally: Tally = { transmitted: 0, received: 0, rtts: [] };
  const started = ctx.clock.now();
  const summary = (): string => `\n${statistics(target.name, tally, ctx.clock.now() - started).join('\n')}\n`;
  // ^C: the statistics, written at once, while the terminal still takes the job's output.
  let summarised = false;
  const onAbort = (): void => {
    if (summarised) return;
    summarised = true;
    ctx.stdout.write(summary()).catch(() => {});
  };
  ctx.signal.addEventListener('abort', onAbort, { once: true });

  try {
    for (let seq = 1; seq <= options.count; seq += 1) {
      if (ctx.deadline !== undefined && ctx.clock.now() + options.timeoutMs + FINISH_MS > ctx.deadline) {
        await ctx.stderr.line(out.span('ping: stopping here: a command may run for 5 minutes', { fg: 'muted' }));
        break;
      }
      const sent = ctx.clock.now();
      tally.transmitted += 1;
      let line: string;
      try {
        const stream = await ctx.net.open(target.url, {
          mode: 'no-cors',
          cache: 'no-store',
          signal: ctx.signal,
          timeoutMs: options.timeoutMs,
          throwHttpErrors: false,
        });
        stream.cancel();
        const rtt = Math.max(0, ctx.clock.now() - sent);
        tally.received += 1;
        tally.rtts.push(rtt);
        line = `reply from ${target.name}: seq=${seq} time=${formatRtt(rtt)} ms (HTTPS round trip)`;
      } catch (error) {
        if (ctx.signal.aborted || !ctx.net.isError(error) || error.kind === 'abort') throw error;
        const why = error.kind === 'timeout' ? `no answer within ${options.timeoutMs / 1000} s` : error.kind === 'offline' ? 'the browser is offline' : 'unreachable over HTTPS';
        line = `no reply from ${target.name}: seq=${seq} (${why})`;
      }
      if (!options.quiet) await ctx.stdout.write(`${line}\n`);
      if (seq < options.count) await ctx.clock.sleep(Math.max(0, options.intervalMs - (ctx.clock.now() - sent)), ctx.signal);
    }
  } finally {
    ctx.signal.removeEventListener('abort', onAbort);
  }
  summarised = true;
  await ctx.stdout.write(summary());
  return tally.received > 0 ? 0 : 1;
}
