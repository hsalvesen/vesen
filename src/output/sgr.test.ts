import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { lineText, type Line } from './model';
import { SgrParser, parseSgr, stripSgr, type SgrEvent } from './sgr';

const ESC = '\u001b';

function lines(events: readonly SgrEvent[]): Line[] {
  return events.flatMap((event) => (event.kind === 'line' ? [event.line] : []));
}

/** Feeds `chunks` one by one and returns every line, the unterminated last one included. */
function feedAll(chunks: readonly string[]): { lines: Line[]; clears: number } {
  const parser = new SgrParser();
  const events = [...chunks.flatMap((chunk) => parser.feed(chunk)), ...parser.end()];
  let out: Line[] = [];
  let clears = 0;
  for (const event of events) {
    if (event.kind === 'clear') {
      out = [];
      clears += 1;
    } else {
      out.push(event.line);
    }
  }
  return { lines: out, clears };
}

describe('the SGR subset', () => {
  it('keeps plain text as plain spans, one line per newline', () => {
    expect(parseSgr('a\nb\n').lines).toEqual([[{ text: 'a' }], [{ text: 'b' }]]);
    expect(parseSgr('a\n\nb').lines).toEqual([[{ text: 'a' }], [], [{ text: 'b' }]]);
  });

  it('maps 30-37 and 90-97 onto the 16 palette names, and 39 back to the default', () => {
    const { lines: [line = []] } = parseSgr(`${ESC}[31mred${ESC}[39m plain ${ESC}[94mbright${ESC}[0m`);
    expect(line).toEqual([
      { text: 'red', style: { fg: 'red' } },
      { text: ' plain ' },
      { text: 'bright', style: { fg: 'brightBlue' } },
    ]);
  });

  it('maps 40-47 and 100-107 onto backgrounds, and 49 back', () => {
    const { lines: [line = []] } = parseSgr(`${ESC}[42;30mok${ESC}[49m${ESC}[105mx`);
    expect(line).toEqual([
      { text: 'ok', style: { fg: 'black', bg: 'green' } },
      { text: 'x', style: { fg: 'black', bg: 'brightPurple' } },
    ]);
  });

  it('sets bold, dim, italic, underline, inverse and strike, and 22-29 turn them off', () => {
    const { lines: [line = []] } = parseSgr(`${ESC}[1;2;3;4;7;9mall${ESC}[22;23mmost${ESC}[24;27;29mnone`);
    expect(line).toEqual([
      { text: 'all', style: { bold: true, dim: true, italic: true, underline: true, inverse: true, strike: true } },
      { text: 'most', style: { underline: true, inverse: true, strike: true } },
      { text: 'none' },
    ]);
  });

  it('resets with 0 and with an empty parameter list', () => {
    expect(parseSgr(`${ESC}[1mb${ESC}[mx`).lines[0]).toEqual([{ text: 'b', style: { bold: true } }, { text: 'x' }]);
    expect(parseSgr(`${ESC}[1;0mx`).lines[0]).toEqual([{ text: 'x' }]);
  });

  it('drops 256-colour and true-colour colours without misreading their arguments', () => {
    expect(parseSgr(`${ESC}[38;5;196;1mx`).lines[0]).toEqual([{ text: 'x', style: { bold: true } }]);
    expect(parseSgr(`${ESC}[48;2;1;2;3;4mx`).lines[0]).toEqual([{ text: 'x', style: { underline: true } }]);
    expect(parseSgr(`${ESC}[38:5:9mx`).lines[0]).toEqual([{ text: 'x' }]);
  });

  it('drops cursor movement, other escapes and control characters, keeping tabs', () => {
    expect(parseSgr(`a${ESC}[2Kb${ESC}[10;3Hc${ESC}(Bd\u0007e\u0008f\tg\r`).lines[0]).toEqual([{ text: 'abcdef\tg' }]);
    expect(parseSgr(`${ESC}]0;window title\u0007x`).lines[0]).toEqual([{ text: 'x' }]);
    expect(parseSgr(`${ESC}Pdevice control${ESC}\\x`).lines[0]).toEqual([{ text: 'x' }]);
  });

  it('clears the screen on ESC[2J, ESC[3J and ESC c, dropping what came before', () => {
    expect(parseSgr(`gone\nalso${ESC}[2Jkept\n`)).toEqual({ lines: [[{ text: 'kept' }]], cleared: true });
    expect(parseSgr(`x${ESC}cy`)).toEqual({ lines: [[{ text: 'y' }]], cleared: true });
    expect(parseSgr(`x${ESC}[3Jy`).cleared).toBe(true);
    expect(parseSgr(`x${ESC}[1Jy`)).toEqual({ lines: [[{ text: 'xy' }]], cleared: false });
  });
});

