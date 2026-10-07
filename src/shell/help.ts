// Help generated from command specs (docs/plan/02-architecture-and-contracts.md, section 11):
//
// - the help index: the portfolio commands with their summaries in a grid that reflows, then a
//   row of names for each other category; with --all, every category's grid. Each name is
//   tappable (it inserts itself at the prompt);
// - the `<cmd> --help` panels as callouts (what it does, Usage, Options, Examples as run chips,
//   See also);
// - man pages: NAME, SYNOPSIS, DESCRIPTION, OPTIONS, EXAMPLES and SEE ALSO, laid out to the width
//   as man lays them out, inline (the pager comes later), and `man vesen`, the about page;
// - whatis and apropos lines; `help keys`.
//
// Commands and the executor load this module the first time help is asked for. A command whose
// body loads lazily keeps its long help with the body; withDoc() fetches it first.

import { parseMarkup } from '../output/markup';
import { out, textWidth, type Block, type Line, type Span, type SpanStyle } from '../output/model';
import { flagKey } from './flags';
import { KEY_BINDINGS, TOUCH_BINDINGS, type KeyBinding } from './keys';
import { CATEGORY_ORDER } from './registry';
import type { ArgSpec, Category, CommandDoc, CommandSpec, FlagSpec, Registry } from './types';

export const CATEGORY_TITLES: Readonly<Record<Category, string>> = {
  portfolio: 'Portfolio',
  files: 'Files',
  text: 'Text',
  shell: 'Shell',
  system: 'System',
  network: 'Network',
  fun: 'Fun',
  editor: 'Editor',
};

const HEADING: SpanStyle = { fg: 'accent', bold: true };
const STRONG: SpanStyle = { fg: 'fg-strong' };
const MUTED: SpanStyle = { fg: 'muted' };
const BOLD: SpanStyle = { bold: true };

/** Room for a summary beside each name in the help index, before the grid adds a column. */
const SUMMARY_CH = 26;

// ── The index ──────────────────────────────────────────────────────────────────────────────

/**
 * A category's commands as one row: its title, then each name, tappable. Given the terminal's
 * width, the row stops at about two lines on a phone and three elsewhere, with `+N more` to tap
 * for `help --all`, so the index still fits the screen as commands are added.
 */
function namesRow(category: Category, specs: readonly CommandSpec[], width?: number): Span[] {
  const title = `${CATEGORY_TITLES[category]}: `;
  const row: Span[] = [out.span(CATEGORY_TITLES[category], HEADING), out.span(': ', HEADING)];
  // Words wrap whole, so a line may end up to a long name short of the width.
  const budget = width === undefined ? Infinity : (width < 60 ? 2 : 3) * width - 12;
  let used = title.length;
  for (const [i, spec] of specs.entries()) {
    const left = specs.length - i;
    const more = left > 1 ? ` +${left - 1} more`.length : 0;
    if (used + 1 + spec.name.length + more > budget) {
      row.push(out.span(' '), out.run(`+${left} more`, 'help --all', MUTED));
      break;
    }
    if (i > 0) row.push(out.span(' '));
    row.push(out.insert(spec.name, `${spec.name} `, STRONG));
    used += 1 + spec.name.length;
  }
  return row;
}

/** A category's heading and a grid of its names, each with its summary beside it. */
function categoryTable(category: Category, specs: readonly CommandSpec[], minCh: number): Block[] {
  return [
    out.lines([[out.span(CATEGORY_TITLES[category], HEADING)]]),
    out.grid(
      specs.map((spec) => out.insert(spec.name, `${spec.name} `, STRONG)),
      minCh,
      specs.map((spec) => [out.span(spec.summary)]),
    ),
  ];
}

const MORE_HELP: Line = [
  out.span("Type 'help <command>' for its options, 'man <command>' for its manual, ", MUTED),
  out.span("and 'help keys' for the keys.", MUTED),
];

/**
 * The help index. By default it is short enough to read on a phone without scrolling: the
 * portfolio commands, the reason the site exists, each with its summary, then one row of names
 * for every other category, cut to fit the terminal's `width` when given. With `all`, every
 * category gets the table. A name inserts itself at the prompt when tapped; in a pipe the index
 * is plain text, with every name.
 */
