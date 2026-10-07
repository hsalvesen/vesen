// The body of ls; its spec, in ls.ts, loads this the first time ls runs, so the kernel's chunk
// carries only the spec.

import { out, type Span, type SpanStyle } from '../../output/model';
import { createFmt } from '../../shell/fmt';
import type { CommandContext, CommandDoc, ExitCode } from '../../shell/types';
import { basename, dirname, join } from '../../vfs/path';
import type { Stat } from '../../vfs/types';
import { childPath, errorCode, reason, suggestRestore, tryStat } from '../lib/files';
import { DEVICE_NUMBERS, classifySuffix, colourFor, humanSize, kibBlocks, lsDate, modeString, quoteName } from '../lib/listing';

/** What --help, help and man say about ls, besides its spec (ls.ts). */
export const doc: CommandDoc = {
  description:
    'Lists each FILE, and the contents of each folder, sorted by name; with no FILE, the working directory. Names starting with a dot are hidden unless -a or -A asks for them. On the terminal names are coloured by kind: folders, links, programs, archives, pictures.',
  man: [
    {
      heading: 'EXIT STATUS',
      body: '0 if all is well, 1 for a problem inside a folder (a subfolder that cannot be read), 2 when a FILE named on the command line cannot be found or opened.',
    },
    {
      heading: 'COLOURS',
      body: '{link,bold}folders{/}, {accent,bold}links{/}, {ok,bold}programs{/}, {warn,bold}devices{/}, {error,bold}broken links{/}, {red,bold}archives{/}, {purple,bold}pictures and video{/}, {cyan}sound{/}. --color=never turns them off; --color=always keeps them in a pipe, as escape codes.',
    },
  ],
};

const ALWAYS = new Set(['always', 'yes', 'force']);
const NEVER = new Set(['never', 'no', 'none']);
const AUTO = new Set(['auto', 'tty', 'if-tty']);

interface Options {
  readonly all: boolean;
  readonly almostAll: boolean;
  readonly long: boolean;
  readonly human: boolean;
  readonly one: boolean;
  readonly columns: boolean;
  readonly recursive: boolean;
  readonly directory: boolean;
  readonly byTime: boolean;
  readonly bySize: boolean;
  readonly reverse: boolean;
  readonly classify: boolean;
  readonly slash: boolean;
  readonly numeric: boolean;
  /** Draw names in colour: on the terminal as styles, elsewhere as SGR escapes. */
  readonly colour: boolean;
}

/** One name in a listing. */
interface Entry {
  /** The name as listed: a child's name, or an operand as typed. */
  readonly name: string;
  /** Where it is, for reading a link's target. */
  readonly path: string;
  /** What it is, without following a link. */
  readonly stat: Stat;
  /** For a link, what it points to; null when nothing is there. */
  readonly target?: Stat | null;
}

const collator = new Intl.Collator('en');

function compare(options: Options): (a: Entry, b: Entry) => number {
  const byName = (a: Entry, b: Entry): number => collator.compare(a.name, b.name) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const order = (a: Entry, b: Entry): number => {
    if (options.bySize && a.stat.size !== b.stat.size) return b.stat.size - a.stat.size;
    if (options.byTime && !options.bySize && a.stat.mtime !== b.stat.mtime) return b.stat.mtime - a.stat.mtime;
    return byName(a, b);
  };
  return options.reverse ? (a, b) => order(b, a) : order;
}

/** A name with its colour and ls -F suffix, as one or two parts. */
function nameParts(entry: Entry, options: Options, tty: boolean): Span[] {
  const shown = tty ? quoteName(entry.name) : entry.name;
  const style = options.colour ? colourFor(entry.stat, entry.name, entry.stat.type === 'symlink' && entry.target === null) : undefined;
  const suffix = options.classify || options.slash ? classifySuffix(entry.stat, options.slash) : '';
  const parts = [out.span(shown, style)];
  if (suffix !== '') parts.push(out.span(suffix));
  return parts;
}

/** Writes one output line: styled on the terminal, as SGR escapes for --color=always elsewhere. */
async function emit(ctx: CommandContext, parts: readonly (string | Span)[], options: Options): Promise<void> {
  if (ctx.stdout.isTTY || !options.colour) {
    await ctx.stdout.line(...parts);
    return;
  }
  const fmt = createFmt(true);
  const sgr = (span: Span): string => {
    const style: SpanStyle = span.style ?? {};
    // Plain files carry no colour in a stream, as with dircolors' fi=00.
    let text = style.fg === undefined || style.fg === 'fg-strong' ? span.text : fmt.fg(style.fg, span.text);
    if (style.bold && style.fg !== 'fg-strong') text = fmt.bold(text);
    return text;
  };
  await ctx.stdout.write(`${parts.map((part) => (typeof part === 'string' ? part : sgr(part))).join('')}\n`);
}

