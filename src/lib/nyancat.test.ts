// nyancat's frames (K. Lange's nyancat, src/animation.c): twelve of 64 by 64 cells, each a character
// with an ink; drawn two ASCII characters a cell in runs of one colour, stepping twelve frames to
// two beats of the track from its first beat; and the still printed outside the terminal.
import { describe, expect, it } from 'vitest';
import { NYAN_BEAT_S, NYAN_COLS, NYAN_FPS, NYAN_FRAMES, NYAN_INKS, NYAN_ROWS, frameRuns, nyanFrameAt, stillNyan } from './nyancat';

describe("nyancat's frames", () => {
  it('are twelve of 64 rows by 64 cells, every cell a character with an ink', () => {
    expect(NYAN_FRAMES).toHaveLength(12);
    for (const frame of NYAN_FRAMES) {
      expect(frame).toHaveLength(NYAN_ROWS);
      for (const row of frame) {
        expect(row).toHaveLength(NYAN_COLS);
        for (const cell of row) expect(NYAN_INKS[cell], cell).toBeDefined();
      }
    }
  });

  it('draw each cell as two ASCII characters, in ASCII alone', () => {
    for (const ink of Object.values(NYAN_INKS)) {
      expect(ink.text).toHaveLength(2);
      expect(ink.text).toMatch(/^[\x20-\x7e]{2}$/);
      expect(ink.still).toMatch(/^[\x20-\x7e]$/);
      expect(ink.colour).toMatch(/^#[0-9a-f]{6}$/);
    }
    // The sky and the cat, as nyancat's text mode draws them.
    expect(NYAN_INKS[',']?.text).toBe('::');
    expect(NYAN_INKS['*']?.text).toBe(';;');
    expect(NYAN_INKS['.']?.text).toBe('@@');
  });

  it('are the cat with its rainbow, the same cat in every frame', () => {
    for (const frame of NYAN_FRAMES) {
      const text = frame.join('\n');
      for (const part of ['*', '>', '&', '+', '#', '=', ';', '@', '$', '%']) expect(text, part).toContain(part);
    }
  });
});

describe('frameRuns', () => {
  it('joins a row into runs of one colour, two characters a cell, so a frame is a span a run', () => {
    const [frame] = NYAN_FRAMES;
    const rows = frameRuns(frame ?? []);
    expect(rows).toHaveLength(NYAN_ROWS);
    for (const [r, row] of rows.entries()) {
      expect(row.map((run) => run.text).join(''), `row ${r}`).toHaveLength(NYAN_COLS * 2);
      for (const [i, run] of row.entries()) if (i > 0) expect(run.colour, `row ${r}`).not.toBe(row[i - 1]?.colour);
    }
    // A row of sky alone is one run.
    expect(frameRuns([',,,,'])).toEqual([[{ text: '::::::::', colour: NYAN_INKS[',']?.colour }]]);
    expect(frameRuns([",.'"])[0]?.map((run) => run.text)).toEqual(['::', '@@', '  ']);
  });
});

describe('nyanFrameAt', () => {
  it('starts on the first beat and steps twelve frames to two beats of 140 a minute, round and round', () => {
    expect(NYAN_FPS).toBe(14);
    expect((12 / NYAN_FPS) * (140 / 60)).toBeCloseTo(2);
    expect(nyanFrameAt(0)).toBe(0);
    expect(nyanFrameAt(NYAN_BEAT_S)).toBe(0);
    expect(nyanFrameAt(NYAN_BEAT_S + 1.5 / NYAN_FPS)).toBe(1);
    expect(nyanFrameAt(NYAN_BEAT_S + 11.5 / NYAN_FPS)).toBe(11);
    expect(nyanFrameAt(NYAN_BEAT_S + 12.5 / NYAN_FPS)).toBe(0);
    expect(nyanFrameAt(NYAN_BEAT_S + 600 + 3.5 / NYAN_FPS)).toBe(3);
    expect(nyanFrameAt(-1)).toBe(0);
    expect(nyanFrameAt(Number.NaN)).toBe(0);
  });
});

describe('stillNyan', () => {
  it('is the cat and its rainbow, a character a cell, in ASCII, with sky round them', () => {
    const rows = stillNyan().split('\n');
    expect(rows).toHaveLength(23);
    for (const row of rows) {
      expect(row).toHaveLength(50);
      expect(row).toMatch(/^[\x20-\x7e]+$/);
    }
    expect(rows[0]).toMatch(/^[.@]+$/);
    expect(stillNyan()).toContain(';');
    expect(stillNyan()).toContain('#');
  });
});