export function helpIndex(registry: Registry, options: { readonly all?: boolean; readonly width?: number } = {}): Block[] {
  const blocks: Block[] = [];
  const widest = Math.max(1, ...registry.list().map((spec) => textWidth(spec.name)));
  // One column on a phone, two at 80 columns, three at 120.
  const minCh = widest + 2 + SUMMARY_CH;
  const rows: Line[] = [];
  for (const category of CATEGORY_ORDER) {
    const specs = registry.list({ category });
    if (specs.length === 0) continue;
    if (options.all === true || category === 'portfolio') blocks.push(...categoryTable(category, specs, minCh));
    else rows.push(namesRow(category, specs, options.width));
  }
  if (rows.length > 0) blocks.push(out.lines([[], ...rows]));
  const more: Line[] = [[]];
  if (options.all !== true) {
    more.push([out.run('help --all', 'help --all', STRONG), out.span(' lists every command with what it does.', MUTED)]);
  }
  more.push(MORE_HELP);
  // What vesen sends where, one tap away (docs/plan/10-tooling-hosting-docs.md, 0.10).
  if (registry.get('privacy') !== undefined) {
    more.push([out.run('privacy', 'privacy', STRONG), out.span(' says what vesen sends, and where.', MUTED)]);
  }
  blocks.push(out.lines(more));
  return blocks;
}

/** `help keys`: the keys the terminal answers to, and on a touch screen what to tap. */
export function keysHelp(options: { readonly touch?: boolean } = {}): Block[] {
  const rows = (bindings: readonly KeyBinding[]): Line[][] =>
    bindings.map((binding) => [[out.span(binding.keys, STRONG)], [out.span(binding.does)]]);
  const blocks: Block[] = [out.table(rows(KEY_BINDINGS), { stackBelowCols: 30 })];
  if (options.touch) {
    blocks.push(out.lines([[], [out.span('On a touch screen', HEADING)]]));
    blocks.push(out.table(rows(TOUCH_BINDINGS), { stackBelowCols: 30 }));
  }
  blocks.push(out.lines([[], [out.span('!! runs the last line again, and !n line n of history.', MUTED)]]));
  return blocks;
}

/**
 * `help keys`, and `keys --help`: the keys, then, where `keys` is a command (the phone dock's key
 * bar), its own help, so both say everything about the keys.
 */
export function keysTopic(options: { readonly touch?: boolean; readonly spec?: CommandSpec } = {}): Block[] {
  const blocks = keysHelp(options);
  if (options.spec !== undefined) blocks.push(out.lines([[]]), ...commandHelp(options.spec));
  return blocks;
}

// ── --help ─────────────────────────────────────────────────────────────────────────────────

/**
 * The spec with all of its long help. A command whose body loads lazily keeps its description
 * and man sections there (spec.load's `doc`), so the kernel's chunk carries only the spec; this
 * loads the body to read them. When the body cannot be loaded, the spec as it is: the summary
 * stands in for the description.
 */
export async function withDoc(spec: CommandSpec): Promise<CommandSpec> {
  if (spec.load === undefined) return spec;
  let doc: CommandDoc | undefined;
  try {
    ({ doc } = await spec.load());
  } catch {
    return spec;
  }
  if (doc === undefined) return spec;
  return {
    ...spec,
    ...(spec.description === undefined && doc.description !== undefined ? { description: doc.description } : {}),
    ...(spec.man === undefined && doc.man !== undefined ? { man: doc.man } : {}),
  };
}

function argUsage(arg: ArgSpec): string {
  const name = arg.variadic ? `${arg.name}...` : arg.name;
  return arg.optional ? `[${name}]` : name;
}

/** The usage line: `head [OPTION]... [FILE]...`, or the spec's own synopsis. */
export function usageLines(spec: CommandSpec): string[] {
  if (spec.synopsis !== undefined && spec.synopsis.length > 0) return [...spec.synopsis];
  const parts = [spec.name];
  if ((spec.flags ?? []).length > 0) parts.push('[OPTION]...');
  const subs = visibleSubcommands(spec).map(([name]) => name);
  if (subs.length > 0) parts.push(`{${subs.join('|')}}`);
  for (const arg of spec.args ?? []) parts.push(argUsage(arg));
  return [parts.join(' ')];
}

