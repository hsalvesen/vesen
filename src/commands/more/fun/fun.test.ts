// The fun commands together: cmatrix hands its view to a full-screen app at the prompt and
// print a still frame anywhere else; all of them stay out of the first Tab list but are in help
// under Fun; and the two easter eggs, `sudo make me a sandwich` and `rm -rf /`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { renderScreen, runLine } from '../../../../tests/harness';
import type { FullscreenView } from '../../../shell/types';
import { complete } from '../../../shell/complete/engine';
import { keepsQuiet } from '../../../shell/complete/sources';
import type { CompletionEnv } from '../../../shell/complete/types';
import { at, completionHarness, type CompletionHarness } from '../../../testing/completion-env';
import { stepFor, type MatrixView } from '../../lib/matrix';

const FUN = ['cmatrix', 'cowsay', 'cowthink', 'factor', 'figlet', 'fortune', 'lolcat'];

/** A full-screen stand-in that records what it was asked to show, and closes with `result`. */
function screen(result: unknown = 'stopped') {
  const shown: { view: FullscreenView; props: unknown }[] = [];
  const fullscreen = (view: FullscreenView, props: unknown): Promise<unknown> => {
    shown.push({ view, props });
    return Promise.resolve(result);
  };
  return { shown, fullscreen };
}

describe('cmatrix', () => {
  it('hands the rain to the Matrix app at the prompt, at the speed -u asks for', async () => {
    const { shown, fullscreen } = screen();
    expect((await runLine('cmatrix', { fullscreen })).status).toBe(0);
    expect(await runLine('cmatrix -u 9', { fullscreen, touch: true })).toMatchObject({ status: 0, stdoutPlain: '' });
    expect(shown.map((s) => s.view)).toEqual(['matrix', 'matrix']);
    expect(shown[0]?.props).toMatchObject({ stepMs: stepFor(4), touch: false } satisfies Partial<MatrixView>);
    expect(shown[1]?.props).toMatchObject({ stepMs: stepFor(9), touch: true } satisfies Partial<MatrixView>);
    expect(stepFor(0)).toBeLessThan(stepFor(10));
  });

  it('prints one still screen into a pipe, as wide as the pipe', async () => {
    const result = await runLine('cmatrix | cat', { cols: 60 });
    expect(result.status).toBe(0);
    const rows = result.stdoutPlain.split('\n');
    expect(rows.length).toBeGreaterThanOrEqual(4);
    for (const row of rows) expect(row.length).toBeLessThanOrEqual(80);
  });

  it('refuses a delay outside 0 to 10', async () => {
    expect(await runLine('cmatrix -u 11', { tty: false })).toMatchObject({ status: 1, stderrPlain: "cmatrix: invalid delay '11': 0 to 10\nTry 'cmatrix --help' for more information." });
  });
});

describe('the first Tab list', () => {
  let h: CompletionHarness;
  let env: CompletionEnv;

  beforeAll(async () => {
    h = await completionHarness();
    await h.app.shell.registry.whenComplete();
    env = h.env;
  });

  afterAll(() => h.stop());

  const names = (line: string): string[] => complete(at(line), env).candidates.map((c) => c.value);

  it('leaves the fun commands out of a list of every command', () => {
    const all = names('');
    expect(all).toContain('ls');
    for (const name of FUN) expect(all, name).not.toContain(name);
    // So too after a pipe, and as the operand of help.
    expect(names('ls | ')).not.toContain('lolcat');
    expect(names('help ')).not.toContain('cowsay');
  });

  it('leaves them out while other commands match, and finds them once only they do', () => {
    expect(names('c')).not.toContain('cowsay');
    expect(names('c')).toContain('cat');
    expect(names('cow')).toEqual(['cowsay', 'cowthink']);
    expect(names('fortu')).toEqual(['fortune']);
    expect(names('help fig')).toEqual(['figlet']);
  });

  it('is the rule for every fun command, and for any spec that says featured: false', () => {
    for (const name of FUN) expect(keepsQuiet(h.app.shell.registry.get(name)), name).toBe(true);
    expect(keepsQuiet(h.app.shell.registry.get('ls'))).toBe(false);
    expect(keepsQuiet({ name: 'x', category: 'files', summary: 'x', featured: false })).toBe(true);
    expect(keepsQuiet({ name: 'x', category: 'fun', summary: 'x', featured: true })).toBe(false);
    expect(keepsQuiet(undefined)).toBe(false);
  });
});

describe('help', () => {
  it('lists the fun commands under Fun, by name, in a pipe', async () => {
    const result = await runLine('help', { tty: false, cols: 120 });
    const row = /^Fun: (.*)$/m.exec(result.stdoutPlain)?.[1]?.split(' ') ?? [];
    expect([...row].sort()).toEqual(FUN);
  });

  it('gives them a heading and a grid of their own on a terminal, a phone included, with every one of them', async () => {
    const phone = await runLine('help', { cols: 44, touch: true });
    const heading = phone.blocks.findIndex((block) => block.type === 'lines' && block.lines[0]?.[0]?.text === 'Fun');
    const grid = phone.blocks[heading + 1];
    expect(grid?.type === 'grid' ? grid.items.map((item) => item.text) : []).toEqual(FUN);
    // The grids fit the screen's width.
    for (const row of renderScreen(phone.blocks.filter((block) => block.type === 'grid'), 44)) expect(row.length, row).toBeLessThanOrEqual(44);
    expect(phone.stdoutPlain).not.toContain('...');
  });
});

describe('easter eggs', () => {
  it('sudo makes a sandwich, after the password prompt, and says so kindly', async () => {
    const result = await runLine('sudo make me a sandwich', { answer: () => 'hunter2' });
    expect(result.status).toBe(0);
    expect(result.prompts).toEqual(['Password: ']);
    expect(result.stdoutPlain).toContain('Okay. One sandwich, made with superuser care.');
    expect(result.stdoutPlain).not.toContain('hunter2');
    expect(result.stderrPlain).not.toContain('sudoers file');
    expect(result.blocks.some((block) => block.type === 'card')).toBe(false);
    // Anything else is still the joke.
    const other = await runLine('sudo make me a coffee', { answer: () => 'x' });
    expect(other.status).toBe(1);
    expect(other.stderrPlain).toBe('guest is not in the sudoers file.');
  });

  it('rm -rf / keeps the refusal, and winks only on the terminal', async () => {
    const refusal = "rm: it is dangerous to operate recursively on '/'\nrm: use --no-preserve-root to override this failsafe";
    const typed = await runLine('rm -rf /');
    expect(typed.status).toBe(1);
    expect(typed.stderrPlain).toBe(`${refusal}\nNice try. / stays right where it is. ;)`);
    const wink = typed.blocks.flatMap((block) => (block.type === 'lines' ? block.lines : [])).find((line) => line[0]?.text.startsWith('Nice try'));
    expect(wink?.[0]?.style).toEqual({ fg: 'muted' });
    expect((await runLine('rm -rf /', { tty: false })).stderrPlain).toBe(refusal);
    expect((await runLine('rm -r /')).stderrPlain).toBe(refusal);
  });
});
