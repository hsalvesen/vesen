import { describe, expect, it } from 'vitest';
import { isTrustedAction, lineText, plain, type Block } from '../output/model';
import {
  apropos,
  CATEGORY_TITLES,
  commandHelp,
  flagLabel,
  helpIndex,
  keysHelp,
  manPage,
  usageLines,
  vesenPage,
  whatisLine,
  wrapText,
} from './help';
import { KEY_BINDINGS } from './keys';
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

  it('is short: the portfolio with summaries, then a row of names for each other category', () => {
    expect(text(helpIndex(registry))).toBe(
      [
        'Portfolio',
        'theme   change the theme',
        'whoami  about the developer',
        '',
        'Files: ls',
        'Text: head',
        '',
        'help --all lists every command with what it does.',
        "Type 'help <command>' for its options, 'man <command>' for its manual, and 'help keys' for the keys.",
        '',
      ].join('\n'),
    );
    const rows = helpIndex(registry).flatMap((block) => (block.type === 'lines' ? block.lines : []));
    const files = rows.find((row) => row[0]?.text === 'Files');
    expect(files?.[2]).toMatchObject({ text: 'ls', action: { kind: 'insert', text: 'ls ' } });
    expect(isTrustedAction(files?.[2]?.action)).toBe(true);
  });

  it('groups every visible command by category with --all, the portfolio first, each with its summary', () => {
    const blocks = helpIndex(registry, { all: true });
    expect(text(blocks)).toBe(
      [
        'Portfolio',
        'theme   change the theme',
        'whoami  about the developer',
        'Files',
        'ls  list a folder',
        'Text',
        'head  output the first part of files',
        '',
        "Type 'help <command>' for its options, 'man <command>' for its manual, and 'help keys' for the keys.",
        '',
      ].join('\n'),
    );
    expect(CATEGORY_TITLES.portfolio).toBe('Portfolio');
  });

  it('lays each category out as a grid wide enough for a name and its summary', () => {
    const grids = helpIndex(registry, { all: true }).filter((block) => block.type === 'grid');
    expect(grids).toHaveLength(3);
    for (const grid of grids) {
      if (grid.type !== 'grid') continue;
      // The widest name, a gap and room for a summary: one column at 40, two at 80.
      expect(grid.minCh).toBe(6 + 2 + 26);
      expect(grid.notes).toHaveLength(grid.items.length);
    }
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
    expect(usage?.type === 'panel' && usage.body.map(lineText)).toContain('  ls   list the themes');
    // The summaries line up, as the options' descriptions do.
    expect(usage?.type === 'panel' && usage.body.map(lineText)).toContain('  set  switch theme');
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

describe('help keys', () => {
  it('lists the key bindings, and on touch what to tap', () => {
    const desktop = text(keysHelp());
    for (const binding of KEY_BINDINGS) expect(desktop).toContain(binding.keys);
    expect(desktop).toMatch(/^Ctrl\+C +stop the running command; with text selected, copy it$/m);
    expect(desktop).not.toContain('On a touch screen');
    expect(text(keysHelp({ touch: true }))).toContain('On a touch screen');
  });
});

describe('man pages', () => {
  const page = (spec: CommandSpec, columns = 80) => text(manPage(spec, { columns, version: '2.0.0' }));

  it('have the sections man has, generated from the spec', () => {
    const rows = page(head).split('\n');
    expect(rows[0]).toBe('HEAD(1)'.padEnd(33) + 'User Commands' + 'HEAD(1)'.padStart(34));
    for (const heading of ['NAME', 'SYNOPSIS', 'DESCRIPTION', 'OPTIONS', 'EXAMPLES', 'SEE ALSO']) expect(rows).toContain(heading);
    expect(rows).toContain('       head, first - output the first part of files');
    expect(rows).toContain('       head [OPTION]... [FILE...]');
    expect(rows).toContain('       -n, --lines=NUM');
    expect(rows).toContain('              Print the first NUM lines.');
    expect(rows).toContain('       --help');
    expect(rows).toContain('       tail(1), cat(1)');
    expect(rows[rows.length - 2]).toBe(`vesen 2.0.0${' '.repeat(80 - 11 - 7)}HEAD(1)`);
  });

  it('wrap to the width, and indent less on a phone', () => {
    const long = { ...head, description: 'word '.repeat(40).trim() };
    for (const columns of [40, 80, 120]) {
      for (const row of page(long, columns).split('\n')) expect(row.length, `${columns}: ${row}`).toBeLessThanOrEqual(Math.min(columns, 80));
    }
    expect(page(head, 40).split('\n')).toEqual(expect.arrayContaining(['   head, first - output the first part', '   of files']));
  });

  it('make examples runnable and related pages tappable', () => {
    const block = manPage(head, { columns: 80, version: '2.0.0' })[0];
    const spans = block?.type === 'lines' ? block.lines.flat() : [];
    expect(spans.find((span) => span.text === 'head -n 3 README.md')?.action).toMatchObject({ kind: 'run', line: 'head -n 3 README.md' });
    expect(spans.find((span) => span.text === 'tail(1)')?.action).toMatchObject({ kind: 'run', line: 'man tail' });
  });

  it('use a sentence from the summary when the spec has no description', () => {
    const { description: _unused, ...bare } = head;
    expect(page(bare)).toContain('       Output the first part of files.');
  });

  it('include the extra sections a spec has, without their markup', () => {
    const spec = { ...head, man: [{ heading: 'Exit status', body: '{bold}0{/} when all went well.' }] };
    expect(page(spec).split('\n')).toEqual(expect.arrayContaining(['EXIT STATUS', '       0 when all went well.']));
  });

  it('have one for vesen itself, which credits only its author', () => {
    const registry = new CommandRegistry([head, { name: 'theme', category: 'portfolio', summary: 'change the theme', run: () => 0 }]);
    const about = text(vesenPage(registry, { columns: 80, version: '2.0.0' }));
    expect(about).toContain('vesen - a terminal in the browser, and the portfolio of Has Salvesen');
    expect(about).toContain('PORTFOLIO');
    expect(about).toContain('       theme');
    expect(about).toContain('Written by Has Salvesen.');
  });
});

describe('wrapText', () => {
  it('breaks at spaces, keeps blank lines, and splits a word longer than the width', () => {
    expect(wrapText('one two three four', 9)).toEqual(['one two', 'three', 'four']);
    expect(wrapText('a\n\nb', 10)).toEqual(['a', '', 'b']);
    expect(wrapText('abcdefghijkl', 8)).toEqual(['abcdefgh', 'ijkl']);
  });
});

describe('whatis and apropos', () => {
  it('print man-db lines', () => {
    expect(whatisLine('ls', 'list directory contents')).toBe('ls (1)               - list directory contents');
  });

  it('search names, aliases and summaries, ignoring case, but not hidden commands', () => {
    const registry = new CommandRegistry([
      head,
      { name: 'theme', category: 'portfolio', summary: 'change the THEME', run: () => 0 },
      { name: 'sl', category: 'fun', summary: 'a train', hidden: true, run: () => 0 },
    ]);
    expect(apropos(registry, 'theme').map((spec) => spec.name)).toEqual(['theme']);
    expect(apropos(registry, 'FIRST').map((spec) => spec.name)).toEqual(['head']);
    expect(apropos(registry, 'train')).toEqual([]);
  });
});
