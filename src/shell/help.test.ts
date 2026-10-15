import { describe, expect, it } from 'vitest';
import { isTrustedAction, lineText, type Block } from '../output/model';
import { plain } from '../output/plain';
import {
  apropos,
  categoryHelp,
  CATEGORY_TITLES,
  commandHelp,
  flagLabel,
  helpIndex,
  keysHelp,
  manPage,
  usageLines,
  vesenPage,
  whatisLine,
  withDoc,
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
    { name: 'cd', category: 'files', summary: 'change folder', run: () => 0 },
  ]);

  /** Each category as its heading, then its names: the heading's lines block, then its grid. */
  const sectionsOf = (blocks: readonly Block[]): string[][] => {
    const sections: string[][] = [];
    for (const block of blocks) {
      if (block.type === 'grid') sections.at(-1)?.push(...block.items.map((item) => item.text));
      else if (block.type === 'lines' && block.lines.length === 1 && block.lines[0]?.length === 1) sections.push([block.lines[0][0]?.text ?? '']);
    }
    return sections;
  };

  const NOTE = "Type '<command> --help' (or -h) for its options, 'man <command>' for its manual, and 'help keys' for the keys.";

  it("is, on a terminal, every command by name under its category's heading, vesen's own first", () => {
    const blocks = helpIndex(registry, { tty: true });
    expect(text(blocks)).toBe(['Vesen', 'theme', 'whoami', 'Files', 'cd', 'ls', 'Text', 'head', '', NOTE, ''].join('\n'));
    // A heading and a grid for each category, in the categories' order and each by name; a hidden
    // command and an empty category are left out.
    expect(sectionsOf(blocks)).toEqual([
      ['Vesen', 'theme', 'whoami'],
      ['Files', 'cd', 'ls'],
      ['Text', 'head'],
    ]);
    const heading = blocks.find((block) => block.type === 'lines');
    expect(heading?.type === 'lines' ? heading.lines[0]?.[0] : undefined).toMatchObject({ text: 'Vesen', style: { fg: 'accent', bold: true } });
    expect(blocks.some((block) => block.type === 'lists')).toBe(false);
  });

  it('is plain text in a pipe: one line of names per category', () => {
    expect(text(helpIndex(registry))).toBe(['Vesen: theme whoami', 'Files: cd ls', 'Text: head', '', NOTE, ''].join('\n'));
    expect(helpIndex(registry).some((block) => block.type === 'grid')).toBe(false);
  });

  /** A Text category of 32: thirty numbered, aardvark and grep. */
  const big = new CommandRegistry([
    ...Array.from({ length: 30 }, (_, i): CommandSpec => ({ name: `cmd${String(i).padStart(2, '0')}`, category: 'text', summary: 'a command', run: () => 0 })),
    { name: 'aardvark', category: 'text', summary: 'first by name', run: () => 0 },
    { name: 'grep', category: 'text', summary: 'print lines that match patterns', run: () => 0 },
  ]);

  it('lists every command of a long category, by name, leaving none out', () => {
    const names = big.list({ category: 'text' }).map((spec) => spec.name);
    expect(names).toHaveLength(32);
    expect(sectionsOf(helpIndex(big, { tty: true }))).toEqual([['Text', ...names]]);
    expect(`\n${text(helpIndex(big))}`).toContain(`\nText: ${names.join(' ')}\n`);
    expect(text(helpIndex(big, { tty: true }))).not.toContain('...');
  });

  it("never says what a command does: that is for its --help and its manual, as the note says", () => {
    for (const blocks of [helpIndex(big, { tty: true }), helpIndex(big), categoryHelp(big, 'text', { tty: true }), categoryHelp(big, 'text')]) {
      expect(text(blocks)).not.toContain('print lines that match patterns');
      expect(text(blocks)).not.toContain('a command\n');
      expect(text(blocks)).toContain(NOTE);
      expect(text(blocks)).not.toContain('-v');
    }
  });

  it('lines the columns up from one category to the next: each grid is as wide as the longest name and a gap', () => {
    const grids = helpIndex(registry, { tty: true }).filter((block) => block.type === 'grid');
    expect(grids).toHaveLength(3);
    // whoami, the longest name, and two cells of gap.
    for (const grid of grids) if (grid.type === 'grid') expect(grid.minCh).toBe(6 + 2);
    for (const grid of grids) if (grid.type === 'grid') expect(grid.notes).toBeUndefined();
  });

  it('lists one category for help CATEGORY, names only', () => {
    const names = big.list({ category: 'text' }).map((spec) => spec.name);
    const listed = categoryHelp(big, 'text', { tty: true });
    const grid = listed.find((block) => block.type === 'grid');
    expect(grid?.type === 'grid' ? grid.items.map((item) => item.text) : []).toEqual(names);
    expect(grid?.type === 'grid' ? grid.items[0]?.action : undefined).toMatchObject({ kind: 'insert', text: 'aardvark ' });
    expect(text(listed)).toMatch(/^Text\n/);
    // In a pipe: one line of every name, and the note.
    expect(text(categoryHelp(big, 'text'))).toBe(`Text: ${names.join(' ')}\n\n${NOTE}\n`);
  });

  it('makes each name a trusted tap that inserts it at the prompt', () => {
    const grid = helpIndex(registry, { tty: true }).find((block) => block.type === 'grid');
    const item = grid?.type === 'grid' ? grid.items[0] : undefined;
    expect(item?.text).toBe('theme');
    expect(isTrustedAction(item?.action)).toBe(true);
    expect(item?.action).toMatchObject({ kind: 'insert', text: 'theme ' });
    expect(CATEGORY_TITLES.portfolio).toBe('Vesen');
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

  it('use accent, link and warn panels', () => {
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
    const cathode: CommandSpec = {
      name: 'cathode',
      category: 'portfolio',
      summary: 'trial a CRT effect',
      subcommands: { ls: { summary: 'list the variations' }, off: { summary: 'turn it off' }, secret: { summary: 'x', hidden: true } },
      run: () => 0,
    };
    expect(usageLines(cathode)).toEqual(['cathode {ls|off}']);
    const usage = commandHelp(cathode)[1];
    expect(usage?.type === 'panel' && usage.body.map(lineText)).toContain('  ls   list the variations');
    // The summaries line up, as the options' descriptions do.
    expect(usage?.type === 'panel' && usage.body.map(lineText)).toContain('  off  turn it off');
    expect(usageLines({ ...cathode, synopsis: ['cathode ls', 'cathode VARIATION'] })).toEqual(['cathode ls', 'cathode VARIATION']);
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
    // On a Mac, Cmd+C copies, so Ctrl+C never does.
    expect(desktop).toMatch(/^Ctrl\+C \(Mac\) +stop the running command, or abandon the line$/m);
    expect(desktop).toMatch(/^Ctrl\+C \(not Mac\) +stop the running command, or abandon the line; with text selected, copy it$/m);
    expect(desktop).toMatch(/^Ctrl\+W \(Mac\) +cut back to the last space$/m);
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
    expect(about).toContain("VESEN'S OWN COMMANDS");
    expect(about).toContain('       theme');
    expect(about).toContain('Written by Has Salvesen.');
  });
});