function visibleSubcommands(spec: CommandSpec): [string, { readonly summary: string }][] {
  return Object.entries(spec.subcommands ?? {}).filter(([, sub]) => !sub.hidden);
}

/** `-n, --lines=NUM` */
export function flagLabel(flag: FlagSpec): string {
  const short = flag.short === undefined ? '    ' : `-${flag.short}${flag.long === undefined ? '' : ', '}`;
  let label = short + (flag.long === undefined ? '' : `--${flag.long}`);
  if (flag.value !== undefined) {
    const value = flag.long === undefined ? ` ${flag.value.name}` : `=${flag.value.name}`;
    label += flag.value.optional ? `[${value}]` : value;
  }
  return label;
}

function optionLines(spec: CommandSpec): Line[] {
  const flags = spec.flags ?? [];
  if (flags.length === 0) return [];
  const labels = flags.map(flagLabel);
  const width = Math.min(28, Math.max(...labels.map((label) => label.length)));
  return flags.map((flag, i) => {
    const label = labels[i] ?? flagKey(flag);
    // Descriptions line up, except after a label too long for the column.
    const gap = label.length <= width ? ' '.repeat(width - label.length) : ' ';
    return [out.span(`  ${label}${gap}  `, STRONG), out.span(flag.description)];
  });
}

/** The `<cmd> --help` panels for a spec. */
export function commandHelp(spec: CommandSpec): Block[] {
  const blocks: Block[] = [];

  const about: Line[] = [[out.span(spec.name, HEADING), out.span(` - ${spec.summary}`, STRONG)]];
  if (spec.aliases !== undefined && spec.aliases.length > 0) about.push([out.span(`Also: ${spec.aliases.join(', ')}`, MUTED)]);
  if (spec.description !== undefined) for (const row of spec.description.split('\n')) about.push([out.span(row)]);
  blocks.push(out.panel('accent', about));

  const usage: Line[] = usageLines(spec).map((row) => [out.span(row, STRONG)]);
  const options = optionLines(spec);
  if (options.length > 0) usage.push([], [out.span('Options:', HEADING)], ...options);
  const subs = visibleSubcommands(spec);
  if (subs.length > 0) {
    usage.push([], [out.span('Commands:', HEADING)]);
    // Summaries line up, as the options' descriptions do; the renderer hangs a wrapped one
    // under its own column.
    const width = Math.max(...subs.map(([name]) => textWidth(name)));
    for (const [name, sub] of subs) usage.push([out.span(`  ${name.padEnd(width)}  `, STRONG), out.span(sub.summary)]);
  }
  blocks.push(out.panel('link', usage, 'Usage:'));

  const examples = spec.examples ?? [];
  if (examples.length > 0) {
    // Each example is a run chip: tapping it runs the line.
    const lines: Line[] = examples.map((example) => [
      out.span('  '),
      out.run(example.line, example.line, STRONG),
      ...(example.note === undefined ? [] : [out.span(`  ${example.note}`, MUTED)]),
    ]);
    blocks.push(out.panel('warn', lines, 'Examples:'));
  }

  const seeAlso = spec.seeAlso ?? [];
  if (seeAlso.length > 0) {
    const line: Span[] = [out.span('See also: ', MUTED)];
    seeAlso.forEach((name, i) => {
      if (i > 0) line.push(out.span(', ', MUTED));
      line.push(out.run(name, `${name} --help`, STRONG));
    });
    blocks.push(out.lines([line]));
  }
  return blocks;
}

// ── man ────────────────────────────────────────────────────────────────────────────────────

export interface ManOptions {
  /** The width to lay the page out to; man stops at 80. */
  readonly columns: number;
  /** vesen's version, for the footer. */
  readonly version: string;
}

