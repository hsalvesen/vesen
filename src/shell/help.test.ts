import { describe, expect, it } from 'vitest';
import { isTrustedAction, lineText, plain, type Block } from '../output/model';
import { CATEGORY_TITLES, commandHelp, flagLabel, helpIndex, usageLines } from './help';
import { CommandRegistry } from './registry';
import type { CommandSpec } from './types';

const head: CommandSpec = {
  name: 'head',
  category: 'text',
  summary: 'output the first part of files',
  aliases: ['first'],
  description: 'Print the first 10 lines of each FILE.',
  flags: [
    { short: 'n', long: 'lines', value: { name: 'NUM', source: { kind: 'int' }, default: '10' }, description: 'print the first NUM lines' },
    { short: 'q', long: 'quiet', description: 'never print headers' },
    { long: 'color', value: { name: 'WHEN', source: { kind: 'free', placeholder: 'when' }, optional: true }, description: 'colour it' },
  ],
  args: [{ name: 'FILE', source: { kind: 'path' }, optional: true, variadic: true }],
  examples: [{ line: 'head -n 3 README.md', note: 'the first three lines' }, { line: 'history | head' }],
  seeAlso: ['tail', 'cat'],
  run: () => 0,
};

const text = (blocks: readonly Block[]): string => blocks.map(plain).join('');

describe('the help index', () => {
  const registry = new CommandRegistry([
    head,
    { name: 'theme', category: 'portfolio', summary: 'change the theme', run: () => 0 },
    { name: 'whoami', category: 'portfolio', summary: 'about the developer', run: () => 0 },
    { name: 'sl', category: 'fun', summary: 'a train', hidden: true, run: () => 0 },
    { name: 'ls', category: 'files', summary: 'list a folder', run: () => 0 },
  ]);

  it('groups the visible commands by category, the portfolio first', () => {
    const blocks = helpIndex(registry);
    expect(text(blocks)).toBe("Portfolio\ntheme\nwhoami\nFiles\nls\nText\nhead\nType '<command> --help' for details.\n");
    expect(CATEGORY_TITLES.portfolio).toBe('Portfolio');
  });

  it('makes each name a trusted tap that inserts it at the prompt', () => {
    const grid = helpIndex(registry).find((block) => block.type === 'grid');
    const item = grid?.type === 'grid' ? grid.items[0] : undefined;
    expect(item?.text).toBe('theme');
    expect(isTrustedAction(item?.action)).toBe(true);
    expect(item?.action).toMatchObject({ kind: 'insert', text: 'theme ' });
  });
});

describe('--help panels', () => {
  it('describe the command, its usage, options, examples and related commands', () => {
    expect(text(commandHelp(head))).toBe(
      [
        'head - output the first part of files',
        'Also: first',
        'Print the first 10 lines of each FILE.',
        'Usage:',
        'head [OPTION]... [FILE...]',
        '',
        'Options:',
        '  -n, --lines=NUM     print the first NUM lines',
        '  -q, --quiet         never print headers',
        '      --color[=WHEN]  colour it',
        'Examples:',
        '  head -n 3 README.md  the first three lines',
        '  history | head',
        'See also: tail, cat',
        '',
      ].join('\n'),
    );
  });

  it('use the legacy look: accent, link and warn panels', () => {
    const tones = commandHelp(head).flatMap((block) => (block.type === 'panel' ? [[block.tone, block.title ?? '']] : []));
    expect(tones).toEqual([
      ['accent', ''],
      ['link', 'Usage:'],
      ['warn', 'Examples:'],
    ]);
  });

  it('make each example a run chip and each related command a tap for its help', () => {
    const blocks = commandHelp(head);
    const examples = blocks.find((block) => block.type === 'panel' && block.title === 'Examples:');
    const chip = examples?.type === 'panel' ? examples.body[0]?.[1] : undefined;
    expect(chip?.action).toMatchObject({ kind: 'run', line: 'head -n 3 README.md' });
    const seeAlso = blocks[blocks.length - 1];
    expect(seeAlso?.type === 'lines' && seeAlso.lines[0]?.[1]?.action).toMatchObject({ kind: 'run', line: 'tail --help' });
  });

  it('list subcommands, and use a synopsis when the spec has one', () => {
    const theme: CommandSpec = {
      name: 'theme',
      category: 'portfolio',
      summary: 'change the theme',
      subcommands: { ls: { summary: 'list the themes' }, set: { summary: 'switch theme' }, secret: { summary: 'x', hidden: true } },
      run: () => 0,
    };
    expect(usageLines(theme)).toEqual(['theme {ls|set}']);
    const usage = commandHelp(theme)[1];
    expect(usage?.type === 'panel' && usage.body.map(lineText)).toContain('  ls  list the themes');
    expect(usageLines({ ...theme, synopsis: ['theme ls', 'theme set NAME'] })).toEqual(['theme ls', 'theme set NAME']);
  });

  it('show a legacy command its own help, unchanged', () => {
    expect(commandHelp({ ...head, legacyHelp: '<div class="out-panel">old</div>' })).toEqual([
      { type: 'legacyHtml', html: '<div class="out-panel">old</div>' },
    ]);
  });

  it('label flags as coreutils does', () => {
    expect(flagLabel({ short: 'a', description: 'x' })).toBe('-a');
    expect(flagLabel({ long: 'all', description: 'x' })).toBe('    --all');
    expect(flagLabel({ short: 'n', value: { name: 'NUM', source: { kind: 'int' } }, description: 'x' })).toBe('-n NUM');
  });
});