describe('the long help a lazy body keeps', () => {
  const { description: _unused, run: _run, ...bare } = head;
  const lazy = (load: CommandSpec['load']): CommandSpec => ({ ...bare, load });
  const doc = { description: 'Print the first 10 lines of each FILE.', man: [{ heading: 'Exit status', body: '0 when all went well.' }] };

  it('comes from the body: --help and man say what an inline description says', async () => {
    const full = await withDoc(lazy(() => Promise.resolve({ run: () => 0, doc })));
    expect(full.description).toBe(doc.description);
    expect(full.man).toBe(doc.man);
    expect(text(commandHelp(full))).toBe(text(commandHelp({ ...head, man: doc.man })));
    expect(text(manPage(full, { columns: 80, version: '2.0.0' }))).toBe(text(manPage({ ...head, man: doc.man }, { columns: 80, version: '2.0.0' })));
  });

  it("never replaces the spec's own, and leaves a spec with an inline body as it is", async () => {
    const own = { ...bare, description: 'Mine.', load: () => Promise.resolve({ run: () => 0, doc }) };
    expect((await withDoc(own)).description).toBe('Mine.');
    expect(await withDoc(head)).toBe(head);
  });

  it('falls back to the summary when the body cannot be loaded, or keeps no help', async () => {
    const offline = lazy(() => Promise.reject(new Error('offline')));
    expect(await withDoc(offline)).toBe(offline);
    expect(text(manPage(await withDoc(offline), { columns: 80, version: '2.0.0' }))).toContain('       Output the first part of files.');
    const none = lazy(() => Promise.resolve({ run: () => 0 }));
    expect(await withDoc(none)).toBe(none);
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
