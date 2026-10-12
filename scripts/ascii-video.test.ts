// The shipped frames file (scripts/ascii-video.py writes it from the owner's video) is what the
// app will read: well formed, within its caps, plain ASCII, and the size the show was traced at.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FRAMES_MAX_CHARS, FRAMES_MAX_FRAMES, parseFramesFile } from '../src/lib/frames';

const FILE = join(import.meta.dirname, '..', 'public', 'audio', 'incident-report.frames');

describe('the shipped frames file', () => {
  it('parses at the rate that fits the track, 120 by 45, within the caps, in printable ASCII', () => {
    const text = readFileSync(FILE, 'latin1');
    expect(text.length).toBeLessThanOrEqual(FRAMES_MAX_CHARS);
    expect(text).toMatch(/^[\x20-\x7e\n]*$/);
    const file = parseFramesFile(text);
    expect(file).not.toBeNull();
    // Fifteen frames a second of the video, played a little faster so one loop is the track's 194.56 s.
    expect({ fps: file?.fps, cols: file?.cols, rows: file?.rows }).toEqual({ fps: 16.3908, cols: 120, rows: 45 });
    expect((file?.frames.length ?? 0) / (file?.fps ?? 1)).toBeCloseTo(194.56, 2);
    expect(file?.frames.length).toBeGreaterThan(3000);
    expect(file?.frames.length).toBeLessThanOrEqual(FRAMES_MAX_FRAMES);
    // Every frame is the full grid, padded by the parser where a row was cut short.
    for (const frame of file?.frames ?? []) expect(frame.rows.length).toBe(45);
    expect(file?.frames[1000]?.text.split('\n').every((row) => row.length === 120)).toBe(true);
  });
});
