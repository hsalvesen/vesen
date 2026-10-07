// The fun commands together: sl and cmatrix hand their view to a full-screen app at the prompt and
// print a still frame anywhere else; all of them stay out of the first Tab list but are in help
// under Fun; and the two easter eggs, `sudo make me a sandwich` and `rm -rf /`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runLine } from '../../../../tests/harness';
import type { FullscreenView } from '../../../shell/types';
import { complete } from '../../../shell/complete/engine';
import { keepsQuiet } from '../../../shell/complete/sources';
import type { CompletionEnv } from '../../../shell/complete/types';
import { at, completionHarness, type CompletionHarness } from '../../../testing/completion-env';
import { stepFor, type MatrixView } from '../../lib/matrix';
import { trainFrame, trainView, type TrainView } from '../../lib/train';

const FUN = ['cmatrix', 'cowsay', 'cowthink', 'factor', 'figlet', 'fortune', 'lolcat', 'sl'];

/** A full-screen stand-in that records what it was asked to show, and closes with `result`. */
function screen(result: unknown = 'stopped') {
  const shown: { view: FullscreenView; props: unknown }[] = [];
  const fullscreen = (view: FullscreenView, props: unknown): Promise<unknown> => {
    shown.push({ view, props });
    return Promise.resolve(result);
  };
  return { shown, fullscreen };
}

describe('sl', () => {
  it('hands the train to the Train app at the prompt, and prints nothing itself', async () => {
    const { shown, fullscreen } = screen('crossed');
    const result = await runLine('sl', { fullscreen });
    expect(result).toMatchObject({ status: 0, stdoutPlain: '', stderrPlain: '' });
    expect(shown).toHaveLength(1);
    expect(shown[0]?.view).toBe('sl');
    const view = shown[0]?.props as TrainView;
    expect(view.frames.length).toBeGreaterThanOrEqual(4);
    expect(view.width).toBe(Math.max(...view.frames.flatMap((frame) => frame.split('\n').map((row) => row.length))));
    // Every frame is the same height, and the wheels turn between them.
    expect(new Set(view.frames.map((frame) => frame.split('\n').length)).size).toBe(1);
    expect(new Set(view.frames).size).toBeGreaterThan(1);
  });

  it('prints the train standing still into a pipe, or where no full-screen app can show', async () => {
    const { shown, fullscreen } = screen();
    const piped = await runLine('sl | cat', { fullscreen });
    expect(piped).toMatchObject({ status: 0, stdoutPlain: trainFrame(0) });
    expect(shown).toHaveLength(0);
    const plain = await runLine('sl', { tty: false });
    expect(plain.stdoutPlain).toBe(trainFrame(0));
    // At the prompt, when the app cannot show, the train is drawn as art instead.
    const art = await runLine('sl', { fullscreen: () => Promise.reject(new Error('no app')) });
    expect(art).toMatchObject({ status: 0, blocks: [expect.objectContaining({ type: 'art', alt: 'A steam train stands on the screen' })] });
  });

  it('is VESEN-liveried and original', () => {
    expect(trainFrame(0)).toContain('VESEN');
    expect(trainView().label).toBe('A steam train crosses the screen');
  });

  it('takes no operands', async () => {
    expect((await runLine('sl -l', { tty: false })).status).toBe(1);
    expect(await runLine('sl now', { tty: false })).toMatchObject({ status: 1, stderrPlain: "sl: extra operand 'now'\nTry 'sl --help' for more information." });
  });
});

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
    // A whole name stays, beside the longer names it begins.
    expect(names('sl')).toEqual(['sl', 'sleep']);
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
  it('lists the fun commands under Fun', async () => {
    const result = await runLine('help', { tty: false, cols: 120 });
    expect(result.stdoutPlain).toMatch(new RegExp(`^Fun: ${FUN.join(' ')}$`, 'm'));
    const all = await runLine('help --all', { tty: false, cols: 120 });
    expect(all.stdoutPlain).toMatch(/^Fun$/m);
    for (const name of FUN) expect(all.stdoutPlain).toMatch(new RegExp(`^${name} `, 'm'));
  });

  it('leaves them to help --all on a phone, so the index still fits its screen', async () => {
    const phone = await runLine('help', { cols: 44, touch: true });
    expect(phone.stdoutPlain).not.toMatch(/^Fun:/m);
    expect(phone.stdoutPlain).toContain('help --all lists every command with what it does. Even the fun ones.');
    expect((await runLine('help --all', { cols: 44 })).stdoutPlain).toMatch(/^Fun$/m);
    expect((await runLine('help', { cols: 60 })).stdoutPlain).toMatch(/^Fun: cmatrix/m);
  });
});

describe('easter eggs', () => {
  it('sudo makes a sandwich, after the password prompt, and says so kindly', async () => {
    const result = await runLine('sudo make me a sandwich', { answer: () => 'hunter2' });
    expect(result.status).toBe(0);
    expect(result.prompts).toEqual(['[sudo] password for guest: ']);
    expect(result.stdoutPlain).toContain('Okay. One sandwich, made with superuser care.');
    expect(result.stdoutPlain).not.toContain('hunter2');
    expect(result.stderrPlain).not.toContain('sudoers file. This incident');
    expect(result.blocks.some((block) => block.type === 'card')).toBe(false);
    // Anything else is still the joke.
    const other = await runLine('sudo make me a coffee', { answer: () => 'x' });
    expect(other.status).toBe(1);
    expect(other.stderrPlain).toContain('guest is not in the sudoers file. This incident will be reported.');
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
