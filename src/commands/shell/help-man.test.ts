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

/** The categories the index lists, each under its heading: every one, vesen's own (the portfolio) first. */
const SECTIONS = CATEGORY_ORDER;

/** Each category of an index as its heading, then its names: a one-span lines block, then a grid. */
const sectionsOf = (blocks: readonly Block[]): string[][] => {
  const sections: string[][] = [];
  for (const block of blocks) {
    if (block.type === 'grid') sections.at(-1)?.push(...block.items.map((item) => item.text));
    else if (block.type === 'lines' && block.lines.length === 1 && block.lines[0]?.length === 1) sections.push([block.lines[0][0]?.text ?? '']);
  }
  return sections;
};

const NOTE = "Type '<command> --help' (or -h) for its options, 'man <command>' for its manual, and 'help keys' for the keys.";

describe('help', () => {
  it("lists every command by name, category by category, vesen's own first, and says nothing of what they do", async () => {
    const s = await session({ cols: 40 });
    const result = await s.run('help');
    expect(result.status).toBe(0);
    const listed = text(result.blocks);
    expect(listed.indexOf('Vesen')).toBe(0);
    // Each category's heading over every one of its commands, by name, each a tap that puts it at
    // the prompt; nothing left out, no ... and no summaries.
    const sections = sectionsOf(result.blocks);
    expect(sections.map(([title]) => title)).toEqual(SECTIONS.map((category) => CATEGORY_TITLES[category]));
    SECTIONS.forEach((category, i) => {
      const all = s.app.shell.registry.list({ category }).map((spec) => spec.name);
      expect(all.length, category).toBeGreaterThan(0);
      expect(sections[i]?.slice(1), category).toEqual(all);
    });
    // The notes at the foot aside (privacy's link says what it is), no command's summary.
    const index = text(result.blocks.slice(0, -1));
    for (const spec of s.app.shell.registry.list()) expect(index, spec.name).not.toContain(spec.summary);
    for (const block of result.blocks) {
      if (block.type !== 'grid') continue;
      for (const item of block.items) {
        expect(item.action, item.text).toMatchObject({ kind: 'insert', text: `${item.text} ` });
        expect(isTrustedAction(item.action), item.text).toBe(true);
      }
    }
    expect(listed).not.toContain('...');
    // What a command does is for its --help and its manual.
    expect(listed).toContain(NOTE);
    // On a 40-column screen each grid fits the width.
    const screen = renderScreen(result.blocks.filter((block) => block.type === 'grid'), 40);
    for (const row of screen) expect(row.length, row).toBeLessThanOrEqual(40);
    s.stop();
  });

  it('names every command of each category on one line in a pipe', async () => {
    const piped = await session({ cols: 40, tty: false });
    const listed = `\n${(await piped.run('help')).stdoutPlain}`;
    for (const category of SECTIONS) {
      const all = piped.app.shell.registry.list({ category }).map((spec) => spec.name);
      const row = new RegExp(`\\n${CATEGORY_TITLES[category]}: ([^\\n]*)\\n`).exec(listed)?.[1]?.split(' ') ?? [];
      expect(row, category).toEqual(all);
    }
    expect(listed).toContain(NOTE);
    piped.stop();
  });

  it('lists the commands of a category for help CATEGORY, in any case, by name only', async () => {
    const s = await session();
    const files = s.app.shell.registry.list({ category: 'files' });
    const listed = await s.run('help files');
    expect(listed.status).toBe(0);
    const grid = listed.blocks.find((block) => block.type === 'grid');
    expect(grid?.type === 'grid' ? grid.items.map((item) => item.text) : []).toEqual(files.map((spec) => spec.name));
    expect(text(listed.blocks)).toContain(NOTE);
    expect(text(listed.blocks)).not.toContain('list directory contents');
    // Any case, and vesen's own by its title or its category's name.
    expect(text((await s.run('help Files')).blocks)).toBe(text(listed.blocks));
    expect(text((await s.run('help vesen')).blocks)).toMatch(/^Vesen\n/);
    expect(text((await s.run('help portfolio')).blocks)).toBe(text((await s.run('help vesen')).blocks));
    s.stop();
  });

  it('has no options to say what each command does: -v and --all are gone', async () => {
    for (const line of ['help -v', 'help --all', 'help -v files']) {
      const result = await runLine(line);
      expect(result.status, line).toBe(2);
      expect(result.stdoutPlain, line).not.toContain('list directory contents');
    }
  });

  it('makes each name a tap that puts it at the prompt', async () => {
    const { blocks } = await runLine('help');
    const theme = blocks.flatMap((block) => (block.type === 'grid' ? block.items : [])).find((item) => item.text === 'theme');
    expect(isTrustedAction(theme?.action)).toBe(true);
    expect(theme?.action).toMatchObject({ kind: 'insert', text: 'theme ' });
  });

  it('is plain text in a pipe', async () => {
    const piped = (await runLine('help', { tty: false })).stdoutPlain;
    expect(piped).toMatch(/^Files: (\S+ )*ls( \S+)*$/m);
    expect(piped).not.toMatch(/^ls +list directory contents$/m);
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
