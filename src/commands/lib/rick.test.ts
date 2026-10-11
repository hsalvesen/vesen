// sudo's show: every frame of the dancer the same size and drawn only with glyphs Vesen Mono has,
// the parts in their colour roles, the frames moving; and the tune a well-formed song of the
// promised length and tempo, written for vesen.
import { describe, expect, it } from 'vitest';
import { parseSong, schedule } from '../../lib/chiptune';
import { compose, FRAME_COLS, FRAME_ROWS, RICK_ALT, RICK_FPS, RICK_SONG, RICK_TITLE, rickFrames, rickLoopSeconds, rickView } from './rick';

/**
 * The code points in public/fonts/VesenMono.woff2, as inclusive ranges (scripts/fonts/build-vesen-mono.py
 * builds it). A glyph outside them falls back to another font and looks wrong.
 */
const FONT_RANGES: readonly (readonly [number, number])[] = [
  [32, 126], [160, 383], [7716, 7717], [7728, 7728], [7730, 7735], [7738, 7739], [7752, 7753], [7760, 7763], [7770, 7771],
  [7778, 7779], [7790, 7790], [7808, 7813], [7838, 7838], [7840, 7929], [8200, 8200], [8208, 8209], [8211, 8213], [8215, 8222],
  [8224, 8226], [8228, 8228], [8230, 8230], [8232, 8232], [8240, 8240], [8242, 8243], [8249, 8250], [8252, 8252], [8254, 8254],
  [8260, 8260], [8304, 8304], [8308, 8313], [8319, 8329], [8352, 8353], [8355, 8356], [8358, 8366], [8369, 8370], [8372, 8373],
  [8376, 8378], [8380, 8383], [8453, 8453], [8467, 8467], [8470, 8471], [8478, 8478], [8482, 8482], [8486, 8486], [8494, 8494],
  [8592, 8597], [8616, 8616], [8626, 8626], [8673, 8673], [8675, 8675], [8706, 8706], [8710, 8710], [8719, 8719], [8721, 8722],
  [8725, 8725], [8729, 8730], [8734, 8735], [8745, 8745], [8747, 8747], [8758, 8758], [8776, 8776], [8800, 8805], [9166, 9166],
  [9472, 9727], [10003, 10003], [10240, 10495], [65533, 65533],
];

const inFont = (ch: string): boolean => {
  const code = ch.codePointAt(0) ?? -1;
  return FONT_RANGES.some(([from, to]) => code >= from && code <= to);
};

const rowsOf = (text: string): string[] => text.split('\n');