describe('OSC 8 links', () => {
  it('link http, https and mailto text', () => {
    const { lines: [line = []] } = parseSgr(`${ESC}]8;;https://www.vesen.app/${ESC}\\site${ESC}]8;;${ESC}\\ and ${ESC}]8;id=1;mailto:has@salvesen.app\u0007mail${ESC}]8;;\u0007`);
    expect(line).toEqual([
      { text: 'site', href: 'https://www.vesen.app/' },
      { text: ' and ' },
      { text: 'mail', href: 'mailto:has@salvesen.app' },
    ]);
  });

  it('leave any other scheme as plain text', () => {
    for (const uri of ['javascript:alert(1)', 'data:text/html,x', 'JaVaScRiPt:alert(1)', 'vbscript:x', '/relative', 'java\tscript:x']) {
      const { lines: [line = []] } = parseSgr(`${ESC}]8;;${uri}${ESC}\\click${ESC}]8;;${ESC}\\`);
      expect(line, uri).toEqual([{ text: 'click' }]);
    }
  });
});

describe('streaming', () => {
  const sample = `${ESC}[1;31mbold red${ESC}[0m\nplain ${ESC}]8;;https://example.com/${ESC}\\link${ESC}]8;;${ESC}\\ end\n${ESC}[42mtail`;

  it('reads an escape split across chunks exactly as one written whole', () => {
    const whole = feedAll([sample]);
    for (let cut = 0; cut <= sample.length; cut += 1) {
      expect(feedAll([sample.slice(0, cut), sample.slice(cut)]), `cut at ${cut}`).toEqual(whole);
    }
    expect(feedAll([...sample])).toEqual(whole);
  });

  it('returns lines as their newlines arrive, and the unfinished line on end()', () => {
    const parser = new SgrParser();
    expect(lines(parser.feed('a\nb'))).toEqual([[{ text: 'a' }]]);
    expect(parser.partial()).toEqual([{ text: 'b' }]);
    expect(lines(parser.feed(`${ESC}[3`))).toEqual([]);
    expect(lines(parser.feed('1mc\n'))).toEqual([[{ text: 'b' }, { text: 'c', style: { fg: 'red' } }]]);
    expect(parser.end()).toEqual([]);
  });

  it('drops a sequence that never ends, rather than holding text back for ever', () => {
    const parser = new SgrParser();
    const events = [...parser.feed(`${ESC}]8;;https://example.com/${'x'.repeat(5000)}\nafter\n`), ...parser.end()];
    expect(lines(events).map(lineText)).toContain('after');
  });
});

describe('stripSgr', () => {
  it('leaves the text and drops every escape and control', () => {
    expect(stripSgr(`${ESC}[1;31mred${ESC}[0m ${ESC}]8;;https://x.example/${ESC}\\l${ESC}]8;;${ESC}\\ \u0007ok\tdone\n`)).toBe('red l ok\tdone\n');
  });
});

describe('no tap action ever comes from parsed text', () => {
  const alphabet = [ESC, '[', ']', '8', ';', ':', 'm', 'J', 'c', '\u0007', '\\', '\n', 'a', 'run', '2', '3', '1', '9', '4', 'https://ok.example/', 'javascript:x', 'mailto:a@b.c', '"', '{', '}'];
  const text = fc.array(fc.constantFrom(...alphabet), { maxLength: 60 }).map((parts) => parts.join(''));

  it('makes spans with only text, a style and a checked link', () => {
    fc.assert(
      fc.property(fc.array(text, { minLength: 1, maxLength: 4 }), (chunks) => {
        const parser = new SgrParser();
        const events = [...chunks.flatMap((chunk) => parser.feed(chunk)), ...parser.end()];
        for (const line of lines(events)) {
          for (const span of line) {
            expect(Object.keys(span).every((key) => key === 'text' || key === 'style' || key === 'href')).toBe(true);
            if (span.href !== undefined) expect(span.href).toMatch(/^(https:\/\/ok\.example\/|mailto:)/);
          }
        }
      }),
      { numRuns: 2000 },
    );
  });
});
