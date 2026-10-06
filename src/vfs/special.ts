// The parts of the tree that are not ordinary files (docs/plan/designs/shell-architecture.md,
// section 5): /proc, made from the visitor's device on every read; /dev's devices; the /usr/bin
// stubs and /usr/share/man pages, one per registered command. None of it is ever persisted.

import { GUEST, HOST, LOGIN_SHELL } from './identity';
import type { GenerateContext, VirtualFile } from './types';

/** The kernel /proc/version and uname report. */
export const KERNEL_RELEASE = '6.6.0-vesen';

/** What a command looks like to the stubs and man pages. */
export interface CommandInfo {
  readonly name: string;
  readonly summary: string;
}

const KIB = 1024;

function file(name: string, generate: (context: GenerateContext) => string, mode = 0o444): VirtualFile {
  return { name, type: 'file', generate, mode, owner: 'root', group: 'root' };
}

function dir(name: string, children: readonly VirtualFile[], mode = 0o555): VirtualFile {
  return { name, type: 'directory', mode, owner: 'root', group: 'root', children: Object.fromEntries(children.map((child) => [child.name, child])) };
}

function pad(label: string, width = 16): string {
  return `${label}:`.padEnd(width);
}

// ── /proc ──────────────────────────────────────────────────────────────────────────────────

/** The device's memory in kB: what the browser reports (it rounds, and caps at 8 GB), else 8 GB. */
export function memTotalKb(context: GenerateContext): number {
  const gb = context.sys?.memoryGB;
  return Math.round((gb !== null && gb !== undefined && gb > 0 ? gb : 8) * KIB * KIB);
}

function cores(context: GenerateContext): number {
  const count = context.sys?.cores;
  return count !== null && count !== undefined && count > 0 ? Math.min(Math.floor(count), 64) : 4;
}

/** Seconds since the page booted, never negative. */
function uptimeSeconds(context: GenerateContext): number {
  return Math.max(0, (context.now - context.bootTime) / 1000);
}

export function cpuinfo(context: GenerateContext): string {
  const count = cores(context);
  const arch = context.sys?.os.arch;
  const model = `vesen virtual CPU${arch ? ` (${arch})` : ''}`;
  const blocks: string[] = [];
  for (let i = 0; i < count; i += 1) {
    blocks.push(
      [
        `processor\t: ${i}`,
        'vendor_id\t: VesenVirtual',
        `model name\t: ${model}`,
        'cpu MHz\t\t: 2400.000',
        'cache size\t: 4096 KB',
        `physical id\t: 0`,
        `siblings\t: ${count}`,
        `core id\t\t: ${i}`,
        `cpu cores\t: ${count}`,
        'flags\t\t: fpu sse sse2 wasm simd',
        'bogomips\t: 4800.00',
      ].join('\n'),
    );
  }
  return `${blocks.join('\n\n')}\n`;
}

export function meminfo(context: GenerateContext): string {
  const total = memTotalKb(context);
  // Available stays between 35% and 75% of the total, so it never exceeds it; free is less still.
  const available = Math.floor(total * (0.35 + 0.4 * context.random()));
  const free = Math.floor(available * 0.6);
  const cached = Math.floor((available - free) * 0.8);
  const buffers = Math.floor((available - free) * 0.1);
  const rows: [string, number][] = [
    ['MemTotal', total],
    ['MemFree', free],
    ['MemAvailable', available],
    ['Buffers', buffers],
    ['Cached', cached],
    ['SwapCached', 0],
    ['Active', Math.floor((total - free) * 0.6)],
    ['Inactive', Math.floor((total - free) * 0.3)],
    ['SwapTotal', 0],
    ['SwapFree', 0],
    ['Shmem', Math.floor(total * 0.01)],
  ];
  return rows.map(([label, kb]) => `${pad(label)}${String(kb).padStart(8)} kB`).join('\n') + '\n';
}

export function version(appVersion: string): (context: GenerateContext) => string {
  return () => `Linux version ${KERNEL_RELEASE} (build@${HOST}) (vesen v${appVersion}) #1 SMP PREEMPT_DYNAMIC\n`;
}

