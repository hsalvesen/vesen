// The body of fastfetch; its spec, in fastfetch.ts, loads this the first time it runs, and this
// loads the logos only when it draws one.
//
// Every row is what the browser says, or a careful reading of it, and labelled so: the host is
// a guess from the screen and the GPU, the memory is the browser's rounded figure, the disk is
// this site's share of the browser's storage, and the uptime is this page's. WM Theme follows
// the theme as it changes, in every earlier fastfetch too.

import { appleChip } from '../../lib/sysfacts';
import { darwinRelease, gpuName, macModel, macosName, windowsRelease } from '../../lib/sysnames';
import { out, textWidth, type Line, type Palette, type Span } from '../../output/model';
import type { PlatformHints, SysSnapshot } from '../../services/types';
import { PROMPT_HOST, type CommandContext, type CommandDoc, type ExitCode } from '../../shell/types';

/** What --help, help and man say about fastfetch, besides its spec (fastfetch.ts). */
export const doc: CommandDoc = {
  description:
    "Shows this device as the browser describes it, beside its system's logo: the OS, an approximate host, the screen, the CPU and GPU, memory, this site's storage, the battery and the locale. Nothing is sent anywhere; --net adds your public IP, asked of api.ipify.org.",
};

/** Everything the rows are made from, gathered before any is written. */
export interface Facts {
  readonly snapshot: SysSnapshot;
  readonly hints: PlatformHints | null;
  readonly gpu: string | null;
  readonly battery: { readonly level: number; readonly charging: boolean } | null;
  readonly storage: { readonly usage: number; readonly quota: number } | null;
  readonly uptimeMs: number;
  readonly theme: string;
  readonly version: string;
  /** The shell's time zone, such as Australia/Sydney. */
  readonly timeZone: string;
  /** Undefined when not asked for (no --net); null when the lookup failed. */
  readonly publicIp?: string | null;
}

export interface Row {
  readonly label: string;
  readonly value: string;
  /** WM Theme: the name follows the theme. */
  readonly live?: boolean;
}

const plural = (n: number, unit: string): string => `${n} ${unit}${n === 1 ? '' : 's'}`;

/** `1 hour, 2 mins`, as fastfetch words an uptime. */
export function uptimeText(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return plural(seconds, 'sec');
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return [days > 0 ? plural(days, 'day') : '', hours > 0 ? plural(hours, 'hour') : '', mins > 0 ? plural(mins, 'min') : ''].filter(Boolean).join(', ');
}

/** Bytes as fastfetch shows them: in the largest of KiB, MiB and GiB that is at least 1, two decimals. */
export function sizeText(bytes: number): string {
  const units = ['GiB', 'MiB'] as const;
  for (const [i, unit] of units.entries()) {
    const value = bytes / 1024 ** (3 - i);
    if (value >= 1) return `${value.toFixed(2)} ${unit}`;
  }
  return `${(bytes / 1024).toFixed(2)} KiB`;
}

/** `26.0` from `26.0.0`: a version to its minor part. */
const shortVersion = (version: string): string => version.split('.').slice(0, 2).join('.');

/** The architecture the client hints name, or the user agent's. */
function archOf(facts: Facts): string | null {
  const hints = facts.hints;
  if (hints?.architecture === 'arm') return hints.bitness === '32' ? 'arm' : 'arm64';
  if (hints?.architecture === 'x86') return hints.bitness === '32' ? 'x86' : 'x86_64';
  return facts.snapshot.os.arch;
}

function osText(facts: Facts): string {
  const { name, version } = facts.snapshot.os;
  const hinted = facts.hints?.platformVersion ?? null;
  const arch = archOf(facts);
  let label: string;
  switch (name) {
    case 'macOS': {
      const full = hinted ?? version;
      const major = full === null ? NaN : Number.parseInt(full, 10);
      label = full === null ? 'macOS' : ['macOS', macosName(major), shortVersion(full)].filter(Boolean).join(' ');
      break;
    }
    case 'Windows':
      label = `Windows ${hinted !== null ? windowsRelease(hinted) : (version ?? '10 or 11')}`;
      break;
    case 'Android': {
      const release = version ?? (hinted === null ? null : hinted.split('.')[0] ?? null);
      label = release === null ? 'Android' : `Android ${release}`;
      break;
    }
    default:
      label = version === null ? name : `${name} ${version}`;
  }
  return arch === null ? label : `${label} ${arch}`;
}

