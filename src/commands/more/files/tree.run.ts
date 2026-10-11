// The body of tree; its spec, in tree.ts, loads this the first time tree runs.
//
// The drawing is ordinary lines on the terminal, at its line height, with the connectors of
// `tree --charset=ascii` unless --charset asks for the box-drawing set. A screen reader hears
// every path instead of the connectors. A pipe receives the same text as tree prints.

import { out, type Line } from '../../../output/model';
import type { CommandContext, CommandDoc, ExitCode } from '../../../shell/types';
import type { Stat } from '../../../vfs/types';
import { childPath } from '../../lib/files';
import { matchesAny } from '../../lib/fnmatch';
import { humanSize, modeString } from '../../lib/listing';

/** What --help, help and man say about tree, besides its spec (tree.ts). */
export const doc: CommandDoc = {
  description:
    'Draws each DIRECTORY (the working directory when none is given) and everything inside it as a tree, sorted by name, then counts the folders and files it showed. Hidden names are left out unless -a asks for them; a link is shown with what it points to and is not followed.',
  man: [
    {
      heading: 'PATTERNS',
      body: "-I takes a shell pattern: * any run of characters, ? any one, [abc] one of a set. Join patterns with | to leave out any of them: tree -I '*.txt|bin'. A dot at the start of a name is an ordinary character.",
    },
    {
      heading: 'CHARSETS',
      body: "--charset NAME chooses the lines of the drawing: ascii draws them with |, ` and -, as tree --charset=ascii does; utf-8 draws box-drawing lines. ascii is the default here, unlike tree's, because this terminal draws every line at its normal line height, where box-drawing pieces no longer join up and the rows crowd each other. Any other NAME is drawn as ascii, as tree draws a charset it does not know.",
    },
    {
      heading: 'FILE DETAILS',
      body: '-p puts each entry\'s type and permissions in brackets before its name, as ls -l writes them; -s its size in bytes, and -h its size in K, M and G (4.0K). Together they share the brackets: [drwxr-xr-x 4.0K].',
    },
    { heading: 'EXIT STATUS', body: '0 when every DIRECTORY could be read, 2 when one could not.' },
  ],
};

/**
 * The lines a tree is drawn with: `tee` before an entry with more below it, `last` before the
 * last one, and `bar` or `gap` continuing beside what is inside each.
 */
export interface Charset {
  readonly tee: string;
  readonly last: string;
  readonly bar: string;
  readonly gap: string;
}

/** The charsets --charset takes: tree's ascii set, the default here, and its box-drawing utf-8 set. */
export const CHARSETS: Readonly<Record<'ascii' | 'utf-8', Charset>> = {
  ascii: { tee: '|-- ', last: '`-- ', bar: '|   ', gap: '    ' },
  'utf-8': { tee: '├── ', last: '└── ', bar: '│   ', gap: '    ' },
};

/** The charset NAME names, in any case (utf8 too); ascii for one tree does not know, as tree falls back. */
export function charsetNamed(name: unknown): Charset {
  const key = typeof name === 'string' ? name.trim().toLowerCase() : 'ascii';
  return key === 'utf-8' || key === 'utf8' ? CHARSETS['utf-8'] : CHARSETS.ascii;
}

interface Options {
  readonly all: boolean;
  readonly dirsOnly: boolean;
  readonly full: boolean;
  readonly level: number;
  readonly ignore: readonly string[];
  readonly dirsFirst: boolean;
  /** -p, -s and -h: what goes in the brackets before a name. */
  readonly perms: boolean;
  readonly size: 'bytes' | 'human' | null;
  readonly charset: Charset;
}

interface Tally {
  dirs: number;
  files: number;
  /** One line of the drawing each. */
  readonly lines: string[];
  /** The same entries as paths, for a screen reader. */
  readonly spoken: string[];
}

interface Entry {
  readonly name: string;
  readonly path: string;
  readonly directory: boolean;
  readonly link: string | null;
  /** The entry itself, not what a link points to. */
  readonly stat: Stat;
}

/** `[drwxr-xr-x 4.0K]  `, as tree writes -p, -s and -h before a name; nothing without them. */
function details(entry: Entry, options: Options): string {
  const parts: string[] = [];
  if (options.perms) parts.push(modeString(entry.stat));
  if (options.size === 'bytes') parts.push(String(entry.stat.size).padStart(11));
  else if (options.size === 'human') parts.push(humanSize(entry.stat.size).padStart(4));
  return parts.length === 0 ? '' : `[${parts.join(' ')}]  `;
}

const collator = new Intl.Collator('en');

function byName(a: Entry, b: Entry): number {
  return collator.compare(a.name, b.name) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
}

