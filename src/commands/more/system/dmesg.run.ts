// The body of dmesg; its spec, in dmesg.ts, loads this the first time dmesg runs.

import type { CommandContext, CommandDoc, ExitCode } from '../../../shell/types';
import { GUEST } from '../../../vfs/identity';
import { KERNEL_RELEASE } from '../../../vfs/special';
import { bootTime, ctimeText, cpuCount, memInfo, readText, wallClock } from '../../lib/sysread';

/** What --help, help and man say about dmesg, besides its spec (dmesg.ts). */
export const doc: CommandDoc = {
  description:
    "Prints the kernel's messages from boot, each with the seconds since the page loaded: the kernel's version, the browser it came up in as the machine, the memory and processors the browser reports, the file systems it mounted and where your home folder is kept, then the lines /var/log/syslog kept from boot. -T writes each time as a date, and -t leaves the times out. Only root may clear the messages, so -c and -C are refused.",
  man: [{ heading: 'EXIT STATUS', body: '0, or 1 when asked to clear the messages.' }],
};

interface Message {
  readonly at: number;
  readonly text: string;
}

/** What the kernel said as it booted on this device, from /proc and the browser's facts. */
function bootMessages(ctx: CommandContext): Message[] {
  const version = (readText(ctx, '/proc/version') ?? `Linux version ${KERNEL_RELEASE}`).trim();
  const { browser, os, device } = ctx.sys.snapshot();
  const named = (name: string, ver: string | null): string => (name === 'unknown' ? 'an unknown browser' : ver === null ? name : `${name} ${ver}`);
  const machine = `${named(browser.name, browser.version)} on ${os.name === 'unknown' ? 'an unknown system' : named(os.name, os.version)}${device.model === null ? '' : ` (${device.model})`}`;
  const memory = memInfo(ctx).get('MemTotal') ?? 0;
  const cpus = cpuCount(ctx);
  return [
    { at: 0, text: version },
    { at: 0, text: `Command line: BOOT_IMAGE=/boot/vmlinuz-${KERNEL_RELEASE} root=vesenfs ro quiet` },
    { at: 0, text: `DMI: ${machine}` },
    { at: 0, text: `Memory: ${memory}K/${memory}K available` },
    { at: 0.004_118, text: 'smp: Bringing up secondary CPUs ...' },
    { at: 0.017_302, text: `smp: Brought up 1 node, ${cpus} CPU${cpus === 1 ? '' : 's'}` },
    { at: 0.031_877, text: 'devtmpfs: initialized' },
    { at: 0.092_405, text: 'VFS: Mounted root (vesenfs filesystem) readonly on device 0:1.' },
    { at: 0.118_960, text: 'tmpfs: mounted /tmp' },
    { at: 0.183_514, text: `vesenfs: ${GUEST.home} is kept in this browser's storage` },
    { at: 0.251_029, text: 'Run /sbin/init as init process' },
  ];
}

/** /var/log/syslog's lines, without the host name: a kernel line keeps its own time, the rest follow boot. */
function logMessages(ctx: CommandContext, boot: readonly Message[]): Message[] {
  const found: Message[] = [];
  let next = 0.4;
  for (const line of (readText(ctx, '/var/log/syslog') ?? '').split('\n')) {
    const text = line.replace(/^\S+\s+/, '').trim();
    if (text === '' || text === line.trim()) continue;
    const kernel = /^kernel: \[\s*(\d+\.\d+)\] (.*)$/.exec(text);
    if (kernel !== null) {
      const said = kernel[2] ?? '';
      // The kernel's own lines are in the boot messages already.
      if (!boot.some((message) => message.text.startsWith(said))) found.push({ at: Number(kernel[1]), text: said });
      continue;
    }
    found.push({ at: next, text });
    next += 0.012_345;
  }
  return found;
}

export async function run(ctx: CommandContext): Promise<ExitCode> {
  if (ctx.opts['read-clear'] === true || ctx.opts.clear === true) return ctx.fail('klogctl failed: Operation not permitted');
  const boot = bootMessages(ctx);
  const messages = [...boot, ...logMessages(ctx, boot)].sort((a, b) => a.at - b.at);
  const booted = bootTime(ctx);
  const stamp = (at: number): string => {
    if (ctx.opts.notime === true) return '';
    if (ctx.opts.ctime === true) return `[${ctimeText(wallClock(ctx, booted + at * 1000))}] `;
    return `[${at.toFixed(6).padStart(12)}] `;
  };
  await ctx.stdout.write(messages.map((message) => `${stamp(message.at)}${message.text}\n`).join(''));
  return 0;
}
