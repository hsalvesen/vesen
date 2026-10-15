// sudo's show: the tune a well-formed song of the promised length and tempo, written for vesen,
// the view naming the owner's track and frames, the title and the way it reads, and the
// fingerprint a touch screen asks the visitor's thumb on.
import { describe, expect, it } from 'vitest';
import { parseSong, schedule } from '../../lib/chiptune';
import { RICK_ALT, RICK_ELEVATE, RICK_FINGERPRINT, RICK_FRAMES, RICK_FRAMES_PORTRAIT, RICK_SONG, RICK_TITLE, RICK_TRACK, rickLoopSeconds, rickView } from './rick';

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
});

describe('the view', () => {
  it('carries the track and the frames file to look for, the song, the title and the way it reads, and whether the screen is touch', () => {
    const view = rickView(true);
    expect(view).toEqual({ title: RICK_TITLE, alt: RICK_ALT, track: RICK_TRACK, framesFile: RICK_FRAMES, portraitFramesFile: RICK_FRAMES_PORTRAIT, song: RICK_SONG, touch: true });
    expect(RICK_ALT).toMatch(/video/);
    expect(rickView(false).touch).toBe(false);
    expect(RICK_TITLE).toBe('You have been rickrolled');
    // Both on this origin, under a name that fits sudo's closing line and gives nothing away.
    expect(RICK_TRACK).toBe('/audio/incident-report.mp3');
    expect(RICK_FRAMES).toBe('/audio/incident-report.frames');
    expect(RICK_FRAMES_PORTRAIT).toBe('/audio/incident-report.portrait.frames');
  });
});

describe('the fingerprint', () => {
  it('is ASCII art of 14 rows, ridges in every one, symmetric enough to read as a print and ending lower towards the middle', () => {
    const rows = RICK_FINGERPRINT.split('\n');
    expect(rows).toHaveLength(14);
    // Printable ASCII alone, as the show's own frames are, with no trailing spaces.
    expect(RICK_FINGERPRINT).toMatch(/^[\x20-\x7e\n]+$/);
    expect(rows.every((row) => row.trim() !== '' && row === row.trimEnd())).toBe(true);
    expect(Math.max(...rows.map((row) => row.length))).toBe(25);
    // Arches nested round the core: the top row is the outer ridge's cap, the last the core's legs.
    expect(rows[0]?.trim()).toBe('_.-----._');
    expect(rows[rows.length - 1]?.trim()).toBe("'   '");
    // Its ridges reach down further in the middle than at the sides: each row narrower below the widest.
    const width = (row: string) => row.trimEnd().length - (row.length - row.trimStart().length);
    const widths = rows.map(width);
    const widest = widths.indexOf(Math.max(...widths));
    for (let r = widest + 1; r < rows.length; r += 1) expect(widths[r]).toBeLessThanOrEqual(widths[r - 1] ?? 0);
  });

  it('is asked for in two lines: scan your right thumb, to elevate privileges', () => {
    expect(RICK_ELEVATE.split('\n')).toEqual(['Scan your right thumb', 'to elevate privileges']);
  });
});