describe('the dancer', () => {
  const frames = rickFrames();

  it('has between 8 and 12 frames, every one 24 columns by 14 rows', () => {
    expect(frames.length).toBeGreaterThanOrEqual(8);
    expect(frames.length).toBeLessThanOrEqual(12);
    for (const frame of frames) {
      const rows = rowsOf(frame.text);
      expect(rows).toHaveLength(FRAME_ROWS);
      for (const row of rows) expect(Array.from(row)).toHaveLength(FRAME_COLS);
      expect(frame.rows).toHaveLength(FRAME_ROWS);
    }
  });

  it('is drawn only with glyphs the web font has', () => {
    const used = new Set(frames.flatMap((frame) => Array.from(frame.text.replace(/\n/g, ''))));
    const missing = [...used].filter((ch) => !inFont(ch));
    expect(missing).toEqual([]);
  });

  it('colours the coat in the accent, the face and hands in the strong foreground and the floor muted, with the spans spelling each row', () => {
    for (const frame of frames) {
      const rows = rowsOf(frame.text);
      frame.rows.forEach((spans, r) => {
        expect(spans.map((span) => span.text).join('')).toBe(rows[r]);
      });
      const roles = new Set(frame.rows.flat().filter((span) => span.text.trim() !== '').map((span) => span.role));
      expect(roles).toContain('accent');
      expect(roles).toContain('fg-strong');
      expect(roles).toContain('fg');
      // The floor: the last row, one muted span across the frame.
      const floor = frame.rows[FRAME_ROWS - 1] ?? [];
      expect(floor).toEqual([{ text: '━'.repeat(FRAME_COLS), role: 'muted' }]);
      // The coat's hem sits above the floor, in the accent, and the quiff on top in the foreground.
      expect(frame.rows[10]?.some((span) => span.role === 'accent' && span.text.includes('|____|'))).toBe(true);
      expect(frame.rows[0]?.some((span) => span.role === 'fg' && span.text.trim() !== '')).toBe(true);
      // The microphone's head is somewhere in every frame.
      expect(frame.text).toContain('o');
    }
  });

  it('moves: every frame differs from the one before, the hips sway both ways, and the mouth opens and closes', () => {
    frames.forEach((frame, i) => {
      const before = frames[(i + frames.length - 1) % frames.length];
      expect(frame.text).not.toBe(before?.text);
    });
    const hem = (frame: { text: string }): number => rowsOf(frame.text)[10]?.indexOf('|____|') ?? -1;
    const positions = frames.map(hem);
    expect(Math.min(...positions)).toBeLessThan(positions[0] ?? 0);
    expect(Math.max(...positions)).toBeGreaterThan(positions[0] ?? 0);
    expect(frames.some((frame) => frame.text.includes('()'))).toBe(true);
    expect(frames.some((frame) => frame.text.includes('--'))).toBe(true);
  });

  it('composes sprites in order, with spaces transparent', () => {
    const frame = compose([
      { sprite: { rows: ['ab', 'cd'], role: 'fg' }, x: 1, y: 1 },
      { sprite: { rows: [' X'], role: 'accent' }, x: 1, y: 1 },
      { sprite: { rows: ['zz'], role: 'muted' }, x: FRAME_COLS - 1, y: FRAME_ROWS - 1 },
    ]);
    const rows = rowsOf(frame.text);
    expect(rows[1]?.slice(0, 4)).toBe(' aX ');
    expect(rows[2]?.slice(0, 4)).toBe(' cd ');
    // Off the frame is dropped, not wrapped.
    expect(rows[FRAME_ROWS - 1]?.endsWith('z')).toBe(true);
    expect(rows[FRAME_ROWS - 1]?.startsWith(' ')).toBe(true);
    // Blank cells read as plain text, so they join the span beside them.
    expect(frame.rows[1]?.slice(0, 2)).toEqual([
      { text: ' a', role: 'fg' },
      { text: 'X', role: 'accent' },
    ]);
  });

  it('draws the frames once', () => {
    expect(rickFrames()).toBe(frames);
  });
});

describe('the tune', () => {
  it('is a well-formed song at 113 bpm that loops in 30 to 45 seconds, using all four channels', () => {
    const parsed = parseSong(RICK_SONG);
    expect(RICK_SONG.bpm).toBe(113);
    expect(RICK_SONG.stepsPerBeat).toBe(4);
    expect(parsed.steps % 16).toBe(0);
    expect(rickLoopSeconds()).toBeGreaterThanOrEqual(30);
    expect(rickLoopSeconds()).toBeLessThanOrEqual(45);
    const events = schedule(RICK_SONG, 0);
    for (const channel of ['pulse1', 'pulse2', 'triangle', 'noise'] as const) {
      expect(events.filter((event) => event.channel === channel).length).toBeGreaterThan(16);
    }
    expect(events.some((event) => event.drum === 'kick')).toBe(true);
    expect(events.some((event) => event.drum === 'snare')).toBe(true);
    expect(events.some((event) => event.drum === 'hat')).toBe(true);
    expect(RICK_SONG.duty).toEqual({ pulse1: 0.5, pulse2: 0.25 });
    expect(RICK_SONG.title).toBe('Never Logging Out');
  });

  it('keeps the lead in a singable range and the bass below it', () => {
    const events = schedule(RICK_SONG, 0);
    const lead = events.filter((event) => event.channel === 'pulse1').map((event) => event.frequency);
    const bass = events.filter((event) => event.channel === 'triangle').map((event) => event.frequency);
    expect(Math.min(...lead)).toBeGreaterThan(500);
    expect(Math.max(...lead)).toBeLessThan(1600);
    expect(Math.max(...bass)).toBeLessThan(Math.min(...lead));
  });

  it('steps the dance on the song\'s sixteenths', () => {
    expect(RICK_FPS).toBeCloseTo(113 / 60 * 4, 6);
    expect(RICK_FPS).toBeGreaterThan(7);
    expect(RICK_FPS).toBeLessThan(9);
  });
});

describe('the view', () => {
  it('carries the frames, the song, the title and the way it reads, and whether the screen is touch', () => {
    const view = rickView(true);
    expect(view).toMatchObject({ title: RICK_TITLE, alt: RICK_ALT, fps: RICK_FPS, touch: true });
    expect(view.frames).toBe(rickFrames());
    expect(view.song).toBe(RICK_SONG);
    expect(rickView(false).touch).toBe(false);
    expect(RICK_TITLE).toBe('You have been rickrolled');
  });
});
