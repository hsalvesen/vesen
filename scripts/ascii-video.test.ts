// The shipped frames files (scripts/ascii-video.py writes them from the owner's video) are what
// the app will read: well formed, within its caps, plain ASCII, every frame of them read, at the
// rate that makes one loop of them one loop of the track (read from the MP3's own header), and the
// two cuts frame for frame alike.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FRAMES_MAX_CHARS, FRAMES_MAX_FRAMES, parseFramesFile } from '../src/lib/frames';

const AUDIO = join(import.meta.dirname, '..', 'public', 'audio');
/** Fifteen frames a second of the video's 212.56 s. */
const FRAMES = 3189;

/**
 * How long public/audio/incident-report.mp3 plays, as a browser plays it: the frames its Xing
 * header counts, 1152 samples each at 44.1 kHz, less the encoder's delay and the end padding its
 * LAME tag gives.
 */
function trackSeconds(): number {
  const mp3 = readFileSync(join(AUDIO, 'incident-report.mp3'));
  const id3 = mp3.subarray(0, 3).toString('latin1') === 'ID3' ? 10 + ((mp3[6]! << 21) | (mp3[7]! << 14) | (mp3[8]! << 7) | mp3[9]!) : 0;
  // MPEG-1 Layer III, stereo: the tag follows the frame's 4-byte header and 32 bytes of side info.
  const xing = id3 + 36;
  expect(['Xing', 'Info']).toContain(mp3.subarray(xing, xing + 4).toString('latin1'));
  expect(mp3.readUInt32BE(xing + 4)).toBe(15);
  const frames = mp3.readUInt32BE(xing + 8);
  const lame = xing + 8 + 4 + 4 + 100 + 4;
  const delay = (mp3[lame + 21]! << 4) | (mp3[lame + 22]! >> 4);
  const padding = ((mp3[lame + 22]! & 15) << 8) | mp3[lame + 23]!;
  return (frames * 1152 - delay - padding) / 44100;
}

/** The track ends at 2:53.962, in the silence after the song fades out, before the snippet of another song that followed it. */
const TRACK_SECONDS = trackSeconds();

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
    expect(TRACK_SECONDS).toBeCloseTo(173.962, 3);
    const file = read('incident-report.frames');
    expect({ fps: file.fps, cols: file.cols, rows: file.rows }).toEqual({ fps: 18.3315, cols: 120, rows: 45 });
    // Every frame, the black last one too: one loop of them is one loop of the track.
    expect(file.frames).toHaveLength(FRAMES);
    expect(FRAMES).toBeLessThanOrEqual(FRAMES_MAX_FRAMES);
    expect(file.frames.length / file.fps).toBeCloseTo(TRACK_SECONDS, 2);
    for (const frame of file.frames) expect(frame.rows.length).toBe(45);
    expect(file.frames[1000]?.text.split('\n').every((row) => row.length === 120)).toBe(true);
  });

  it('and the portrait cut, the middle of it at 72 by 56, frame for frame with it', () => {
    const file = read('incident-report.portrait.frames');
    expect({ fps: file.fps, cols: file.cols, rows: file.rows }).toEqual({ fps: 18.3315, cols: 72, rows: 56 });
    expect(file.frames).toHaveLength(FRAMES);
    expect(file.frames.length / file.fps).toBeCloseTo(TRACK_SECONDS, 2);
    for (const frame of file.frames) expect(frame.rows.length).toBe(56);
  });
});