/** The entries of a folder that the options keep, sorted; null when it cannot be read. */
function entries(ctx: CommandContext, path: string, options: Options): Entry[] | null {
  let names: string[];
  try {
    names = ctx.fs.readdir(path, { all: options.all });
  } catch {
    return null;
  }
  const found: Entry[] = [];
  for (const name of names) {
    if (options.ignore.length > 0 && matchesAny(options.ignore, name)) continue;
    const child = `${path === '/' ? '' : path}/${name}`;
    let stat;
    try {
      stat = ctx.fs.lstat(child);
    } catch {
      continue;
    }
    const link = stat.type === 'symlink' ? ctx.fs.readlink(child) : null;
    let directory = stat.type === 'directory';
    if (link !== null) {
      try {
        directory = ctx.fs.stat(child).type === 'directory';
      } catch {
        directory = false;
      }
    }
    if (options.dirsOnly && !directory) continue;
    found.push({ name, path: child, directory, link, stat });
  }
  found.sort((a, b) => (options.dirsFirst && a.directory !== b.directory ? (a.directory ? -1 : 1) : byName(a, b)));
  return found;
}

/** Draws `list`, the entries of a folder `depth` folders down, and what is inside them. */
function draw(ctx: CommandContext, list: readonly Entry[], shown: string, spoken: string, prefix: string, depth: number, options: Options, tally: Tally): void {
  if (ctx.signal.aborted) throw ctx.signal.reason;
  list.forEach((entry, i) => {
    const last = i === list.length - 1;
    const childShown = childPath(shown, entry.name);
    const childSpoken = spoken === '' ? entry.name : `${spoken}/${entry.name}`;
    let label = details(entry, options) + (options.full ? childShown : entry.name);
    if (entry.link !== null) label += ` -> ${entry.link}`;
    if (entry.directory) tally.dirs += 1;
    else tally.files += 1;
    const descend = entry.directory && entry.link === null && depth < options.level;
    // Each folder is read once: here, to know whether it opens, and its entries drawn below.
    const inside = descend ? entries(ctx, entry.path, options) : [];
    const { charset } = options;
    tally.lines.push(`${prefix}${last ? charset.last : charset.tee}${label}${inside === null ? '  [error opening dir]' : ''}`);
    tally.spoken.push(entry.directory ? `${childSpoken}/` : childSpoken);
    if (inside !== null && inside.length > 0) draw(ctx, inside, childShown, childSpoken, `${prefix}${last ? charset.gap : charset.bar}`, depth + 1, options, tally);
  });
}

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

export async function run(ctx: CommandContext): Promise<ExitCode> {
  let level = Number.POSITIVE_INFINITY;
  if (ctx.opts.L !== undefined) {
    const text = String(ctx.opts.L);
    level = /^\d+$/.test(text) ? Number(text) : 0;
    if (level < 1) return ctx.fail('Invalid level, must be greater than 0.');
  }
  const ignore = Array.isArray(ctx.opts.I) ? ctx.opts.I : typeof ctx.opts.I === 'string' ? [ctx.opts.I] : [];
  const options: Options = {
    all: ctx.opts.a === true,
    dirsOnly: ctx.opts.d === true,
    full: ctx.opts.f === true,
    level,
    ignore,
    dirsFirst: ctx.opts.dirsfirst === true,
    perms: ctx.opts.p === true,
    size: ctx.opts.h === true ? 'human' : ctx.opts.s === true ? 'bytes' : null,
    charset: charsetNamed(ctx.opts.charset),
  };
  const roots = ctx.args.length === 0 ? ['.'] : ctx.args;
  const tally: Tally = { dirs: 0, files: 0, lines: [], spoken: [] };
  let status = 0;
  for (const typed of roots) {
    const path = ctx.resolve(typed);
    let stat;
    try {
      // A link named without a trailing slash is shown as a link, as tree does; `bin/` follows it.
      stat = typed.endsWith('/') ? ctx.fs.stat(path) : ctx.fs.lstat(path);
    } catch {
      tally.lines.push(`${typed}  [error opening dir]`);
      status = 2;
      continue;
    }
    if (stat.type === 'symlink') {
      tally.lines.push(`${typed} -> ${ctx.fs.readlink(path)}`);
      continue;
    }
    if (stat.type !== 'directory') {
      tally.lines.push(typed);
      tally.spoken.push(typed);
      if (!options.dirsOnly) tally.files += 1;
      continue;
    }
    const list = entries(ctx, path, options);
    if (list === null) {
      tally.lines.push(`${typed}  [error opening dir]`);
      status = 2;
      continue;
    }
    tally.lines.push(typed);
    const before = tally.spoken.length;
    draw(ctx, list, typed, '', '', 1, options, tally);
    // Spoken paths start from the folder named, so a screen reader hears where each one is.
    for (let i = before; i < tally.spoken.length; i += 1) tally.spoken[i] = childPath(typed, tally.spoken[i] ?? '');
  }
  const report = options.dirsOnly ? plural(tally.dirs, 'directory', 'directories') : `${plural(tally.dirs, 'directory', 'directories')}, ${plural(tally.files, 'file', 'files')}`;
  const alt = `Tree of ${roots.join(', ')}, ${report}${tally.spoken.length > 0 ? `: ${tally.spoken.join(', ')}` : ''}`;
  // Ordinary lines, so the drawing sits at the terminal's line height; the alt is what a screen
  // reader hears instead of the connectors.
  await ctx.stdout.block(out.lines(tally.lines.map((row): Line => [out.span(row)]), 'stdout', alt));
  if (ctx.opts.noreport !== true) await ctx.stdout.write(`\n${report}\n`);
  return status;
}
