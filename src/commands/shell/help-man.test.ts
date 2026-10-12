// help, man, whatis and apropos, generated from the specs (F042, F043): help lists every visible
// command, and --help and man render for every spec.
import { describe, expect, it } from 'vitest';
import { renderScreen, runLine, session } from '../../../tests/harness';
import { isTrustedAction, type Block } from '../../output/model';
import { plain } from '../../output/plain';
import { CATEGORY_TITLES, withDoc } from '../../shell/help';
import { CATEGORY_ORDER } from '../../shell/registry';
import { allSpecFiles } from '../index';

const text = (blocks: readonly Block[]): string => blocks.map(plain).join('');
const literal = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The categories the index gives a column: every one, vesen's own (the portfolio) first. */
const COLUMNS = CATEGORY_ORDER;

describe('help', () => {
  it("is a column of eight names for each category, the standout ones first, vesen's own first, with ... where there are more", async () => {
    const s = await session({ cols: 40 });
    const result = await s.run('help');
    expect(result.status).toBe(0);
    const listed = text(result.blocks);
    expect(listed.indexOf('Vesen')).toBe(0);
    for (const spec of s.app.shell.registry.list({ category: 'portfolio' })) {
      expect(listed, spec.name).not.toContain(spec.summary);
    }
    // One lists block: a column per category, headed by its name, with eight of its commands
    // under it, the ones with the most to see first, each a tap that puts it at the prompt, and a
    // muted ... where it has more.
    const lists = result.blocks.filter((block) => block.type === 'lists');
    expect(lists).toHaveLength(1);
    const columns = lists[0]?.type === 'lists' ? lists[0].columns : [];
    expect(columns.map((column) => column.title.text)).toEqual(COLUMNS.map((category) => CATEGORY_TITLES[category]));
    COLUMNS.forEach((category, i) => {
      const all = s.app.shell.registry.list({ category }).map((spec) => spec.name);
      expect(all.length, category).toBeGreaterThan(0);
      const items = columns[i]?.items ?? [];
      const names = items.filter((item) => item.action !== undefined).map((item) => item.text);
      expect(names, category).toHaveLength(Math.min(8, all.length));
      for (const name of names) expect(all, category).toContain(name);
      expect(items.map((item) => item.text).slice(names.length), category).toEqual(all.length > 8 ? ['...'] : []);
      for (const item of items.slice(0, names.length)) {
        expect(item.action, item.text).toMatchObject({ kind: 'insert', text: `${item.text} ` });
        expect(isTrustedAction(item.action), item.text).toBe(true);
      }
    });
    // The standout ones: the commands with the most to see when run.
    expect(columns[1]?.items.map((item) => item.text)).toEqual(['tree', 'ls', 'cat', 'find', 'du', 'df', 'stat', 'file', '...']);
    expect(columns[0]?.items.map((item) => item.text)).toEqual(['theme', 'cathode', 'qr', 'banner', 'whoami', 'about', 'contact', 'repo']);
    expect(columns[4]?.items.map((item) => item.text).slice(0, 3)).toEqual(['fastfetch', 'cal', 'top']);
    expect(columns[5]?.items.map((item) => item.text)[0]).toBe('weather');
    expect(listed).not.toMatch(/\+\d+ more/);
    expect(listed).not.toContain('list directory contents');
    // How to see the rest: help with a category, and -v for what each does.
    expect(listed).toContain('help files lists every command in a category; add -v to say what each does.');
    const more = result.blocks.flatMap((block) => (block.type === 'lines' ? block.lines.flat() : [])).find((span) => span.text === 'help files');
    expect(more?.action).toMatchObject({ kind: 'run', line: 'help files' });
    // On a 40-column screen the columns come in bands, each as wide as its longest name, and no
    // row of them is wider than the screen.
    const screen = renderScreen(lists, 40);
    for (const row of screen) expect(row.length, row).toBeLessThanOrEqual(40);
    const titles = screen.filter((row) => /^(Vesen|System)\b/.test(row));
    expect(titles[0]).toMatch(/^Vesen +Files +Text +Shell$/);
    expect(titles[1]).toMatch(/^System +Network +Fun +Editor$/);
    s.stop();
  });

  it('names eight of each category on one line in a pipe, with ... where there are more', async () => {
    const piped = await session({ cols: 40, tty: false });
    const listed = `\n${(await piped.run('help')).stdoutPlain}`;
    for (const category of COLUMNS) {
      const all = piped.app.shell.registry.list({ category }).map((spec) => spec.name);
      const row = new RegExp(`\\n${CATEGORY_TITLES[category]}: ([^\\n]*)\\n`).exec(listed)?.[1]?.split(' ') ?? [];
      const names = row.filter((word) => word !== '...');
      expect(names, category).toHaveLength(Math.min(8, all.length));
      for (const name of names) expect(all, category).toContain(name);
      expect(row.at(-1) === '...', category).toBe(all.length > 8);
    }
    expect(listed).not.toMatch(/\+\d+ more/);
    piped.stop();
  });

  it('lists every command of a category for help CATEGORY, in any case, and with -v what each does', async () => {
    const s = await session();
    const files = s.app.shell.registry.list({ category: 'files' });
    const listed = await s.run('help files');
    expect(listed.status).toBe(0);
    const grid = listed.blocks.find((block) => block.type === 'grid');
    expect(grid?.type === 'grid' ? grid.items.map((item) => item.text) : []).toEqual(files.map((spec) => spec.name));
    expect(text(listed.blocks)).toContain('help -v files says what each does.');
    expect(text(listed.blocks)).not.toContain('list directory contents');
    // Any case, and vesen's own by its title or its category's name.
    expect(text((await s.run('help Files')).blocks)).toBe(text(listed.blocks));
    expect(text((await s.run('help vesen')).blocks)).toMatch(/^Vesen\n/);
    expect(text((await s.run('help portfolio')).blocks)).toBe(text((await s.run('help vesen')).blocks));
    // -v, before or after: every command of the category with its summary.
    const verbose = text((await s.run('help -v files')).blocks);
    for (const spec of files) expect(verbose, spec.name).toMatch(new RegExp(`^${literal(spec.name)} +${literal(spec.summary)}$`, 'm'));
    expect(text((await s.run('help files --verbose')).blocks)).toBe(verbose);
    expect(verbose).not.toContain('System');
    // -v alone is --all: every category, every command, with what it does.
    expect(text((await s.run('help -v')).blocks)).toBe(text((await s.run('help --all')).blocks));
    s.stop();
  });

  it('lists every visible command in the registry with --all, by category, each with its summary', async () => {
    const s = await session();
    const result = await s.run('help --all');
    expect(result.status).toBe(0);
    const listed = text(result.blocks);
    for (const spec of s.app.shell.registry.list()) {
      expect(listed, spec.name).toMatch(new RegExp(`^${literal(spec.name)} +${literal(spec.summary)}$`, 'm'));
    }
    for (const hidden of s.app.shell.registry.list({ includeHidden: true }).filter((spec) => spec.hidden)) {
      expect(listed).not.toMatch(new RegExp(`^${literal(hidden.name)} `, 'm'));
    }
    expect(listed.indexOf('Vesen')).toBe(0);
    s.stop();
  });

  it('makes each name a tap that puts it at the prompt', async () => {
    const { blocks } = await runLine('help');
    const lists = blocks.find((block) => block.type === 'lists');
    const theme = lists?.type === 'lists' ? lists.columns.flatMap((column) => column.items).find((item) => item.text === 'theme') : undefined;
    expect(isTrustedAction(theme?.action)).toBe(true);
    expect(theme?.action).toMatchObject({ kind: 'insert', text: 'theme ' });
  });

  it('is plain text in a pipe', async () => {
    expect((await runLine('help -a', { tty: false })).stdoutPlain).toMatch(/^ls +list directory contents$/m);
    expect((await runLine('help', { tty: false })).stdoutPlain).toMatch(/^Files: tree ls cat find du df stat file \.\.\.$/m);
  });

  it("shows a command's panels for help NAME, and says so for a topic it does not know", async () => {
    expect((await runLine('help ls')).stdoutPlain).toContain('ls - list directory contents');
    expect(await runLine('help nope')).toMatchObject({ status: 1, stderrPlain: "help: no help topics match 'nope'\nTry 'help' for the list, or 'apropos nope' to search it." });
    expect((await runLine('help keys')).stdoutPlain).toMatch(/^Ctrl\+L +clear the screen, keeping the line$/m);
  });

  it("answers --help and man for every spec file, the catalogue's too", async () => {
    const s = await session();
    for (const spec of await allSpecFiles()) {
      const help = await s.run(`help ${spec.name}`);
      expect(help.status, spec.name).toBe(0);
      expect(help.stdoutPlain, spec.name).toContain(`${spec.name} - ${spec.summary}`);
      if (!spec.handlesHelp) expect((await s.run(`${spec.name} --help`)).stdoutPlain, spec.name).toBe(help.stdoutPlain);
      const man = await s.run(`man ${spec.name}`);
      expect(man.status, spec.name).toBe(0);
      expect(man.stdoutPlain, spec.name).toMatch(/^NAME$[\s\S]*^SYNOPSIS$[\s\S]*^DESCRIPTION$/m);
      // The description, wherever the spec keeps it: inline, or with a body that loads lazily.
      const description = (await withDoc(spec)).description;
      if (description !== undefined) {
        const opening = description.split(/\s+/).slice(0, 6).join(' ');
        expect(help.stdoutPlain.replace(/\s+/g, ' '), spec.name).toContain(opening);
        expect(man.stdoutPlain.replace(/\s+/g, ' '), spec.name).toContain(opening);
      }
    }
    s.stop();
  });
});

