// How file facts are written, shared by ls and stat: GNU's mode strings, block counts and human
// sizes, its two date styles, a dircolors-style colour table drawn in role and palette tokens, and
// the shell quoting ls gives awkward names on a terminal.

import type { SpanStyle } from '../../output/model';
import type { Stat } from '../../vfs/types';

// ── Modes ──────────────────────────────────────────────────────────────────────────────────

const TYPE_CHAR: Readonly<Record<Stat['type'], string>> = { file: '-', directory: 'd', symlink: 'l', device: 'c' };

/** `drwxr-xr-x`, `-rw-r--r--`, `drwxrwxrwt` for /tmp, `crw-rw-rw-` for /dev/null. */
export function modeString(stat: Pick<Stat, 'type' | 'mode'>): string {
  const mode = stat.mode;
  const triple = (shift: number, special: number, lower: string, upper: string): string => {
    const bits = (mode >> shift) & 7;
    const r = bits & 4 ? 'r' : '-';
    const w = bits & 2 ? 'w' : '-';
    const x = bits & 1;
    const s = (mode & special) !== 0;
    return r + w + (s ? (x ? lower : upper) : x ? 'x' : '-');
  };
  return TYPE_CHAR[stat.type] + triple(6, 0o4000, 's', 'S') + triple(3, 0o2000, 's', 'S') + triple(0, 0o1000, 't', 'T');
}

/** The permission bits in octal, as stat's %a writes them: 644, 1777. */
export function octalMode(mode: number): string {
  return (mode & 0o7777).toString(8);
}

/** True when any execute bit is set. */
export function isExecutable(stat: Pick<Stat, 'type' | 'mode'>): boolean {
  return stat.type === 'file' && (stat.mode & 0o111) !== 0;
}

/** What stat's %F calls a file. */
export function fileType(stat: Pick<Stat, 'type' | 'size'>): string {
  switch (stat.type) {
    case 'directory':
      return 'directory';
    case 'symlink':
      return 'symbolic link';
    case 'device':
      return 'character special file';
    case 'file':
      return stat.size === 0 ? 'regular empty file' : 'regular file';
  }
}

/** The major and minor numbers of the devices in /dev, as `ls -l` shows them. */
export const DEVICE_NUMBERS: Readonly<Record<string, readonly [number, number]>> = {
  null: [1, 3],
  zero: [1, 5],
  random: [1, 8],
  urandom: [1, 9],
  tty: [5, 0],
  // /dev/pts/0, the visitor's terminal: the first pseudo-terminal.
  0: [136, 0],
};

// ── Sizes ──────────────────────────────────────────────────────────────────────────────────

/** The disk a file takes in 1 KiB units, as `ls -s` and the `total` line count: 4 KiB blocks. */
export function kibBlocks(stat: Pick<Stat, 'type' | 'size'>): number {
  if (stat.type === 'directory') return 4;
  if (stat.type === 'file') return Math.ceil(stat.size / 4096) * 4;
  return 0;
}

/** A stable inode number for a path, so stat's %i and find's -ls say the same thing each time. */
export function inodeOf(path: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < path.length; i += 1) {
    hash ^= path.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return 1_000_000 + (hash % 9_000_000);
}

const UNITS = ['K', 'M', 'G', 'T', 'P', 'E'] as const;

/**
 * A size as `ls -h` writes it: bytes below 1024, then one decimal below 10 and none above, always
 * rounded up: 4096 is 4.0K, 1100 is 1.1K, 15000 is 15K.
 */
export function humanSize(bytes: number): string {
  if (bytes < 1024) return String(bytes);
  let value = bytes;
  let unit = -1;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const tenths = Math.ceil(value * 10 - 1e-9) / 10;
  if (tenths < 10) return `${tenths.toFixed(1)}${UNITS[unit] ?? ''}`;
  const whole = Math.ceil(value - 1e-9);
  if (whole >= 1024 && unit < UNITS.length - 1) return `1.0${UNITS[unit + 1] ?? ''}`;
  return `${whole}${UNITS[unit] ?? ''}`;
}

// ── Times ──────────────────────────────────────────────────────────────────────────────────

export interface LocalTime {
  readonly year: number;
  /** 1 to 12. */
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  /** Ahead of UTC, in minutes: +660 for Sydney in summer. */
  readonly offset: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let found = formatters.get(timeZone);
  if (found === undefined) {
    const options: Intl.DateTimeFormatOptions = {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hourCycle: 'h23',
      // Before year 1 the year counts back from 1 BC, so the era says which way.
      era: 'short',
    };
    try {
      found = new Intl.DateTimeFormat('en-US', { ...options, timeZone });
    } catch {
      // An unknown zone: UTC, as glibc does.
      found = new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' });
    }
    formatters.set(timeZone, found);
  }
  return found;
}

/** Date.UTC for every year: Date.UTC itself reads the years 0 to 99 as 1900 to 1999. NaN past a date's range. */
export function utcTime(year: number, month: number, day: number, hour = 0, minute = 0, second = 0, ms = 0): number {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date.setUTCHours(hour, minute, second, ms);
}

/**
 * A moment as a wall clock in `timeZone`, with that zone's offset from UTC at the time. The year
 * is astronomical (0 is 1 BC). At the very ends of a date's range the wall clock may lie past
 * it, and the offset is then NaN.
 */