/** Splits text into rows of at most `width` cells, breaking at spaces, and long words anywhere. */
export function wrapText(text: string, width: number): string[] {
  const limit = Math.max(8, width);
  const rows: string[] = [];
  for (const paragraph of text.split('\n')) {
    let row = '';
    for (const word of paragraph.split(/ +/).filter((w) => w !== '')) {
      let rest = word;
      while (textWidth(rest) > limit) {
        if (row !== '') {
          rows.push(row);
          row = '';
        }
        rows.push(rest.slice(0, limit));
        rest = rest.slice(limit);
      }
      if (row === '') row = rest;
      else if (textWidth(row) + 1 + textWidth(rest) <= limit) row += ` ${rest}`;
      else {
        rows.push(row);
        row = rest;
      }
    }
    rows.push(row);
  }
  return rows;
}

/** A page being laid out: section headings at the margin, text indented below them. */
class Page {
  readonly lines: Line[] = [];
  readonly width: number;
  readonly indent: number;
  readonly hang: number;

  constructor(columns: number) {
    this.width = Math.max(20, Math.min(80, columns));
    // man's 7 and 14 columns, narrower on a phone so the text keeps its room.
    this.indent = this.width >= 60 ? 7 : 3;
    this.hang = this.width >= 60 ? 14 : 6;
  }

  blank(): void {
    if (this.lines.length > 0 && this.lines[this.lines.length - 1]?.length !== 0) this.lines.push([]);
  }

  heading(title: string): void {
    this.blank();
    this.lines.push([out.span(title.toUpperCase(), BOLD)]);
  }

  /** Wrapped text at `indent` columns. */
  text(text: string, indent = this.indent, style?: SpanStyle): void {
    for (const row of wrapText(text, this.width - indent)) {
      this.lines.push(row === '' ? [] : [out.span(' '.repeat(indent)), out.span(row, style)]);
    }
  }

  /** One line of spans at `indent` columns, as it is. */
  line(spans: readonly Span[], indent = this.indent): void {
    this.lines.push([out.span(' '.repeat(indent)), ...spans]);
  }

  /** `left`, `centre` and `right` spread over the width: man's header and footer. */
  edges(left: string, centre: string, right: string): void {
    const room = this.width - textWidth(left) - textWidth(right);
    if (centre !== '' && room >= textWidth(centre) + 2) {
      const before = Math.floor((room - textWidth(centre)) / 2);
      this.lines.push([out.span(`${left}${' '.repeat(before)}${centre}${' '.repeat(room - before - textWidth(centre))}${right}`)]);
    } else {
      this.lines.push([out.span(`${left}${' '.repeat(Math.max(1, room))}${right}`)]);
    }
  }
}

/** A sentence from a summary: `List directory contents.` */
function sentence(summary: string): string {
  const text = summary.trim();
  if (text === '') return text;
  const first = text.charAt(0).toUpperCase() + text.slice(1);
  return /[.!?]$/.test(first) ? first : `${first}.`;
}

/** The man page for a spec, as one block of lines laid out to the width. */
export function manPage(spec: CommandSpec, options: ManOptions): Block[] {
  const page = new Page(options.columns);
  const title = `${spec.name.toUpperCase()}(1)`;
  page.edges(title, 'User Commands', title);

  page.heading('Name');
  page.text(`${[spec.name, ...(spec.aliases ?? [])].join(', ')} - ${spec.summary}`);

  page.heading('Synopsis');
  for (const row of usageLines(spec)) {
    const [name, ...rest] = row.split(' ');
    page.line([out.span(name ?? '', BOLD), out.span(rest.length > 0 ? ` ${rest.join(' ')}` : '')]);
  }

  page.heading('Description');
  page.text(spec.description ?? sentence(spec.summary));

  const subs = visibleSubcommands(spec);
  if (subs.length > 0) {
    page.heading('Commands');
    for (const [name, sub] of subs) {
      page.line([out.span(name, BOLD)]);
      page.text(sentence(sub.summary), page.hang);
    }
  }

  const flags = spec.flags ?? [];
  // The kernel answers --help for every command that does not read it itself.
  const help = spec.handlesHelp ? [] : [{ label: '    --help', description: 'display this help and exit' }];
  const rows = [...flags.map((flag) => ({ label: flagLabel(flag), description: flag.description })), ...help];
  if (rows.length > 0) {
    page.heading('Options');
    for (const row of rows) {
      page.line([out.span(row.label.trimStart(), BOLD)]);
      page.text(sentence(row.description), page.hang);
    }
  }

  for (const section of spec.man ?? []) {
    page.heading(section.heading);
    page.text(parseMarkup(section.body).text);
  }

  const examples = spec.examples ?? [];
  if (examples.length > 0) {
    page.heading('Examples');
    for (const example of examples) {
      // Each example runs when tapped.
      page.line([out.run(example.line, example.line, BOLD)]);
      if (example.note !== undefined) page.text(sentence(example.note), page.hang);
    }
  }

  const seeAlso = spec.seeAlso ?? [];
  if (seeAlso.length > 0) {
    page.heading('See also');
    const spans: Span[] = [];
    seeAlso.forEach((name, i) => {
      if (i > 0) spans.push(out.span(', '));
      spans.push(out.run(`${name}(1)`, `man ${name}`, BOLD));
    });
    page.line(spans);
  }

  page.blank();
  page.edges(`vesen ${options.version}`, '', title);
  return [out.lines(page.lines)];
}