describe('--version', () => {
  it("answers NAME (vesen) VERSION for every command but the shell's builtins and those that read their own options", async () => {
    const s = await session({ tty: false });
    let answered = 0;
    for (const spec of await allSpecFiles()) {
      if (spec.builtin === true || spec.handlesHelp === true) continue;
      expect(await s.run(`${spec.name} --version`), spec.name).toMatchObject({ status: 0, stdoutPlain: `${spec.name} (vesen) ${__APP_VERSION__}`, stderrPlain: '' });
      answered += 1;
    }
    expect(answered).toBeGreaterThan(100);
    // Wherever an option may be, as GNU's getopt finds it, and before --help.
    expect((await s.run('ls -l --version')).stdoutPlain).toBe(`ls (vesen) ${__APP_VERSION__}`);
    expect((await s.run('sort --version --help')).stdoutPlain).toBe(`sort (vesen) ${__APP_VERSION__}`);
    expect((await s.run('ps --version')).stdoutPlain).toBe(`ps (vesen) ${__APP_VERSION__}`);
    // After --, or as a value, it is an operand.
    expect(await s.run('grep -e --version /dev/null')).toMatchObject({ status: 1, stdoutPlain: '' });
    expect((await s.run('echo --version')).stdoutPlain).toBe('--version');
    // A builtin has no version, as bash's have none.
    expect((await s.run('cd --version')).stdoutPlain).toBe('');
    expect((await s.run('export --version')).stdoutPlain).not.toContain('(vesen)');
    s.stop();
  });
});

