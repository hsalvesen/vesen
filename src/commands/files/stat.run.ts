// The body of stat; its spec, in stat.ts, loads this the first time stat runs, so the
// kernel's chunk carries only the spec.

import type { CommandContext, CommandDoc, ExitCode } from '../../shell/types';
import { basename } from '../../vfs/path';
import type { Stat } from '../../vfs/types';
import { unescape } from '../lib/escapes';
import { reason } from '../lib/files';
import { DEVICE_NUMBERS, fileType, inodeOf, kibBlocks, modeString, octalMode, statDate } from '../lib/listing';

/** What --help, help and man say about stat, besides its spec (stat.ts). */
export const doc: CommandDoc = {
  description:
    "Shows each FILE's size, blocks, permissions, owner, group and times. -c picks the facts and their layout with %-directives: %n name, %s size, %A permissions, %U owner, %G group, %y modified, %F type.",
  man: [
    {
      heading: 'FORMAT',
      body: '%a permissions in octal, %A in ls form, %b blocks, %F file type, %g and %G group, %u and %U owner, %h links, %i inode, %n name, %N quoted name and link target, %s size in bytes, %y modified, %Y modified in seconds since 1970, %% a percent sign. A width goes between: %-8U.',
    },
    { heading: 'EXIT STATUS', body: '0 when every FILE was found, 1 otherwise.' },
  ],
};

/** The device every file is on: one root file system. */
const DEVICE = { major: 8, minor: 1 };
const IO_BLOCK = 4096;

interface Facts {
  readonly typed: string;
  readonly stat: Stat;
  readonly target: string | undefined;
  readonly zone: string;
}

/** One %-directive of stat's format, or null for one it does not know. */
function directive(letter: string, facts: Facts): string | null {
  const { stat } = facts;
  const seconds = String(Math.floor(stat.mtime / 1000));
  switch (letter) {
    case 'a':
      return octalMode(stat.mode);
    case 'A':
      return modeString(stat);
    case 'b':
      return String(kibBlocks(stat) * 2);
    case 'B':
      return '512';
    case 'd':
      return String(DEVICE.major * 256 + DEVICE.minor);
    case 'D':
      return (DEVICE.major * 256 + DEVICE.minor).toString(16);
    case 'f':
      return ((stat.type === 'directory' ? 0o040000 : stat.type === 'symlink' ? 0o120000 : stat.type === 'device' ? 0o020000 : 0o100000) | stat.mode)
        .toString(16);
    case 'F':
      return fileType(stat);
    case 'g':
      return String(stat.gid);
    case 'G':
      return stat.group;
    case 'h':
      return String(stat.nlink);
    case 'i':
      return String(inodeOf(stat.path));
    case 'n':
      return facts.typed;
    case 'N':
      return facts.target === undefined ? `'${facts.typed}'` : `'${facts.typed}' -> '${facts.target}'`;
    case 'o':
      return String(IO_BLOCK);
    case 's':
      return String(stat.size);
    case 'u':
      return String(stat.uid);
    case 'U':
      return stat.owner;
    case 'w':
      return '-';
    case 'W':
      return '0';
    case 'x':
    case 'y':
    case 'z':
      return statDate(stat.mtime, facts.zone);
    case 'X':
    case 'Y':
    case 'Z':
      return seconds;
    default:
      return null;
  }
}

/** Fills a -c or --printf format: %-directives, with an optional width as in %-8U or %5s. */
function fill(format: string, facts: Facts): string {
  return format.replace(/%(-?)(\d*)([a-zA-Z%])/g, (_whole, left: string, width: string, letter: string) => {
    if (letter === '%') return '%';
    const value = directive(letter, facts) ?? '?';
    const size = Number(width || '0');
    return left === '-' ? value.padEnd(size) : value.padStart(size);
  });
}

/** stat's own layout. */
function describe(facts: Facts): string {
  const { stat } = facts;
  const name = facts.target === undefined ? facts.typed : `${facts.typed} -> ${facts.target}`;
  const numbers = stat.type === 'device' ? DEVICE_NUMBERS[basename(stat.path)] : undefined;
  const device = numbers === undefined ? `Links: ${stat.nlink}` : `Links: ${String(stat.nlink).padEnd(5)} Device type: ${numbers[0]},${numbers[1]}`;
  const date = statDate(stat.mtime, facts.zone);
  return [
    `  File: ${name}`,
    `  Size: ${String(stat.size).padEnd(10)}\tBlocks: ${String(kibBlocks(stat) * 2).padEnd(10)} IO Block: ${String(IO_BLOCK).padEnd(6)} ${fileType(stat)}`,
    `Device: ${DEVICE.major},${DEVICE.minor}\tInode: ${String(inodeOf(stat.path)).padEnd(11)} ${device}`,
    `Access: (${octalMode(stat.mode).padStart(4, '0')}/${modeString(stat)})  Uid: (${String(stat.uid).padStart(5)}/${stat.owner.padStart(8)})   Gid: (${String(stat.gid).padStart(5)}/${stat.group.padStart(8)})`,
    `Access: ${date}`,
    `Modify: ${date}`,
    `Change: ${date}`,
    ' Birth: -',
  ].join('\n');
}

async function statOne(ctx: CommandContext, typed: string): Promise<boolean> {
  const path = ctx.resolve(typed);
  let stat: Stat;
  try {
    stat = ctx.opts.dereference === true ? ctx.fs.stat(path) : ctx.fs.lstat(path);
  } catch (error) {
    await ctx.fail(`cannot statx '${typed}': ${reason(error)}`);
    return false;
  }
  const facts: Facts = { typed, stat, target: stat.type === 'symlink' ? ctx.fs.readlink(path) : undefined, zone: ctx.clock.timeZone() };
  const { format, printf } = ctx.opts;
  if (typeof printf === 'string') await ctx.stdout.write(fill(unescape(printf, 'format').text, facts));
  else if (typeof format === 'string') await ctx.stdout.write(`${fill(format, facts)}\n`);
  else await ctx.stdout.write(`${describe(facts)}\n`);
  return true;
}

/** Runs stat. */
export async function run(ctx: CommandContext): Promise<ExitCode | void> {
  if (ctx.args.length === 0) return ctx.usage('missing operand');
  let status = 0;
  for (const typed of ctx.args) if (!(await statOne(ctx, typed))) status = 1;
  return status;
}
