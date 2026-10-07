import { describe, expect, it } from 'vitest';
import { commandHelp } from '../shell/help';
import { defineCommand } from '../shell/types';
import { out } from '../output/model';
import { hangingIndent, MAX_HANG } from './hang';

describe('hangingIndent', () => {
  it('hangs a label row by its label, and leaves other rows alone', () => {
    expect(hangingIndent([out.span('  -a, --all  '), out.span('do not ignore entries starting with .')])).toBe(13);
    expect(hangingIndent([out.span('  ls   '), out.span('list the modes')])).toBe(7);
    expect(hangingIndent([out.span('  '), out.run('ls -a', 'ls -a'), out.span('  note')])).toBe(0);
    expect(hangingIndent([out.span('Usage: ls')])).toBe(0);
    expect(hangingIndent([out.span('  alone  ')])).toBe(0);
    expect(hangingIndent([])).toBe(0);
  });

  it('hangs a list row by its marker, name and padding: the description wraps under itself', () => {
    const row = [out.span('› '), out.run('scanlines', 'cathode set scanlines'), out.span('  '), out.span('Subtle horizontal scanlines')];
    expect(hangingIndent(row)).toBe(13);
    expect(hangingIndent([out.span('  '), out.span('off'), out.span('        '), out.span('No effect.')])).toBe(13);
    // Padding at the end, or only padding before it, is no label.
    expect(hangingIndent([out.span('name'), out.span('   ')])).toBe(0);
    expect(hangingIndent([out.span('   '), out.span('  '), out.span('text')])).toBe(0);
    // A label too wide to leave the description room does not hang.
    expect(hangingIndent([out.span('x'.repeat(MAX_HANG)), out.span('  '), out.span('text')])).toBe(0);
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