describe('man', () => {
  it('prints a page inline, laid out to the width, 80 columns at most', async () => {
    const { status, stdoutPlain } = await runLine('man ls', { tty: false, cols: 120 });
    expect(status).toBe(0);
    const rows = stdoutPlain.split('\n');
    expect(rows[0]).toMatch(/^LS\(1\) +User Commands +LS\(1\)$/);
    expect(rows[0]).toHaveLength(80);
    expect(rows).toContain('       -a, --all');
    expect(Math.max(...rows.map((row) => row.length))).toBeLessThanOrEqual(80);
  });

  it('has vesen itself, in section 7', async () => {
    expect((await runLine('man vesen')).stdoutPlain).toContain('vesen - a terminal in the browser, and the portfolio of Has Salvesen');
    expect((await runLine('man 7 vesen')).status).toBe(0);
    expect(await runLine('man 1 vesen')).toMatchObject({ status: 16, stderrPlain: 'No manual entry for vesen in section 1' });
  });

  it('says what it cannot find, with man-db statuses', async () => {
    expect(await runLine('man nope')).toMatchObject({ status: 16, stderrPlain: 'No manual entry for nope' });
    expect(await runLine('man')).toMatchObject({ status: 1, stderrPlain: "What manual page do you want?\nFor example, try 'man man'." });
  });

  it('searches with -k and summarises with -f', async () => {
    expect((await runLine('man -k directory', { tty: false })).stdoutPlain).toContain('ls (1)               - list directory contents');
    expect((await runLine('man -f cd', { tty: false })).stdoutPlain).toBe('cd (1)               - change the working directory');
  });
});

describe('whatis and apropos', () => {
  it('print one line per command', async () => {
    expect((await runLine('whatis ls pwd', { tty: false })).stdoutPlain).toBe(
      'ls (1)               - list directory contents\npwd (1)              - print the working directory',
    );
    expect(await runLine('whatis nope')).toMatchObject({ status: 16, stderrPlain: 'nope: nothing appropriate.' });
  });

  it('search names and summaries, ignoring case', async () => {
    const { stdoutPlain } = await runLine('apropos THEME', { tty: false });
    expect(stdoutPlain).toContain('theme (1)            - change the colour theme');
    expect(await runLine('apropos zzzz')).toMatchObject({ status: 16, stderrPlain: 'zzzz: nothing appropriate.' });
  });
});
