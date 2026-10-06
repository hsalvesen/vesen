import { describe, expect, it } from 'vitest';
import { commandHelp } from '../shell/help';
import { defineCommand } from '../shell/types';
import { out } from '../output/model';
import { hangingIndent } from './hang';

describe('hangingIndent', () => {
  it('hangs a label row by its label, and leaves other rows alone', () => {
    expect(hangingIndent([out.span('  -a, --all  '), out.span('do not ignore entries starting with .')])).toBe(13);
    expect(hangingIndent([out.span('  ls   '), out.span('list the modes')])).toBe(7);
    expect(hangingIndent([out.span('  '), out.run('ls -a', 'ls -a'), out.span('  note')])).toBe(0);
    expect(hangingIndent([out.span('Usage: ls')])).toBe(0);
    expect(hangingIndent([out.span('  alone  ')])).toBe(0);
    expect(hangingIndent([])).toBe(0);
  });

  it('lines up the Commands rows of a --help panel, each hanging by the same label width', () => {
    const spec = defineCommand({
      name: 'cathode',
      category: 'portfolio',
      summary: 'x',
      subcommands: {
        ls: { summary: 'list the modes' },
        set: { summary: 'turn on a mode' },
        quality: { summary: 'choose how much to draw: auto, full, lite or off' },
      },
      run: () => 0,
    });
    const usage = commandHelp(spec).find((block) => block.type === 'panel' && block.title === 'Usage:');
    const rows = usage?.type === 'panel' ? usage.body.slice(-3) : [];
    expect(rows.map((row) => row[0]?.text)).toEqual(['  ls       ', '  set      ', '  quality  ']);
    expect(rows.map(hangingIndent)).toEqual([11, 11, 11]);
  });
});
