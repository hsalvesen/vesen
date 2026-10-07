// cowsay and cowthink: the bubble and its wrapping, every animal within 40 columns, the face, and
// the command in the app's shell, on the terminal and into a pipe.
import { describe, expect, it } from 'vitest';
import { runLine } from '../../../../tests/harness';
import { textWidth } from '../../../output/model';
import { bubble, COW_NAMES, COWS, cowsay, DEFAULT_FACE, drawCow, findCow, messageLines, twoChars } from '../../lib/cows';
import { ANIMALS } from './cowsay';

const rows = (text: string): string[] => text.replace(/\n$/, '').split('\n');
const widest = (text: string): number => Math.max(...rows(text).map((row) => textWidth(row)));

describe('the bubble', () => {
  it('holds one line in < >, and several in / \\, | | and \\ /', () => {
    expect(bubble(['hello'], false)).toEqual([' _______', '< hello >', ' -------']);
    expect(bubble(['one', 'two', 'three'], false)).toEqual([' _______', '/ one   \\', '| two   |', '\\ three /', ' -------']);
    expect(bubble(['a', 'b'], false)).toEqual([' ___', '/ a \\', '\\ b /', ' ---']);
  });

  it('holds a thought in ( ), however many lines', () => {
    expect(bubble(['hmm'], true)).toEqual([' _____', '( hmm )', ' -----']);
    expect(bubble(['a', 'bb'], true)).toEqual([' ____', '( a  )', '( bb )', ' ----']);
  });

  it('is an empty bubble for an empty message', () => {
    expect(bubble([], false)).toEqual([' __', '<  >', ' --']);
  });

  it('pads by display width, so wide characters line up', () => {
    const [top, line, bottom] = bubble(['日本'], false);
    expect(textWidth(line ?? '')).toBe(textWidth(top ?? '') + 1);
    expect(textWidth(bottom ?? '')).toBe(textWidth(top ?? ''));
  });
});

describe('wrapping', () => {
  const words = 'the quick brown fox jumps over the lazy dog and keeps on running far away';

  it('fills each paragraph to lines before column WIDTH, as cowsay does', () => {
    const lines = messageLines(words, { wrapAt: 20, wrap: true });
    expect(lines).toEqual(['the quick brown fox', 'jumps over the lazy', 'dog and keeps on', 'running far away']);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(19);
    for (const wrapAt of [2, 5, 13, 40, 80]) {
      for (const line of messageLines(words, { wrapAt, wrap: true })) expect(textWidth(line)).toBeLessThanOrEqual(wrapAt - 1);
    }
  });

  it('joins the lines of a paragraph, keeps a blank line between paragraphs, and cuts a long word', () => {
    expect(messageLines('one\ntwo\n\nthree\n', { wrapAt: 40, wrap: true })).toEqual(['one two', '', 'three']);
    expect(messageLines('abcdefghijkl', { wrapAt: 6, wrap: true })).toEqual(['abcde', 'fghij', 'kl']);
    expect(messageLines('  spaced   out  ', { wrapAt: 40, wrap: true })).toEqual(['spaced out']);
  });

  it('keeps every line as it is with -n, tabs expanded', () => {
    expect(messageLines('a\n  b\tc\n', { wrapAt: 3, wrap: false })).toEqual(['a', '  b     c']);
  });
});

describe('the animals', () => {
  it('are the ones -f completes, cow first', () => {
    expect(COW_NAMES).toEqual(ANIMALS.map((animal) => animal.value));
    expect(COW_NAMES[0]).toBe('cow');
    expect(findCow('KANGAROO')?.name).toBe('kangaroo');
    expect(findCow('dragon')).toBeUndefined();
  });

  it.each(COWS.map((cow) => [cow.name, cow] as const))('%s fits in 40 columns, with any face and either bubble', (_name, cow) => {
    for (const face of [DEFAULT_FACE, { eyes: 'xx', tongue: 'U ' }, { eyes: '@', tongue: '' }]) {
      for (const think of [false, true]) {
        const art = drawCow(cow, face, think);
        expect(widest(art)).toBeLessThanOrEqual(40);
        expect(art).not.toMatch(/\$[tLRT]/);
        expect(art.split('\n')[0]?.trim()).toBe(think ? 'o' : '\\');
      }
    }
  });

  it.each(COW_NAMES)('%s says something on a 40-column screen without going past its edge', async (name) => {
    const result = await runLine(`cowsay -f ${name} I am the very model of a modern major general, with information vegetable`, { cols: 40 });
    expect(result.status).toBe(0);
    expect(widest(result.stdoutPlain)).toBeLessThanOrEqual(40);
  });

  it('draws the face it is given: eyes, tongue and the moods', () => {
    const cow = findCow('cow');
    if (cow === undefined) throw new Error('no cow');
    expect(drawCow(cow, { eyes: '^-', tongue: 'U' }, false)).toContain('|  ^    -  |');
    expect(drawCow(cow, { eyes: '^-', tongue: 'U' }, false)).toContain('\\__U __/');
    expect(twoChars('a')).toBe('a ');
    expect(twoChars('\u001b[31mxyz')).toBe('[3');
  });

  it('puts the bubble above the animal', () => {
    const cow = findCow('wombat');
    if (cow === undefined) throw new Error('no wombat');
    const picture = cowsay('hi', { cow, face: DEFAULT_FACE, think: false, wrapAt: 40, wrap: true });
    expect(rows(picture).slice(0, 4)).toEqual([' ____', '< hi >', ' ----', '  \\']);
  });
});

