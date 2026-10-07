import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { EditState } from '../complete/types';
import {
  EMPTY_RING,
  KILL_RING_MAX,
  applyOp,
  lastArgument,
  replaceRange,
  settleRing,
  unixWordStartBefore,
  wordEndAfter,
  wordStartBefore,
  yankLastArg,
  type EditOp,
  type KillRing,
} from './readline';

/** A line with the cursor at the `|`. */
function at(marked: string): EditState {
  const cursor = marked.indexOf('|');
  return { text: marked.replace('|', ''), cursor };
}

/** The line with a `|` at the cursor. */
function show(state: EditState): string {
  return `${state.text.slice(0, state.cursor)}|${state.text.slice(state.cursor)}`;
}

function run(marked: string, ...ops: EditOp[]): { line: string; ring: KillRing } {
  let state = at(marked);
  let ring = EMPTY_RING;
  for (const op of ops) ({ state, ring } = applyOp(state, op, ring));
  return { line: show(state), ring };
}

describe('moving', () => {
  it.each<[string, EditOp, string]>([
    ['cd /home|', 'bol', '|cd /home'],
    ['|cd /home', 'eol', 'cd /home|'],
    ['ab|c', 'charLeft', 'a|bc'],
    ['|abc', 'charLeft', '|abc'],
    ['ab|c', 'charRight', 'abc|'],
    ['abc|', 'charRight', 'abc|'],
    ['cd /home/guest/docs|', 'wordLeft', 'cd /home/guest/|docs'],
    ['cd /home/guest/|docs', 'wordLeft', 'cd /home/|guest/docs'],
    ['|cd /home/guest/docs', 'wordRight', 'cd| /home/guest/docs'],
    ['cd| /home/guest/docs', 'wordRight', 'cd /home|/guest/docs'],
    ['a😀|b', 'charLeft', 'a|😀b'],
    ['a|😀b', 'charRight', 'a😀|b'],
  ])('%s %s -> %s', (marked, op, expected) => {
    expect(run(marked, op).line).toBe(expected);
  });

  it('finds readline and unix word boundaries', () => {
    const text = 'cd /home/guest/docs';
    expect(wordStartBefore(text, text.length)).toBe(15);
    expect(unixWordStartBefore(text, text.length)).toBe(3);
    expect(wordEndAfter(text, 0)).toBe(2);
    expect(unixWordStartBefore('ls   ', 5)).toBe(0);
  });
});

describe('killing and yanking', () => {
  it('Ctrl+W kills back to a space; Alt+Backspace back to a word boundary', () => {
    expect(run('cd /home/guest/docs|', 'killWordBackUnix').line).toBe('cd |');
    expect(run('cd /home/guest/docs|', 'killWordBackAlnum').line).toBe('cd /home/guest/|');
    expect(run('cd /home/guest/docs|', 'killWordBackUnix').ring.entries).toEqual(['/home/guest/docs']);
    expect(run('cd /home/guest/docs|', 'killWordBackAlnum').ring.entries).toEqual(['docs']);
  });

  it('kills to the start, to the end and the next word', () => {
    expect(run('echo he|llo', 'killToStart')).toMatchObject({ line: '|llo', ring: { entries: ['echo he'] } });
    expect(run('echo he|llo', 'killToEnd')).toMatchObject({ line: 'echo he|', ring: { entries: ['llo'] } });
    expect(run('echo| hello world', 'killWordFwd')).toMatchObject({ line: 'echo| world', ring: { entries: [' hello'] } });
  });

  it('joins kills in a row into one entry, then yanks it back', () => {
    const backwards = run('one two three|', 'killWordBackAlnum', 'killWordBackAlnum');
    expect(backwards.ring.entries).toEqual(['two three']);
    expect(run('one two three|', 'killWordBackAlnum', 'killWordBackAlnum', 'yank').line).toBe('one two three|');

    const forwards = run('|one two three', 'killWordFwd', 'killWordFwd');
    expect(forwards.ring.entries).toEqual(['one two']);
  });

  it('starts a new entry after anything that is not a kill', () => {
    const { ring } = run('one two three|', 'killWordBackAlnum', 'charLeft', 'killWordBackAlnum');
    expect(ring.entries).toEqual(['two', 'three']);
  });

  it('starts a new entry when the cursor moved between kills, as a click or an arrow key moves it', () => {
    // Ctrl+W, then the caret moved left by the browser (no op the ring sees), then Ctrl+K.
    let { state, ring } = applyOp(at('one two three|'), 'killWordBackUnix', EMPTY_RING);
    expect(show(state)).toBe('one two |');
    state = { ...state, cursor: 2 };
    ({ state, ring } = applyOp(state, 'killToEnd', ring));
    expect(ring.entries).toEqual(['e two ', 'three']);
    ({ state, ring } = applyOp(state, 'yank', ring));
    expect(show(state)).toBe('one two |');
  });

  it('joins kills in a row that start where the last one left the cursor', () => {
    const { ring } = run('one two| three', 'killWordBackUnix', 'killToEnd', 'killToStart');
    expect(ring.entries).toEqual(['one two three']);
  });

  it('a typed edit settles the ring, so the next kill is new', () => {
    let { state, ring } = applyOp(at('alpha beta|'), 'killWordBackAlnum', EMPTY_RING);
    ring = settleRing(ring);
    state = { text: `${state.text}x`, cursor: state.cursor + 1 };
    ({ ring } = applyOp(state, 'killToStart', ring));
    expect(ring.entries).toEqual(['alpha x', 'beta']);
  });

  it('Alt+Y after Ctrl+Y swaps in older kills, round the ring', () => {
    let state = at('a b c|');
    let ring = EMPTY_RING;
    for (let i = 0; i < 3; i += 1) {
      ({ state, ring } = applyOp(state, 'killWordBackAlnum', ring));
      ring = settleRing(ring);
    }
    expect(ring.entries).toEqual(['a ', 'b ', 'c']);
    ({ state, ring } = applyOp(state, 'yank', ring));
    expect(show(state)).toBe('a |');
    ({ state, ring } = applyOp(state, 'yankPop', ring));
    expect(show(state)).toBe('b |');
    ({ state, ring } = applyOp(state, 'yankPop', ring));
    expect(show(state)).toBe('c|');
    ({ state, ring } = applyOp(state, 'yankPop', ring));
    expect(show(state)).toBe('a |');
  });

  it('Alt+Y does nothing unless it follows a yank', () => {
    const ring: KillRing = { entries: ['x', 'y'], lastKill: null, yank: null };
    expect(applyOp(at('ab|'), 'yankPop', ring).state).toEqual(at('ab|'));
  });

  it('yanks nothing from an empty ring', () => {
    expect(run('ab|', 'yank').line).toBe('ab|');
  });

  it(`keeps at most ${KILL_RING_MAX} kills`, () => {
    let state = at(`${'w '.repeat(15)}|`);
    let ring = EMPTY_RING;
    for (let i = 0; i < 15; i += 1) {
      ({ state, ring } = applyOp(state, 'killWordBackAlnum', ring));
      ring = settleRing(ring);
    }
    expect(ring.entries).toHaveLength(KILL_RING_MAX);
  });
});

