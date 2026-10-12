// The shipped frames files (scripts/ascii-video.py writes them from the owner's video) are what
// the app will read: well formed, within its caps, plain ASCII, every frame of them read, at the
// rate that makes one loop of them one loop of the track, and the two cuts frame for frame alike.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FRAMES_MAX_CHARS, FRAMES_MAX_FRAMES, parseFramesFile } from '../src/lib/frames';

const AUDIO = join(import.meta.dirname, '..', 'public', 'audio');
/** The track's length in seconds: public/audio/incident-report.mp3. */
const TRACK_SECONDS = 194.56;
/** Fifteen frames a second of the video's 212.56 s. */
const FRAMES = 3189;

function read(name: string) {
  const text = readFileSync(join(AUDIO, name), 'latin1');
  expect(text.length, name).toBeLessThanOrEqual(FRAMES_MAX_CHARS);
  expect(text, name).toMatch(/^[\x20-\x7e\n]*$/);
  const file = parseFramesFile(text);
  expect(file, name).not.toBeNull();
  return file!;
}

describe('the shipped frames files', () => {
  it('read whole, at the rate that fits the track: the whole picture at 120 by 45', () => {
    const file = read('incident-report.frames');
    expect({ fps: file.fps, cols: file.cols, rows: file.rows }).toEqual({ fps: 16.3908, cols: 120, rows: 45 });
    // Every frame, the black last one too: one loop of them is one loop of the track.
    expect(file.frames).toHaveLength(FRAMES);
    expect(FRAMES).toBeLessThanOrEqual(FRAMES_MAX_FRAMES);
    expect(file.frames.length / file.fps).toBeCloseTo(TRACK_SECONDS, 2);
    for (const frame of file.frames) expect(frame.rows.length).toBe(45);
    expect(file.frames[1000]?.text.split('\n').every((row) => row.length === 120)).toBe(true);
  });

  it('and the portrait cut, the middle of it at 72 by 56, frame for frame with it', () => {
    const file = read('incident-report.portrait.frames');
    expect({ fps: file.fps, cols: file.cols, rows: file.rows }).toEqual({ fps: 16.3908, cols: 72, rows: 56 });
    expect(file.frames).toHaveLength(FRAMES);
    expect(file.frames.length / file.fps).toBeCloseTo(TRACK_SECONDS, 2);
    for (const frame of file.frames) expect(frame.rows.length).toBe(56);
  });
});