export function localTime(ms: number, timeZone: string): LocalTime {
  const whole = Math.floor(ms / 1000) * 1000;
  const parts: Record<string, number> = {};
  let before = false;
  for (const part of formatter(timeZone).formatToParts(new Date(whole))) {
    if (part.type === 'era') before = /^b/i.test(part.value);
    else if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  const counted = parts.year ?? 1970;
  const year = before ? 1 - counted : counted;
  const month = parts.month ?? 1;
  const day = parts.day ?? 1;
  const hour = (parts.hour ?? 0) % 24;
  const minute = parts.minute ?? 0;
  const second = parts.second ?? 0;
  const offset = Math.round((utcTime(year, month, day, hour, minute, second) - whole) / 60_000);
  return { year, month, day, hour, minute, second, offset };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

const two = (n: number): string => String(n).padStart(2, '0');

/** About six months, the age past which `ls -l` shows the year instead of the time. */
const HALF_YEAR_MS = (365.2425 / 2) * 24 * 60 * 60 * 1000;

/** `ls -l`'s date: `Oct  6 11:00` within the last six months, `Oct  6  2025` otherwise. */
export function lsDate(ms: number, now: number, timeZone: string): string {
  const t = localTime(ms, timeZone);
  const head = `${MONTHS[t.month - 1] ?? '???'} ${String(t.day).padStart(2)}`;
  const recent = ms <= now + 60_000 && now - ms < HALF_YEAR_MS;
  return recent ? `${head} ${two(t.hour)}:${two(t.minute)}` : `${head}  ${t.year}`;
}

/** stat's full date: `2026-10-06 11:00:00.000000000 +1100`. */
export function statDate(ms: number, timeZone: string): string {
  const t = localTime(ms, timeZone);
  const nanos = String(Math.floor(((ms % 1000) + 1000) % 1000) * 1_000_000).padStart(9, '0');
  const sign = t.offset < 0 ? '-' : '+';
  const offset = Math.abs(t.offset);
  return `${t.year}-${two(t.month)}-${two(t.day)} ${two(t.hour)}:${two(t.minute)}:${two(t.second)}.${nanos} ${sign}${two(Math.floor(offset / 60))}${two(offset % 60)}`;
}

// ── Colours ────────────────────────────────────────────────────────────────────────────────

const ARCHIVES = ['tar', 'tgz', 'gz', 'zip', 'bz2', 'xz', '7z', 'rar', 'zst', 'deb', 'rpm', 'jar', 'apk', 'iso'];
const MEDIA = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'webp', 'ico', 'tif', 'tiff', 'mp4', 'mkv', 'mov', 'webm', 'avi'];
const AUDIO = ['mp3', 'm3u', 'flac', 'ogg', 'wav', 'm4a', 'aac', 'opus'];

/**
 * The dircolors table, in theme tokens so a listing re-themes: folders in the link role, links in
 * the accent, programs in the ok role, devices in the warn role and broken links in the error
 * role, all bold; archives, pictures and sound in the palette's red, purple and cyan, as
 * dircolors has them; other files in strong text.
 */
export function colourFor(stat: Pick<Stat, 'type' | 'mode'>, name: string, dangling = false): SpanStyle {
  switch (stat.type) {
    case 'directory':
      return { fg: 'link', bold: true };
    case 'symlink':
      return dangling ? { fg: 'error', bold: true } : { fg: 'accent', bold: true };
    case 'device':
      return { fg: 'warn', bold: true };
    case 'file': {
      if (isExecutable(stat)) return { fg: 'ok', bold: true };
      const dot = name.lastIndexOf('.');
      const extension = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
      if (ARCHIVES.includes(extension)) return { fg: 'red', bold: true };
      if (MEDIA.includes(extension)) return { fg: 'purple', bold: true };
      if (AUDIO.includes(extension)) return { fg: 'cyan' };
      return { fg: 'fg-strong' };
    }
  }
}

/** What `ls -F` puts after a name: / for folders, * for programs, @ for links. */
export function classifySuffix(stat: Pick<Stat, 'type' | 'mode'>, slashOnly: boolean): string {
  if (stat.type === 'directory') return '/';
  if (slashOnly) return '';
  if (stat.type === 'symlink') return '@';
  if (isExecutable(stat)) return '*';
  return '';
}

// ── Names ──────────────────────────────────────────────────────────────────────────────────

/** Characters a name may have and still be read back by the shell as it is. */
const SAFE = /^[\p{L}\p{N}\p{M}_,.+:@%/=^-]+$/u;

// Control characters, as ls shows them on a terminal: escaped inside $'...'.
const CONTROL = /[\u0000-\u001f\u007f]/;

function escapeControl(name: string): string {
  let text = '';
  for (const ch of name) {
    const code = ch.charCodeAt(0);
    if (ch === "'") text += "\\'";
    else if (ch === '\\') text += '\\\\';
    else if (ch === '\n') text += '\\n';
    else if (ch === '\t') text += '\\t';
    else if (ch === '\r') text += '\\r';
    else if (code < 0x20 || code === 0x7f) text += `\\${code.toString(8).padStart(3, '0')}`;
    else text += ch;
  }
  return `$'${text}'`;
}

/**
 * A name as `ls` shows it on a terminal (QUOTING_STYLE=shell-escape): as it is when the shell
 * would read it back unchanged, in single quotes otherwise, in double quotes when it holds a
 * single quote and nothing the shell expands inside double quotes, and as $'...' with control
 * characters escaped.
 */
export function quoteName(name: string): string {
  if (name !== '' && SAFE.test(name)) return name;
  if (CONTROL.test(name)) return escapeControl(name);
  if (name.includes("'") && !/["$`\\!]/.test(name)) return `"${name}"`;
  return `'${name.replace(/'/g, `'\\''`)}'`;
}
