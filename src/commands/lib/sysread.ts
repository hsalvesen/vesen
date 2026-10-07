// Reading the system the way Linux's tools do: from /proc and /etc, so uptime, free, top, w,
// lscpu, uname and the rest agree with `cat /proc/meminfo` and with each other. The /proc files
// are made from the visitor's device on every read (src/vfs/special.ts).

import type { CommandContext } from '../../shell/types';
import { localTime, type LocalTime } from './listing';

/** What reading the system needs from a command's context. */
export type SysContext = Pick<CommandContext, 'fs' | 'clock' | 'env' | 'sys'>;

/** A file's text, or null when it cannot be read. */
export function readText(ctx: Pick<CommandContext, 'fs'>, path: string): string | null {
  try {
    return ctx.fs.readFile(path);
  } catch {
    return null;
  }
}

/** Seconds since the page booted, from /proc/uptime. */
export function uptimeSeconds(ctx: SysContext): number {
  const first = Number((readText(ctx, '/proc/uptime') ?? '').split(/\s+/)[0]);
  return Number.isFinite(first) && first > 0 ? first : 0;
}

/** When the page booted, in clock time (ms). */
export function bootTime(ctx: SysContext): number {
  return ctx.clock.now() - Math.floor(uptimeSeconds(ctx)) * 1000;
}

/** The 1, 5 and 15 minute load averages, from /proc/loadavg. */
export function loadAverages(ctx: SysContext): [number, number, number] {
  const [a, b, c] = (readText(ctx, '/proc/loadavg') ?? '').split(/\s+/).map(Number);
  const ok = (n: number | undefined): number => (n !== undefined && Number.isFinite(n) ? n : 0);
  return [ok(a), ok(b), ok(c)];
}

/** /proc/meminfo's fields, in kB. */
export function memInfo(ctx: SysContext): Map<string, number> {
  const fields = new Map<string, number>();
  for (const line of (readText(ctx, '/proc/meminfo') ?? '').split('\n')) {
    const match = /^(\w+):\s+(\d+)/.exec(line);
    if (match?.[1] !== undefined) fields.set(match[1], Number(match[2]));
  }
  return fields;
}

/** /proc/cpuinfo as one record per processor, its fields by name. */
export function cpuInfo(ctx: SysContext): Map<string, string>[] {
  const records: Map<string, string>[] = [];
  for (const block of (readText(ctx, '/proc/cpuinfo') ?? '').split(/\n\s*\n/)) {
    const record = new Map<string, string>();
    for (const line of block.split('\n')) {
      const colon = line.indexOf(':');
      if (colon > 0) record.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
    }
    if (record.has('processor')) records.push(record);
  }
  return records;
}

/** How many processors /proc/cpuinfo lists; at least 1. */
export function cpuCount(ctx: SysContext): number {
  return Math.max(1, cpuInfo(ctx).length);
}

/** /etc/os-release's fields, with their quotes taken off. */
export function osRelease(ctx: SysContext): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of (readText(ctx, '/etc/os-release') ?? '').split('\n')) {
    const match = /^([A-Z_]+)=(.*)$/.exec(line);
    if (match?.[1] !== undefined) fields[match[1]] = (match[2] ?? '').replace(/^"(.*)"$/, '$1');
  }
  return fields;
}

/** Linux's name for an architecture the browser reports: arm64 is aarch64, as uname says it. */
const MACHINES: Readonly<Record<string, string>> = { arm64: 'aarch64', x86_64: 'x86_64', arm: 'armv7l', x86: 'i686' };

/**
 * The machine as uname -m names it, from the client hints where the browser has them, else the
 * user agent; 'unknown' when the browser does not say, as Safari on a Mac does not.
 */
export async function machine(ctx: SysContext): Promise<string> {
  let arch: string | null = null;
  try {
    const hints = await ctx.sys.platform();
    if (hints?.architecture === 'arm') arch = hints.bitness === '32' ? 'arm' : 'arm64';
    else if (hints?.architecture === 'x86') arch = hints.bitness === '32' ? 'x86' : 'x86_64';
  } catch {
    // No hints: the user agent's word stands.
  }
  arch ??= ctx.sys.snapshot().os.arch;
  return (arch === null ? undefined : MACHINES[arch]) ?? 'unknown';
}

/** True when the platform knows the zone. */
function knownZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The zone times are shown in, as date picks it: $TZ when it names one (glibc reads one it does
 * not know as UTC), else the visitor's. The network commands stamp their output with it too.
 */
export function zoneOf(ctx: Pick<CommandContext, 'env' | 'clock'>): string {
  const tz = ctx.env.get('TZ');
  if (tz === undefined || tz === '') return ctx.clock.timeZone();
  return knownZone(tz) ? tz : 'UTC';
}

/** A moment as the wall clock shows it in the zone of zoneOf. */
export function wallClock(ctx: SysContext, ms: number): LocalTime {
  return localTime(ms, zoneOf(ctx));
}

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December',
] as const;
export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

export const two = (n: number): string => String(n).padStart(2, '0');

/** `20:00:05`. */
export function clockText(t: LocalTime): string {
  return `${two(t.hour)}:${two(t.minute)}:${two(t.second)}`;
}

/** `2026-10-06 19:55`, as who writes a login time. */
export function isoMinute(t: LocalTime): string {
  return `${t.year}-${two(t.month)}-${two(t.day)} ${two(t.hour)}:${two(t.minute)}`;
}

/** The day of the week of a date, 0 for Sunday. */
export function weekday(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** `Tue Oct  6 20:00:00 2026`, as watch's title and ctime write it. */
export function ctimeText(t: LocalTime): string {
  const dayName = (DAY_NAMES[weekday(t.year, t.month, t.day)] ?? '').slice(0, 3);
  const monthName = (MONTH_NAMES[t.month - 1] ?? '').slice(0, 3);
  return `${dayName} ${monthName} ${String(t.day).padStart(2)} ${clockText(t)} ${t.year}`;
}

/** How long the system has been up, as uptime and w write it: `5 min`, ` 1:05`, `2 days,  1:05`. */
export function upText(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor(minutes / 60) % 24;
  const rest = minutes % 60;
  const dayPart = days > 0 ? `${days} day${days === 1 ? '' : 's'}, ` : '';
  return hours > 0 ? `${dayPart}${String(hours).padStart(2)}:${two(rest)}` : `${dayPart}${rest} min`;
}

/** uptime -p's words: `up 1 hour, 5 minutes`. */
export function prettyUptime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const parts: string[] = [];
  const add = (n: number, unit: string): void => {
    if (n > 0) parts.push(`${n} ${unit}${n === 1 ? '' : 's'}`);
  };
  add(Math.floor(minutes / 10_080), 'week');
  add(Math.floor(minutes / 1440) % 7, 'day');
  add(Math.floor(minutes / 60) % 24, 'hour');
  add(minutes % 60, 'minute');
  return `up ${parts.length === 0 ? '0 minutes' : parts.join(', ')}`;
}

/** The line uptime prints and top and w start with: ` 20:00:05 up 5 min,  1 user,  load average: 0.25, 0.18, 0.11`. */
export function uptimeLine(ctx: SysContext, users = 1): string {
  const now = wallClock(ctx, ctx.clock.now());
  const load = loadAverages(ctx)
    .map((n) => n.toFixed(2))
    .join(', ');
  return ` ${clockText(now)} up ${upText(uptimeSeconds(ctx))}, ${String(users).padStart(2)} user${users === 1 ? '' : 's'},  load average: ${load}`;
}
