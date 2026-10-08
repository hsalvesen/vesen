import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { SysSnapshot } from '../services/types';
import { cpuinfo, loadavg, meminfo, memoryOf, memTotalKb, mounts, processStatus, uptime, version } from './special';
import type { GenerateContext } from './types';

const BOOT = Date.UTC(2026, 9, 6, 9, 0, 0);

function snapshot(overrides: Partial<SysSnapshot> = {}): SysSnapshot {
  return {
    userAgent: 'test',
    os: { name: 'macOS', version: '15', arch: 'arm64' },
    browser: { name: 'Chrome', version: '140' },
    device: { class: 'desktop', model: null },
    cores: 8,
    memoryGB: 8,
    screen: { width: 1440, height: 900, colorDepth: 30, pixelRatio: 2 },
    languages: ['en-AU'],
    timeZone: 'Australia/Sydney',
    ...overrides,
  };
}

function context(overrides: Partial<GenerateContext> = {}): GenerateContext {
  return { now: BOOT + 3_725_500, bootTime: BOOT, sys: snapshot(), random: () => 0.5, ...overrides };
}

/** The kB value of a /proc/meminfo row. */
function field(text: string, name: string): number {
  const match = new RegExp(`^${name}:\\s+(\\d+) kB$`, 'm').exec(text);
  if (match?.[1] === undefined) throw new Error(`no ${name} in\n${text}`);
  return Number(match[1]);
}

describe('/proc, from an injected clock and device', () => {
  it('counts uptime from boot, with idle time over every core', () => {
    expect(uptime(context())).toBe('3725.50 27419.68\n');
    expect(uptime(context({ now: BOOT - 5000 }))).toBe('0.00 0.00\n');
  });

  it('lists one processor block per core', () => {
    const text = cpuinfo(context({ sys: snapshot({ cores: 3 }) }));
    expect(text.match(/^processor\t: \d+$/gm)).toEqual(['processor\t: 0', 'processor\t: 1', 'processor\t: 2']);
    expect(text).toContain('cpu cores\t: 3');
    expect(cpuinfo(context({ sys: null })).match(/^processor/gm)).toHaveLength(4);
  });

  it('reports the device memory, with MemAvailable never above MemTotal', () => {
    const text = meminfo(context());
    expect(field(text, 'MemTotal')).toBe(8 * 1024 * 1024);
    expect(memTotalKb(context({ sys: snapshot({ memoryGB: null }) }))).toBe(8 * 1024 * 1024);
    fc.assert(
      fc.property(fc.double({ min: 0, max: 0.999999, noNaN: true }), fc.constantFrom(0.25, 0.5, 1, 2, 4, 8, null), (r, gb) => {
        const rows = meminfo(context({ random: () => r, sys: snapshot({ memoryGB: gb }) }));
        const total = field(rows, 'MemTotal');
        const available = field(rows, 'MemAvailable');
        const free = field(rows, 'MemFree');
        expect(available).toBeLessThanOrEqual(total);
        expect(free).toBeLessThanOrEqual(available);
        expect(field(rows, 'Cached') + field(rows, 'Buffers') + free).toBeLessThanOrEqual(total);
      }),
    );
  });

  it('gives a sane load average, version and mounts', () => {
    const [one, five, fifteen] = loadavg(context({ random: () => 0.99 })).split(' ').map(Number);
    expect(one).toBeLessThan(1);
    expect(five).toBeLessThan(one ?? 0);
    expect(fifteen).toBeLessThan(five ?? 0);
    expect(version('2.0.0')(context())).toBe('Linux version 6.6.0-vesen (build@vesen) (vesen v2.0.0) #1 SMP PREEMPT_DYNAMIC\n');
    expect(mounts()).toContain('localstorage /home/guest vesenfs');
  });
});

describe('/proc for the process table', () => {
  const init = { pid: 1, ppid: 0, uid: 0, name: 'init', argv: ['/sbin/init'], startedAt: BOOT };
  const shell = { pid: 4242, ppid: 1, uid: 1000, name: 'vesh', argv: ['-vesh'], startedAt: BOOT };
  const ps = { pid: 4250, ppid: 4242, uid: 1000, name: '/bin/ps', argv: ['/bin/ps', 'aux'], startedAt: BOOT + 60_000 };

  it("lays out /proc/PID/status as Linux does, root's init and the visitor's others, the reader running", () => {
    expect(processStatus(init, context({ self: 4250 }))).toBe(
      ['Name:\tinit', 'State:\tS (sleeping)', 'Pid:\t1', 'PPid:\t0', 'Uid:\t0\t0\t0\t0', 'Gid:\t0\t0\t0\t0', 'VmSize:\t  167812 kB', 'VmRSS:\t   11904 kB', 'Threads:\t1', ''].join('\n'),
    );
    expect(processStatus(shell, context({ self: 4250 }))).toMatch(/^Name:\tvesh\nState:\tS \(sleeping\)\nPid:\t4242\nPPid:\t1\nUid:\t1000\t1000\t1000\t1000\nGid:\t1000\t1000\t1000\t1000\n/);
    // Known by the last part of the name it was run by, as ps -e and pgrep know it.
    expect(processStatus(ps, context({ self: 4250 }))).toMatch(/^Name:\tps\nState:\tR \(running\)\nPid:\t4250\nPPid:\t4242\n/);
  });

  it("gives each process the same memory wherever it is read, and counts the table in /proc/loadavg", () => {
    expect(memoryOf(init)).toEqual({ vsz: 167_812, rss: 11_904 });
    expect(memoryOf(shell)).toEqual({ vsz: 8_916, rss: 5_248 });
    expect(memoryOf(ps)).toEqual(memoryOf({ ...ps, pid: 4300, name: 'ps' }));
    const { vsz, rss } = memoryOf(ps);
    expect(processStatus(ps, context())).toContain(`VmSize:\t${String(vsz).padStart(8)} kB\nVmRSS:\t${String(rss).padStart(8)} kB\n`);
    expect(loadavg(context({ processes: [init, shell, ps] })).split(' ').slice(3)).toEqual(['1/3', '4250\n']);
    expect(loadavg(context()).split(' ').slice(3)).toEqual(['1/1', '1\n']);
  });
});