function hostText(facts: Facts): string | null {
  const { os, device, screen } = facts.snapshot;
  switch (os.name) {
    case 'macOS':
      return macModel(screen.width, screen.height) ?? 'Mac';
    case 'iOS':
      return device.model === null ? 'iPhone' : `iPhone (${device.model})`;
    case 'iPadOS':
      return device.model === null ? 'iPad' : `iPad (${device.model})`;
    case 'Android':
      return facts.hints?.model ?? device.model ?? 'Android device';
    case 'ChromeOS':
      return 'Chromebook';
    case 'Windows':
    case 'Linux':
      return 'PC';
    default:
      return null;
  }
}

function kernelText(facts: Facts): string | null {
  const { name, version } = facts.snapshot.os;
  switch (name) {
    case 'macOS': {
      const full = facts.hints?.platformVersion ?? version;
      const release = full === null ? null : darwinRelease(Number.parseInt(full, 10));
      return release === null ? 'Darwin' : `Darwin ${release}`;
    }
    case 'iOS':
    case 'iPadOS':
      return 'Darwin';
    case 'Android':
    case 'ChromeOS':
    case 'Linux':
      return 'Linux';
    case 'Windows':
      return version === null ? 'WIN32_NT 10.0' : 'WIN32_NT';
    default:
      return null;
  }
}

function cpuText(facts: Facts): string | null {
  const { os, cores } = facts.snapshot;
  const arch = archOf(facts);
  const chip =
    appleChip(facts.gpu) ??
    (os.name === 'iOS' || os.name === 'iPadOS' || (os.name === 'macOS' && arch === 'arm64') ? 'Apple silicon' : arch);
  if (chip === null) return cores === null ? null : plural(cores, 'core');
  return cores === null ? chip : `${chip} (${cores})`;
}

function displayText(screen: SysSnapshot['screen']): string | null {
  const { width, height, pixelRatio } = screen;
  if (width <= 0 || height <= 0) return null;
  if (pixelRatio === 1) return `${width}x${height}`;
  return `${Math.round(width * pixelRatio)}x${Math.round(height * pixelRatio)} (as ${width}x${height})`;
}

function memoryText(gb: number | null): string | null {
  if (gb === null) return null;
  // Chrome rounds down to a power of two and stops at 8.
  return gb === 8 ? '8 GiB or more' : `about ${gb} GiB`;
}

/** The rows, in fastfetch's order, leaving out what the browser does not say. */
export function fastfetchRows(facts: Facts): Row[] {
  const { snapshot } = facts;
  const rows: (Row | null)[] = [
    { label: 'OS', value: osText(facts) },
    row('Host (approximate)', hostText(facts)),
    row('Kernel', kernelText(facts)),
    { label: 'Uptime', value: `${uptimeText(facts.uptimeMs)} (this page)` },
    { label: 'Shell', value: `vesh ${facts.version}` },
    row('Display', displayText(snapshot.screen)),
    { label: 'Terminal', value: 'vesen' },
    { label: 'WM Theme', value: facts.theme, live: true },
    { label: 'Font', value: 'Vesen Mono' },
    row('CPU', cpuText(facts)),
    row('GPU', facts.gpu === null ? null : gpuName(facts.gpu)),
    row('Memory (approximate)', memoryText(snapshot.memoryGB)),
    row(
      'Disk (WebStorage)',
      facts.storage === null
        ? null
        : `${sizeText(facts.storage.usage)} / ${sizeText(facts.storage.quota)} (${Math.round((facts.storage.usage / facts.storage.quota) * 100)}%)`,
    ),
    row('Battery', facts.battery === null ? null : `${Math.round(facts.battery.level * 100)}% [${facts.battery.charging ? 'AC connected' : 'Discharging'}]`),
    row('Locale', snapshot.languages[0] === undefined ? null : `${snapshot.languages[0]} (${facts.timeZone})`),
    facts.publicIp === undefined ? null : { label: 'Public IP', value: facts.publicIp ?? 'unavailable' },
  ];
  return rows.filter((entry): entry is Row => entry !== null);
}