/** Names down the columns, as ls -C lays them out for a pipe of the given width. */
function columnText(names: readonly string[], width: number): string[] {
  if (names.length === 0) return [];
  const widest = Math.max(...names.map((name) => name.length));
  const column = widest + 2;
  const cols = Math.max(1, Math.floor((width + 2) / column));
  const rows = Math.ceil(names.length / cols);
  const lines: string[] = [];
  for (let r = 0; r < rows; r += 1) {
    let line = '';
    for (let c = 0; c < cols; c += 1) {
      const name = names[c * rows + r];
      if (name !== undefined) line += name.padEnd(column);
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

/** The long format's columns, aligned as GNU aligns them. */
async function longListing(ctx: CommandContext, entries: readonly Entry[], options: Options, total: boolean): Promise<void> {
  const now = ctx.clock.now();
  const zone = ctx.clock.timeZone();
  const rows = entries.map((entry) => {
    const { stat } = entry;
    const device = stat.type === 'device' ? DEVICE_NUMBERS[basename(entry.path)] : undefined;
    const size = device !== undefined ? `${device[0]}, ${device[1]}` : options.human ? humanSize(stat.size) : String(stat.size);
    return {
      entry,
      mode: modeString(stat),
      links: String(stat.nlink),
      owner: options.numeric ? String(stat.uid) : stat.owner,
      group: options.numeric ? String(stat.gid) : stat.group,
      size,
      date: lsDate(stat.mtime, now, zone),
    };
  });
  const widest = (pick: (row: (typeof rows)[number]) => string): number => Math.max(0, ...rows.map((row) => pick(row).length));
  const links = widest((row) => row.links);
  const owner = widest((row) => row.owner);
  const group = widest((row) => row.group);
  const size = widest((row) => row.size);
  if (total) {
    const blocks = entries.reduce((sum, entry) => sum + kibBlocks(entry.stat), 0);
    await emit(ctx, [`total ${options.human ? humanSize(blocks * 1024) : blocks}`], options);
  }
  for (const row of rows) {
    const head = `${row.mode} ${row.links.padStart(links)} ${row.owner.padEnd(owner)} ${row.group.padEnd(group)} ${row.size.padStart(size)} ${row.date} `;
    // In the long format a link's indicator goes after its target, not its name.
    const link = row.entry.stat.type === 'symlink';
    const parts: (string | Span)[] = [head, ...nameParts(row.entry, link ? { ...options, classify: false, slash: false } : options, ctx.stdout.isTTY)];
    if (row.entry.stat.type === 'symlink') {
      const target = ctx.fs.readlink(row.entry.path);
      parts.push(' -> ');
      const pointed = row.entry.target;
      if (pointed === null || pointed === undefined) {
        parts.push(out.span(target, options.colour ? { fg: 'error', bold: true } : undefined));
      } else {
        const style = options.colour ? colourFor(pointed, target) : undefined;
        parts.push(out.span(target, style));
        if (options.classify || options.slash) parts.push(classifySuffix(pointed, options.slash));
      }
    }
    await emit(ctx, parts, options);
  }
}

/** A listing of entries in the chosen format. */
async function listing(ctx: CommandContext, entries: readonly Entry[], options: Options, total: boolean): Promise<void> {
  if (options.long) {
    await longListing(ctx, entries, options, total);
    return;
  }
  if (entries.length === 0) return;
  const tty = ctx.stdout.isTTY;
  if (tty && !options.one) {
    // A grid reflows with the terminal's width, so a rotated phone needs no new listing.
    const items = entries.map((entry) => {
      const parts = nameParts(entry, options, true);
      const [first] = parts;
      const text = parts.map((part) => part.text).join('');
      return first === undefined ? out.span(text) : out.span(text, first.style);
    });
    // Down each column, then across, as ls -C on a terminal.
    await ctx.stdout.block(out.grid(items, undefined, undefined, 'columns'));
    return;
  }
  if (!tty && options.columns) {
    const names = entries.map((entry) => nameParts(entry, { ...options, colour: false }, false).map((part) => part.text).join(''));
    for (const line of columnText(names, ctx.stdout.columns)) await ctx.stdout.write(`${line}\n`);
    return;
  }
  for (const entry of entries) await emit(ctx, nameParts(entry, options, tty), options);
}

/** An entry for something at `path`, its link target read when it is a link. */
function entryAt(ctx: CommandContext, name: string, path: string, stat: Stat): Entry {
  if (stat.type !== 'symlink') return { name, path, stat };
  return { name, path, stat, target: tryStat(ctx, path) };
}

export async function run(ctx: CommandContext): Promise<ExitCode> {
  const o = ctx.opts;
  const color = o.color;
  let when = 'auto';
  if (color === true) when = 'always';
  else if (typeof color === 'string') {
    if (ALWAYS.has(color)) when = 'always';
    else if (NEVER.has(color)) when = 'never';
    else if (!AUTO.has(color)) {
      await ctx.fail(`invalid argument '${color}' for '--color'`);
      await ctx.stderr.write("Valid arguments are:\n  - 'always', 'yes', 'force'\n  - 'never', 'no', 'none'\n  - 'auto', 'tty', 'if-tty'\n");
      return ctx.usage();
    }
  }
  const numeric = o['numeric-uid-gid'] === true;
  const options: Options = {
    all: o.all === true,
    almostAll: o['almost-all'] === true,
    long: o.long === true || numeric,
    human: o['human-readable'] === true,
    one: o.one === true,
    columns: o.columns === true,
    recursive: o.recursive === true,
    directory: o.directory === true,
    byTime: o.time === true,
    bySize: o.size === true,
    reverse: o.reverse === true,
    classify: o.classify === true,
    slash: o.slash === true,
    numeric,
    colour: when === 'always' || (when === 'auto' && ctx.stdout.isTTY),
  };
  const order = compare(options);
  let status = 0;
  let printed = false;

  const listFolder = async (typed: string, path: string, header: boolean, top: boolean): Promise<void> => {
    let names: string[];
    try {
      names = ctx.fs.readdir(path, { all: options.all || options.almostAll });
    } catch (error) {
      await ctx.fail(`cannot open directory '${typed}': ${reason(error)}`);
      status = top ? 2 : Math.max(status, 1);
      return;
    }
    if (header) {
      if (printed) await ctx.stdout.write('\n');
      await ctx.stdout.write(`${typed}:\n`);
    }
    printed = true;
    const entries: Entry[] = [];
    if (options.all) {
      const self = tryStat(ctx, path);
      if (self !== null) entries.push({ name: '.', path, stat: self });
      const parent = tryStat(ctx, dirname(path));
      if (parent !== null) entries.push({ name: '..', path: dirname(path), stat: parent });
    }
    for (const name of names) {
      const child = join(path, name);
      try {
        entries.push(entryAt(ctx, name, child, ctx.fs.lstat(child)));
      } catch (error) {
        await ctx.fail(`cannot access '${childPath(typed, name)}': ${reason(error)}`);
        status = Math.max(status, 1);
      }
    }
    entries.sort(order);
    await listing(ctx, entries, options, true);
    if (!options.recursive) return;
    for (const entry of entries) {
      if (entry.stat.type !== 'directory' || entry.name === '.' || entry.name === '..') continue;
      await listFolder(childPath(typed, entry.name), entry.path, true, false);
    }
  };

  const operands = ctx.args.length === 0 ? ['.'] : ctx.args;
  const files: Entry[] = [];
  const folders: Entry[] = [];
  for (const typed of operands) {
    const path = ctx.resolve(typed);
    let stat: Stat;
    try {
      stat = ctx.fs.lstat(path);
    } catch (error) {
      await ctx.fail(`cannot access '${typed}': ${reason(error)}`);
      if (errorCode(error) === 'ENOENT') await suggestRestore(ctx, typed);
      status = 2;
      continue;
    }
    const entry = entryAt(ctx, typed, path, stat);
    // A link to a folder named on the command line is followed, unless -d, -l or -F asks
    // about the link itself (a trailing / follows it anyway), as GNU ls does.
    const follow = typed.endsWith('/') || !(options.directory || options.long || options.classify);
    const folder = stat.type === 'directory' || (stat.type === 'symlink' && follow && entry.target?.type === 'directory');
    if (folder && !options.directory) folders.push(entry);
    else files.push(entry);
  }
  files.sort(order);
  folders.sort(order);
  if (files.length > 0) {
    await listing(ctx, files, options, false);
    printed = true;
  }
  // Headers name each folder once there is more than one thing to list, as GNU ls does.
  const headers = operands.length > 1 || options.recursive;
  for (const folder of folders) await listFolder(folder.name, folder.path, headers, true);
  return status;
}