/** `man vesen`: what vesen is, how its shell reads a line, and where things are. */
export function vesenPage(registry: Registry, options: ManOptions): Block[] {
  const page = new Page(options.columns);
  page.edges('VESEN(7)', 'Miscellaneous', 'VESEN(7)');

  page.heading('Name');
  page.text('vesen - a terminal in the browser, and the portfolio of Has Salvesen');

  page.heading('Synopsis');
  page.line([out.link('https://www.vesen.app', 'https://www.vesen.app')]);

  page.heading('Description');
  page.text(
    'vesen is a small Linux-style shell that runs in your browser. Type a command and press Enter: help lists every command by category, and man NAME shows the manual of one.',
  );
  page.text('');
  page.text(
    'A line is read as bash reads it: quotes, pipes (|), redirection (> >> < 2> 2>&1), lists (; && ||), variables ($HOME, $?, ${NAME:-default}), command substitution $( ), arithmetic $(( )), globs (*.txt), aliases (ll) and history (!!, !n). if, for, while and functions are not supported, and say so.',
  );
  page.text('');
  page.text(
    'Files live in a virtual file system. What you change under ~ is kept in this browser, as is the command history; reset puts the original files back.',
  );

  const portfolio = registry.list({ category: 'portfolio' });
  if (portfolio.length > 0) {
    page.heading('Portfolio');
    for (const spec of portfolio) {
      page.line([out.run(spec.name, `man ${spec.name}`, BOLD)]);
      page.text(sentence(spec.summary), page.hang);
    }
  }

  page.heading('Keys');
  for (const binding of KEY_BINDINGS) {
    page.line([out.span(binding.keys, BOLD)]);
    page.text(sentence(binding.does), page.hang);
  }

  page.heading('Files');
  for (const [path, about] of [
    ['~/.bashrc', 'Read at login: the aliases ll, la and l.'],
    ['~/README.md', 'About this terminal.'],
    ['/etc/profile', 'Read at login, before ~/.bashrc.'],
  ] as const) {
    page.line([out.span(path, BOLD)]);
    page.text(about, page.hang);
  }

  page.heading('See also');
  const spans: Span[] = [];
  ['help', 'man', 'theme', 'cathode', 'reset'].forEach((name, i) => {
    if (i > 0) spans.push(out.span(', '));
    spans.push(out.run(`${name}(1)`, `man ${name}`, BOLD));
  });
  page.line(spans);

  page.heading('Author');
  page.text('Written by Has Salvesen.');

  page.blank();
  page.edges(`vesen ${options.version}`, '', 'VESEN(7)');
  return [out.lines(page.lines)];
}

// ── whatis and apropos ─────────────────────────────────────────────────────────────────────

/** One whatis line: `ls (1)               - list directory contents`. */
export function whatisLine(name: string, summary: string): string {
  return `${`${name} (1)`.padEnd(20)} - ${summary}`;
}

/** The visible commands a keyword appears in, by name, alias or summary, ignoring case. */
export function apropos(registry: Registry, keyword: string): CommandSpec[] {
  const needle = keyword.toLowerCase();
  return registry
    .list()
    .filter((spec) => [spec.name, ...(spec.aliases ?? []), spec.summary].some((text) => text.toLowerCase().includes(needle)));
}
