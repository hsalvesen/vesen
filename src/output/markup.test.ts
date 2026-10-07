import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import historyMarkup from '../content/history.vt?raw';
import linuxMarkup from '../content/linux.vt?raw';
import readmeMarkup from '../content/README.vt?raw';
import { escapeMarkup, parseMarkup } from './markup';
import { colourVar, isTrustedAction, type Line } from './model';

describe('parseMarkup', () => {
  it('splits text from styles', () => {
    const { text, lines } = parseMarkup('Type {cyan}help{/} now\n{brightBlue,bold}Title{/}\n');
    expect(text).toBe('Type help now\nTitle\n');
    expect(lines).toEqual([
      [{ text: 'Type ' }, { text: 'help', style: { fg: 'cyan' } }, { text: ' now' }],
      [{ text: 'Title', style: { fg: 'brightBlue', bold: true } }],
    ]);
  });

  it('keeps empty lines, and a final newline ends the last line', () => {
    expect(parseMarkup('\na\n\n').lines).toEqual([[], [{ text: 'a' }], []]);
    expect(parseMarkup('a').lines).toEqual([[{ text: 'a' }]]);
    expect(parseMarkup('')).toEqual({ text: '', lines: [] });
  });

  it('nests tags, and {/} closes the innermost', () => {
    expect(parseMarkup('{red}a{bold}b{/}c{/}d').lines).toEqual([
      [{ text: 'a', style: { fg: 'red' } }, { text: 'b', style: { fg: 'red', bold: true } }, { text: 'c', style: { fg: 'red' } }, { text: 'd' }],
    ]);
  });

  it('accepts roles, and a tag spanning lines styles both', () => {
    expect(parseMarkup('{accent}one\ntwo{/}').lines).toEqual([[{ text: 'one', style: { fg: 'accent' } }], [{ text: 'two', style: { fg: 'accent' } }]]);
  });

  it('treats {{ and anything that is not a tag as text', () => {
    expect(parseMarkup('{{red}x').text).toBe('{red}x');
    expect(parseMarkup('${HOME} {not a tag} {red,blue}x {} {').text).toBe('${HOME} {not a tag} {red,blue}x {} {');
    expect(parseMarkup(escapeMarkup('a {b} {{c}}')).text).toBe('a {b} {{c}}');
  });

  it('never makes an action or a link, whatever the text says', () => {
    const { lines } = parseMarkup('{red}<a href="javascript:alert(1)">x</a>{/} \x1b]8;;https://evil\x07y');
    for (const span of lines.flat()) {
      expect(span.action).toBeUndefined();
      expect(span.href).toBeUndefined();
      expect(isTrustedAction(span.action)).toBe(false);
    }
  });
});

// The owner's documents, converted once from the HTML the legacy page served (public/README.md,
// history.txt and linux.txt, in git history before the legacy clean-up). The colour of every run
// as that page drew them was recorded from the originals, so cat must draw the same runs.

type Run = [colour: string | null, bold: boolean, text: string];

const LEGACY: Record<string, Run[]> = JSON.parse(
  readFileSync(join(__dirname, '../../tests/fixtures/content/legacy-colours.json'), 'utf8'),
) as Record<string, Run[]>;

/** Each line as runs of one colour and weight; a newline has no colour of its own. */
function byLine(runsOrLines: { colour: string | null; bold: boolean; text: string }[]): Run[][] {
  const lines: Run[][] = [[]];
  for (const { colour, bold, text } of runsOrLines) {
    text.split('\n').forEach((part, index) => {
      if (index > 0) lines.push([]);
      if (part === '') return;
      const line = lines[lines.length - 1] as Run[];
      const last = line[line.length - 1];
      if (last !== undefined && last[0] === colour && last[1] === bold) last[2] += part;
      else line.push([colour, bold, part]);
    });
  }
  return lines;
}

/** The runs a document's styled lines draw. */
function drawn(lines: readonly Line[]): Run[][] {
  return byLine(
    lines.flatMap((line, index) => [
      ...line.map((span) => ({ colour: span.style?.fg === undefined ? null : colourVar(span.style.fg), bold: span.style?.bold ?? false, text: span.text })),
      ...(index < lines.length - 1 ? [{ colour: null, bold: false, text: '\n' }] : []),
    ]),
  );
}

describe.each([
  ['src/content/README.vt', readmeMarkup],
  ['src/content/history.vt', historyMarkup],
  ['src/content/linux.vt', linuxMarkup],
])('%s', (file, markup) => {
  const legacy = LEGACY[file] ?? [];
  const { text, lines } = parseMarkup(markup);

  it('reads as the same text, with no markup left in it', () => {
    expect(text).toBe(legacy.map(([, , runText]) => runText).join(''));
    expect(text).not.toMatch(/<\/?span|\{\/\}/);
  });

  it('draws every line in the colours and weights the legacy page did', () => {
    const expected = byLine(legacy.map(([colour, bold, runText]) => ({ colour, bold, text: runText })));
    // The final newline ends the last line rather than starting an empty one.
    if (text.endsWith('\n')) expected.pop();
    expect(drawn(lines)).toEqual(expected);
  });
});
