// Help generated from command specs (docs/plan/02-architecture-and-contracts.md, section 11):
// the help index, grouped by category with the portfolio first, and the `<cmd> --help` panels in
// the callout style the legacy help uses (what it does, Usage, Options, Examples, See also).
// A legacy command keeps its own help (spec.legacyHelp) until it is ported.
//
// The executor loads this module the first time help is asked for, so it is not in the
// initial chunk.

import { out, type Block, type Line, type Span, type SpanStyle } from '../output/model';
import { flagKey } from './flags';
import { CATEGORY_ORDER } from './registry';
import type { ArgSpec, Category, CommandSpec, FlagSpec, Registry } from './types';

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

/**
 * Every visible command, one grid per category, portfolio first. A name inserts itself at the
 * prompt when tapped; in a pipe the index is a plain list.
 */
export function helpIndex(registry: Registry): Block[] {
  const blocks: Block[] = [];
  for (const category of CATEGORY_ORDER) {
    const specs = registry.list({ category });
    if (specs.length === 0) continue;
    blocks.push(out.lines([[out.span(CATEGORY_TITLES[category], HEADING)]]));
    blocks.push(out.grid(specs.map((spec) => out.insert(spec.name, `${spec.name} `, STRONG))));
  }
  blocks.push(out.lines([[out.span("Type '<command> --help' for details.", MUTED)]]));
  return blocks;
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
  const subs = Object.keys(spec.subcommands ?? {}).filter((name) => !spec.subcommands?.[name]?.hidden);
  if (subs.length > 0) parts.push(`{${subs.join('|')}}`);
  for (const arg of spec.args ?? []) parts.push(argUsage(arg));
  return [parts.join(' ')];
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

/** The `<cmd> --help` panels for a spec, or its legacy help while it is unported. */
export function commandHelp(spec: CommandSpec): Block[] {
  if (spec.legacyHelp !== undefined) return [out.legacyHtml(spec.legacyHelp)];
  const blocks: Block[] = [];

  const about: Line[] = [[out.span(spec.name, HEADING), out.span(` - ${spec.summary}`, STRONG)]];
  if (spec.aliases !== undefined && spec.aliases.length > 0) about.push([out.span(`Also: ${spec.aliases.join(', ')}`, MUTED)]);
  if (spec.description !== undefined) for (const row of spec.description.split('\n')) about.push([out.span(row)]);
  blocks.push(out.panel('accent', about));

  const usage: Line[] = usageLines(spec).map((row) => [out.span(row, STRONG)]);
  const options = optionLines(spec);
  if (options.length > 0) usage.push([], [out.span('Options:', HEADING)], ...options);
  const subs = Object.entries(spec.subcommands ?? {}).filter(([, sub]) => !sub.hidden);
  if (subs.length > 0) {
    usage.push([], [out.span('Commands:', HEADING)]);
    for (const [name, sub] of subs) usage.push([out.span(`  ${name}  `, STRONG), out.span(sub.summary)]);
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
