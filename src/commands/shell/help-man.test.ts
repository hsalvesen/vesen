// help, man, whatis and apropos, generated from the specs (F042, F043): help lists every visible
// command, and --help and man render for every spec, ported or legacy.
import { describe, expect, it } from 'vitest';
import { runLine, session } from '../../../tests/harness';
import { isTrustedAction, type Block } from '../../output/model';
import { plain } from '../../output/plain';
import { manPage, withDoc } from '../../shell/help';
import { CommandRegistry } from '../../shell/registry';
import { specFiles } from '../index';
import { LEGACY_NAMES, legacySpecs, type LegacyFn, type LegacyName } from '../legacy';

const text = (blocks: readonly Block[]): string => blocks.map(plain).join('');
const literal = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The legacy commands as specs, with stand-in functions. */
function legacyTable() {
  const commands = {} as Record<LegacyName, LegacyFn>;
  for (const name of LEGACY_NAMES) commands[name] = () => name;
  return legacySpecs({ commands, help: () => undefined });
}

describe('help', () => {
  it('is short: the portfolio commands with their summaries, then one row of names for each other category', async () => {
    const s = await session({ cols: 40 });
    const result = await s.run('help');
    expect(result.status).toBe(0);
    const listed = text(result.blocks);
    expect(listed.indexOf('Portfolio')).toBe(0);
    for (const spec of s.app.shell.registry.list({ category: 'portfolio' })) {
      expect(listed, spec.name).toMatch(new RegExp(`^${literal(spec.name)} +${literal(spec.summary)}$`, 'm'));
    }
    const files = s.app.shell.registry.list({ category: 'files' }).map((spec) => spec.name);
    expect(listed).toContain(`Files: ${files.join(' ')}`);
    expect(listed).not.toContain('list directory contents');
    expect(listed).toContain('help --all lists every command with what it does.');
    // It fits a phone's screen: the portfolio is never scrolled out of sight by the rest.
    expect(result.screen.length).toBeLessThan(40);
    const more = result.blocks.flatMap((block) => (block.type === 'lines' ? block.lines.flat() : [])).find((span) => span.text === 'help --all');
    expect(more?.action).toMatchObject({ kind: 'run', line: 'help --all' });
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
    expect(listed.indexOf('Portfolio')).toBe(0);
    s.stop();
  });

  it('makes each name a tap that puts it at the prompt', async () => {
    const { blocks } = await runLine('help');
    const grid = blocks.find((block) => block.type === 'grid');
    const theme = grid?.type === 'grid' ? grid.items.find((item) => item.text === 'theme') : undefined;
    expect(isTrustedAction(theme?.action)).toBe(true);
    expect(theme?.action).toMatchObject({ kind: 'insert', text: 'theme ' });
  });

  it('is plain text in a pipe', async () => {
    expect((await runLine('help -a', { tty: false })).stdoutPlain).toMatch(/^ls +list directory contents$/m);
    expect((await runLine('help', { tty: false })).stdoutPlain).toMatch(/^Files: cat cd /m);
  });

  it("shows a command's panels for help NAME, and says so for a topic it does not know", async () => {
    expect((await runLine('help ls')).stdoutPlain).toContain('ls - list directory contents');
    expect(await runLine('help nope')).toMatchObject({ status: 1, stderrPlain: "help: no help topics match 'nope'\nTry 'help' for the list, or 'apropos nope' to search it." });
    expect((await runLine('help keys')).stdoutPlain).toMatch(/^Ctrl\+L +clear the screen, keeping the line$/m);
  });

  it('answers --help and man for every spec file', async () => {
    const s = await session();
    for (const spec of specFiles()) {
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

  it('renders a man page for every legacy command too', () => {
    const registry = new CommandRegistry(legacyTable());
    for (const spec of registry.list({ includeHidden: true })) {
      const page = text(manPage(spec, { columns: 80, version: '2.0.0' }));
      expect(page, spec.name).toContain(`${spec.name} - ${spec.summary}`);
      expect(page, spec.name).toContain('EXAMPLES');
    }
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