export function uptime(context: GenerateContext): string {
  const up = uptimeSeconds(context);
  // Idle time is summed over the cores, as Linux does, and they are mostly idle.
  const idle = up * cores(context) * 0.92;
  return `${up.toFixed(2)} ${idle.toFixed(2)}\n`;
}

export function loadavg(context: GenerateContext): string {
  const one = 0.05 + context.random() * 0.4;
  const five = one * 0.7;
  const fifteen = five * 0.6;
  return `${one.toFixed(2)} ${five.toFixed(2)} ${fifteen.toFixed(2)} 1/97 1\n`;
}

export function mounts(): string {
  return [
    'vesenfs / vesenfs rw,relatime 0 0',
    'proc /proc proc rw,nosuid,nodev,noexec,relatime 0 0',
    'devtmpfs /dev devtmpfs rw,nosuid,relatime 0 0',
    'tmpfs /tmp tmpfs rw,nosuid,nodev 0 0',
    `localstorage ${GUEST.home} vesenfs rw,nosuid,nodev,relatime 0 0`,
    '',
  ].join('\n');
}

/** /proc/1/status: the shell, which is the only process. */
export function status(context: GenerateContext): string {
  const rss = Math.max(1, Math.floor(memTotalKb(context) / 400));
  return [
    `${pad('Name', 8)}vesh`,
    `${pad('State', 8)}R (running)`,
    `${pad('Pid', 8)}1`,
    `${pad('PPid', 8)}0`,
    `${pad('Uid', 8)}${GUEST.uid}\t${GUEST.uid}\t${GUEST.uid}\t${GUEST.uid}`,
    `${pad('Gid', 8)}${GUEST.gid}\t${GUEST.gid}\t${GUEST.gid}\t${GUEST.gid}`,
    `${pad('VmRSS', 8)}${rss} kB`,
    `${pad('Threads', 8)}1`,
    '',
  ].join('\n');
}

export function procTree(appVersion: string): VirtualFile {
  return dir('proc', [
    file('cpuinfo', cpuinfo),
    file('meminfo', meminfo),
    file('version', version(appVersion)),
    file('uptime', uptime),
    file('loadavg', loadavg),
    file('mounts', mounts),
    { name: 'self', type: 'symlink', target: '1', mode: 0o777, owner: 'root', group: 'root' },
    { ...dir('1', [file('status', status), { name: 'exe', type: 'symlink', target: LOGIN_SHELL, mode: 0o777, owner: GUEST.name, group: GUEST.name }]), owner: GUEST.name, group: GUEST.name },
  ]);
}

// ── /dev ───────────────────────────────────────────────────────────────────────────────────

export function devTree(): VirtualFile {
  const device = (name: 'null' | 'zero' | 'random' | 'urandom' | 'tty', group = 'root'): VirtualFile => ({
    name,
    type: 'device',
    device: name,
    mode: 0o666,
    owner: 'root',
    group,
  });
  return dir('dev', [device('null'), device('zero'), device('random'), device('urandom'), device('tty', 'tty')], 0o755);
}

// ── /usr/bin and man pages ─────────────────────────────────────────────────────────────────

/** A stub for each command: running it runs the command; reading it says what it is. */
export function binStubs(commands: readonly CommandInfo[]): VirtualFile[] {
  return commands.map(({ name, summary }) => ({
    name,
    type: 'file',
    mode: 0o755,
    owner: 'root',
    group: 'root',
    builtin: name,
    content: `#!${LOGIN_SHELL}\n# ${name}: ${summary}\n# Built into vesen. Try '${name} --help' or 'man ${name}'.\n`,
  }));
}

/** A one-section man page source for each command, as man1 holds them. */
export function manPages(commands: readonly CommandInfo[]): VirtualFile[] {
  return commands.map(({ name, summary }) => ({
    name: `${name}.1`,
    type: 'file',
    mode: 0o644,
    owner: 'root',
    group: 'root',
    content: `.TH ${name.toUpperCase()} 1 "" "vesen" "User Commands"\n.SH NAME\n${name} \\- ${summary}\n.SH SEE ALSO\nRun 'man ${name}' for the full page.\n`,
  }));
}