describe('cowsay in the shell', () => {
  it('says its operands, or what is piped in, as art a screen reader hears as words', async () => {
    const result = await runLine('cowsay hello there');
    expect(result.status).toBe(0);
    expect(rows(result.stdoutPlain).slice(0, 3)).toEqual([' _____________', '< hello there >', ' -------------']);
    expect(result.blocks).toEqual([expect.objectContaining({ type: 'art', fit: 'scale', alt: 'Cow says: hello there' })]);

    const piped = await runLine("printf 'from\\na pipe\\n' | cowsay -f kookaburra", { tty: false });
    expect(rows(piped.stdoutPlain).slice(0, 3)).toEqual([' _____________', '< from a pipe >', ' -------------']);
    expect(piped.stdoutPlain).toContain('<=====(  o  ~~~  \\');
  });

  it('says hello in its own way when there is nothing to say', async () => {
    expect((await runLine('cowsay -f kangaroo')).stdoutPlain).toContain("< G'day. >");
    expect((await runLine('cowsay')).stdoutPlain).toContain('< Moo. >');
  });

  it('wraps before column 40 in a pipe, before the edge of a narrower screen, or where -W says', async () => {
    const long = 'word '.repeat(30).trim();
    // The bubble's rows start at the left edge; the animal's are indented.
    const lineWidths = (text: string): number[] => rows(text).filter((row) => /^[/|\\<] /.test(row)).map((row) => row.trimEnd().length - 4);
    expect(Math.max(...lineWidths((await runLine(`cowsay ${long}`, { tty: false })).stdoutPlain))).toBeLessThanOrEqual(39);
    expect(Math.max(...lineWidths((await runLine(`cowsay ${long}`, { cols: 30 })).stdoutPlain))).toBeLessThanOrEqual(26);
    expect(Math.max(...lineWidths((await runLine(`cowsay -W 11 ${long}`, { tty: false })).stdoutPlain))).toBe(9);
    expect((await runLine("cowsay -n 'a\tb'", { tty: false })).stdoutPlain).toContain('< a       b >');
  });

  it('changes the face with -e, -T and the mood flags, the first mood winning', async () => {
    expect((await runLine('cowsay -e ^^ -T U hi', { tty: false })).stdoutPlain).toContain('|  ^    ^  |');
    const dead = (await runLine('cowsay -d -w hi', { tty: false })).stdoutPlain;
    expect(dead).toContain('|  x    x  |');
    expect(dead).toContain('\\__U __/');
    expect((await runLine('cowsay -e ab -y hi', { tty: false })).stdoutPlain).toContain('|  .    .  |');
  });

  it('lists the animals with -l, and picks one at random with -r', async () => {
    expect(await runLine('cowsay -l', { tty: false })).toMatchObject({ status: 0, stdoutPlain: COW_NAMES.join(' ') });
    // The harness's random is 0.5.
    const fourth = COWS[3];
    if (fourth === undefined) throw new Error('no fourth animal');
    expect((await runLine('cowsay -r hi', { tty: false })).stdoutPlain).toContain(drawCow(fourth, DEFAULT_FACE, false));
  });

  it("says when there is no such animal, and how to list them", async () => {
    const result = await runLine('cowsay -f dragon hi');
    expect(result.status).toBe(1);
    expect(result.stderrPlain).toBe("cowsay: no animal called 'dragon'\n'cowsay -l' lists them.");
    expect((await runLine('cowsay -f dragon hi', { tty: false })).stderrPlain).toBe("cowsay: no animal called 'dragon'");
  });

  it('refuses a width under 2 and a width that is not a number', async () => {
    expect(await runLine('cowsay -W 1 hi', { tty: false })).toMatchObject({ status: 1, stderrPlain: "cowsay: invalid width '1'\nTry 'cowsay --help' for more information." });
    expect((await runLine('cowsay -W wide hi', { tty: false })).status).toBe(1);
  });
});

describe('cowthink', () => {
  it('thinks in a thought bubble, with little circles up to it', async () => {
    const result = await runLine('cowthink -f wombat dig', { tty: false });
    expect(result.status).toBe(0);
    expect(rows(result.stdoutPlain).slice(0, 5)).toEqual([' _____', '( dig )', ' -----', '  o', '   o   _      _']);
    expect((await runLine('cowthink hmm')).blocks[0]).toMatchObject({ alt: 'Cow thinks: hmm' });
  });

  it('offers a chip per animal after -l', async () => {
    const { default: spec } = await import('./cowthink');
    expect(spec.next?.({ status: 0, argv: ['cowthink', '-l'] })).toContain('cowthink -f crocodile hello');
    expect(spec.next?.({ status: 0, argv: ['cowthink', 'hi'] })).toEqual([]);
  });
});