describe('deleting and transposing', () => {
  it.each<[string, EditOp, string]>([
    ['ab|cd', 'deleteChar', 'ab|d'],
    ['abcd|', 'deleteChar', 'abcd|'],
    ['ab|cd', 'transpose', 'acb|d'],
    ['abcd|', 'transpose', 'abdc|'],
    ['|abcd', 'transpose', '|abcd'],
    ['a|', 'transpose', 'a|'],
    ['a|😀', 'transpose', '😀a|'],
  ])('%s %s -> %s', (marked, op, expected) => {
    expect(run(marked, op).line).toBe(expected);
  });
});

describe('Alt+.', () => {
  it('inserts the last argument of the newest line, then older ones', () => {
    const history = ['cat notes.txt', 'mkdir "my files"', 'ls'];
    const first = yankLastArg(at('cd |'), history);
    expect(first && show(first.state)).toBe('cd ls|');
    const second = first && yankLastArg(first.state, history, first.inserted);
    expect(second && show(second.state)).toBe('cd "my files"|');
    const third = second && yankLastArg(second.state, history, second.inserted);
    expect(third && show(third.state)).toBe('cd notes.txt|');
    expect(third && yankLastArg(third.state, history, third.inserted)).toBeNull();
  });

  it('starts again from the newest after the cursor moved', () => {
    const history = ['echo a', 'echo b'];
    const first = yankLastArg(at('x |'), history);
    const moved = first && { ...first.state, cursor: 0 };
    expect(moved && first && show(yankLastArg(moved, history, first.inserted)?.state ?? moved)).toBe('b|x b');
  });

  it('finds the last word, quotes and escapes kept', () => {
    expect(lastArgument('cat my\\ file')).toBe('my\\ file');
    expect(lastArgument("echo 'a b'")).toBe("'a b'");
    expect(lastArgument('   ')).toBeNull();
  });

  it('skips a word that spans a line break, which the one-line prompt cannot hold', () => {
    expect(lastArgument('echo "a\nb"')).toBeNull();
    const inserted = yankLastArg(at('cat |'), ['echo older', 'echo "a\nb"']);
    expect(inserted && show(inserted.state)).toBe('cat older|');
  });
});

describe('properties', () => {
  const ops: EditOp[] = [
    'bol', 'eol', 'charLeft', 'charRight', 'wordLeft', 'wordRight', 'killToStart', 'killToEnd',
    'killWordBackUnix', 'killWordBackAlnum', 'killWordFwd', 'yank', 'yankPop', 'deleteChar', 'transpose',
  ];

  it('never throws, and always leaves the cursor on the line', () => {
    fc.assert(
      fc.property(fc.string(), fc.nat(), fc.array(fc.constantFrom(...ops), { maxLength: 12 }), (text, pos, sequence) => {
        let state: EditState = { text, cursor: pos % (text.length + 1) };
        let ring = EMPTY_RING;
        for (const op of sequence) {
          ({ state, ring } = applyOp(state, op, ring));
          expect(state.cursor).toBeGreaterThanOrEqual(0);
          expect(state.cursor).toBeLessThanOrEqual(state.text.length);
        }
      }),
    );
  });

  it('a kill then a yank puts the line back', () => {
    fc.assert(
      fc.property(fc.string(), fc.nat(), fc.constantFrom<EditOp>('killToStart', 'killToEnd', 'killWordBackUnix', 'killWordBackAlnum'), (text, pos, op) => {
        const start: EditState = { text, cursor: pos % (text.length + 1) };
        const killed = applyOp(start, op, EMPTY_RING);
        if (killed.ring.entries.length === 0) return;
        const back = applyOp(killed.state, 'yank', killed.ring);
        expect(back.state.text).toBe(text);
      }),
    );
  });

  it('replaceRange puts the cursor after what it inserted', () => {
    expect(replaceRange({ text: 'abcdef', cursor: 0 }, 2, 4, 'XY')).toEqual({ text: 'abXYef', cursor: 4 });
  });
});