function row(label: string, value: string | null): Row | null {
  return value === null ? null : { label, value };
}

const PALETTE_ROWS: readonly (readonly Palette[])[] = [
  ['black', 'red', 'green', 'yellow', 'blue', 'purple', 'cyan', 'white'],
  ['brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightPurple', 'brightCyan', 'brightWhite'],
];

/** The title, its rule, the rows and the theme's sixteen colours, as fastfetch lays them out. */
export function detailLines(user: string, rows: readonly Row[]): Line[] {
  const title = `${user}@${PROMPT_HOST}`;
  const strong = { fg: 'green', bold: true } as const;
  const lines: Line[] = [
    [out.span(user, strong), out.span('@'), out.span(PROMPT_HOST, strong)],
    [out.span('─'.repeat(title.length))],
    ...rows.map((entry): Line => [
      out.span(entry.label, { fg: 'cyan', bold: true }),
      out.span(': '),
      entry.live === true ? out.live(entry.value, { kind: 'currentThemeName' }) : out.span(entry.value),
    ]),
    [],
  ];
  // Coloured spaces, as fastfetch draws them: a screen reader passes over them.
  for (const colours of PALETTE_ROWS) lines.push(colours.map((colour): Span => out.span('   ', { bg: colour })));
  return lines;
}

/** fastfetch's layout: the logo on the left, the details on the right, stacked below 60 columns. */
export const STACK_BELOW_COLS = 60;

export async function run(ctx: CommandContext): Promise<ExitCode> {
  const [extra] = ctx.args;
  if (extra !== undefined) return ctx.usage(`extra operand '${extra}'`);
  const net = ctx.opts.net === true;
  const [hints, battery, storage, publicIp] = await Promise.all([
    ctx.sys.platform(),
    ctx.sys.battery(),
    ctx.sys.storage(),
    net ? ctx.sys.publicIp(ctx.signal) : Promise.resolve(undefined),
  ]);
  const facts: Facts = {
    snapshot: ctx.sys.snapshot(),
    hints,
    gpu: ctx.sys.gpu(),
    battery,
    storage,
    uptimeMs: ctx.sys.uptimeMs(),
    theme: ctx.appearance.currentTheme(),
    version: __APP_VERSION__,
    timeZone: ctx.clock.timeZone(),
    ...(publicIp === undefined ? {} : { publicIp }),
  };
  const rows = fastfetchRows(facts);
  const note = net ? 'Public IP from api.ipify.org, asked because of --net.' : null;

  if (!ctx.stdout.isTTY) {
    // In a pipe, the details alone, one `Label: value` a line, for grep.
    const title = `${ctx.user.name}@${PROMPT_HOST}`;
    await ctx.stdout.write([title, '─'.repeat(title.length), ...rows.map((entry) => `${entry.label}: ${entry.value}`)].join('\n') + '\n');
    if (note !== null) await ctx.stderr.line(out.span(note, { fg: 'muted' }));
    return 0;
  }
  const { logoFor } = await import('./fastfetch.logos');
  const logo = logoFor(facts.snapshot.os.name);
  // The details start just past the logo, as fastfetch lays them out.
  const logoCh = Math.max(...logo.art.split('\n').map(textWidth));
  await ctx.stdout.block(
    out.columns(
      [out.art(logo.art, logo.alt, 'scale', { fg: logo.colour, bold: true })],
      [out.lines(detailLines(ctx.user.name, rows))],
      STACK_BELOW_COLS,
      logoCh,
    ),
  );
  if (note !== null) await ctx.stdout.line(out.span(note, { fg: 'muted' }));
  return 0;
}
