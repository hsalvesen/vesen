// lolcat: the rainbow on a terminal, diagonal bands, and the text untouched in a pipe.
import { describe, expect, it } from 'vitest';
import { runLine, session } from '../../../../tests/harness';
import themes from '../../../../themes.json';
import { contrastRatio } from '../../../lib/colour';
import { deriveRoles, TEXT_MIN } from '../../../lib/roles';
import { lineText, type Block, type Line } from '../../../output/model';
import { colourAt, rainbowLine, RAINBOW, type RainbowOptions } from '../../lib/rainbow';

const OPTIONS: RainbowOptions = { spread: 3, freq: 0.3, seed: 0 };

function lines(blocks: readonly Block[]): Line[] {
  return blocks.flatMap((block) => (block.type === 'lines' ? [...block.lines] : []));
}

describe('the rainbow', () => {
  it('colours every character from the palette, keeping the text', () => {
    const line = rainbowLine('hello, rainbow world', 0, OPTIONS);
    expect(lineText(line)).toBe('hello, rainbow world');
    for (const span of line) expect(RAINBOW).toContain(span.style?.fg);
    // Neighbouring spans differ: runs of one colour share a span.
    for (let i = 1; i < line.length; i += 1) expect(line[i]?.style?.fg).not.toBe(line[i - 1]?.style?.fg);
  });

  // The raw palette slots fall as low as 1.7:1 in some themes (kookaburra's blue, treefrog's red),
  // so whole bands of text vanished: the rainbow's colours are roles, lifted to read like text.
  it('paints only in colours that read clearly in every theme', () => {
    for (const theme of themes) {
      const roles = deriveRoles(theme);
      for (const role of RAINBOW) expect(contrastRatio(roles[role], theme.background), `${theme.name} ${role}`).toBeGreaterThanOrEqual(TEXT_MIN);
      // Still a rainbow, though a theme may give two hues one colour (cassowary's green and cyan).
      expect(new Set(RAINBOW.map((role) => roles[role])).size, theme.name).toBeGreaterThanOrEqual(5);
    }
  });

  it('steps along the line, and a line further on starts where SPREAD characters along would', () => {
    for (let row = 0; row < 5; row += 1) {
      for (let column = 0; column < 40; column += 1) {
        expect(colourAt(row + 1, column, OPTIONS)).toBe(colourAt(row, column + OPTIONS.spread, OPTIONS));
      }
    }
    const colours = new Set(Array.from({ length: 80 }, (_, column) => colourAt(0, column, OPTIONS)));
    expect(colours.size).toBe(RAINBOW.length);
  });

  it('changes colour faster with a higher frequency, and in narrower bands with a smaller spread', () => {
    const changes = (options: RainbowOptions): number => rainbowLine('x'.repeat(60), 0, options).length;
    expect(changes({ ...OPTIONS, freq: 0.6 })).toBeGreaterThan(changes(OPTIONS));
    expect(changes({ ...OPTIONS, spread: 1 })).toBeGreaterThan(changes(OPTIONS));
  });
});

describe('lolcat in the shell', () => {
  it('colours what is piped into it on a terminal, line by line', async () => {
    const result = await runLine("printf 'one\\ntwo\\n\\nthree\\n' | lolcat -S 0");
    expect(result.status).toBe(0);
    const drawn = lines(result.blocks);
    expect(drawn.map(lineText)).toEqual(['one', 'two', '', 'three']);
    expect(drawn[0]).toEqual(rainbowLine('one', 0, OPTIONS));
    expect(drawn[3]).toEqual(rainbowLine('three', 3, OPTIONS));
  });

  it('passes the text on unchanged into a pipe, colours and all', async () => {
    expect(await runLine("printf 'plain\\ttext\\n' | lolcat", { tty: false })).toMatchObject({ status: 0, stdoutPlain: 'plain\ttext' });
    const s = await session({ tty: false });
    await s.run("printf 'a\\nb' > f.txt");
    expect((await s.run('lolcat f.txt | cat')).stdoutPlain).toBe('a\nb');
    s.stop();
    const piped = await runLine('echo hi | lolcat | cat');
    expect(piped.stdoutPlain).toBe('hi');
    expect(piped.blocks.every((block) => block.type !== 'lines' || block.lines.every((line) => line.every((span) => span.style === undefined)))).toBe(true);
  });

  it('drops colours already in the text, and expands tabs', async () => {
    const result = await runLine("printf '\\033[31mred\\033[0m\\tx\\n' | lolcat");
    expect(lines(result.blocks).map(lineText)).toEqual(['red     x']);
  });

  it('colours a FILE, says which it cannot read, and goes on', async () => {
    const result = await runLine('lolcat nope .bashrc');
    expect(result.status).toBe(1);
    expect(result.stderrPlain).toBe('lolcat: nope: No such file or directory');
    expect(lines(result.blocks).length).toBeGreaterThan(3);
  });

  it('says what it is for when nothing is piped in', async () => {
    expect(await runLine('lolcat')).toMatchObject({ status: 0, stderrPlain: 'lolcat colours what is piped into it: try fortune | lolcat' });
  });

  it('refuses a spread or frequency that is not a number', async () => {
    expect(await runLine('echo x | lolcat -p 0')).toMatchObject({ status: 1, stderrPlain: "lolcat: invalid spread '0'\nTry 'lolcat --help' for more information." });
    expect((await runLine('echo x | lolcat -F fast')).status).toBe(1);
    expect((await runLine('echo x | lolcat -p 1.5 -F 0.05')).status).toBe(0);
  });
});
