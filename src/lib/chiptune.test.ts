// The tracker format: notes, rests, ties and drums read from the notation, timed from the tempo,
// every channel the same length so the song loops, and no two notes overlapping on a channel.
import { describe, expect, it } from 'vitest';
import { CHANNELS, ChiptuneError, loopSeconds, midiFrequency, noteMidi, parsePattern, parseSong, schedule, stepSeconds, type Envelope, type Song } from './chiptune';

const env: Envelope = { attack: 0.01, decay: 0.05, sustain: 0.6, release: 0.03 };

/** A bar at 120 bpm in sixteenths: one step is 125 ms, the loop two seconds. */
function song(patterns: Partial<Song['patterns']> = {}, more: Partial<Song> = {}): Song {
  return {
    title: 'test',
    bpm: 120,
    stepsPerBeat: 4,
    duty: { pulse1: 0.5, pulse2: 0.25 },
    envelope: { pulse1: env, pulse2: env, triangle: env, noise: env },
    patterns: { pulse1: 'C5:4 E5:4 G5:4 -:4', pulse2: 'C4:8 E4:8', triangle: 'C3:16', noise: 'K:4 S:4 K:4 S:4', ...patterns },
    ...more,
  };
}

describe('note names', () => {
  it('number the notes as MIDI does, with sharps and flats', () => {
    expect(noteMidi('C4')).toBe(60);
    expect(noteMidi('A4')).toBe(69);
    expect(noteMidi('C5')).toBe(72);
    expect(noteMidi('F#3')).toBe(54);
    expect(noteMidi('Bb3')).toBe(58);
    expect(noteMidi('C0')).toBe(12);
    expect(() => noteMidi('H2')).toThrow(ChiptuneError);
    expect(() => noteMidi('C')).toThrow(ChiptuneError);
  });

  it('tune A4 to 440 Hz and the octaves around it', () => {
    expect(midiFrequency(69)).toBe(440);
    expect(midiFrequency(81)).toBeCloseTo(880, 6);
    expect(midiFrequency(57)).toBeCloseTo(220, 6);
    expect(midiFrequency(60)).toBeCloseTo(261.63, 2);
  });
});

describe('parsePattern', () => {
  it('reads notes with their lengths and accents, rests between them, and ignores bar lines', () => {
    const { notes, steps } = parsePattern('C5:2 | E5:2! -:2 G5:2. | -:8', 'pulse1');
    expect(steps).toBe(16);
    expect(notes).toEqual([
      { step: 0, steps: 2, midi: 72, velocity: 0.8 },
      { step: 2, steps: 2, midi: 76, velocity: 1 },
      { step: 6, steps: 2, midi: 79, velocity: 0.5 },
    ]);
  });

  it('extends the note before with a tie, and refuses a tie with nothing to hold', () => {
    const { notes, steps } = parsePattern('C5:2 ~:2 ~:4 D5:1', 'pulse2');
    expect(steps).toBe(9);
    expect(notes).toEqual([
      { step: 0, steps: 8, midi: 72, velocity: 0.8 },
      { step: 8, steps: 1, midi: 74, velocity: 0.8 },
    ]);
    expect(() => parsePattern('~:2 C5:2', 'pulse2')).toThrow(/a tie/);
    expect(() => parsePattern('C5:2 -:2 ~:2', 'pulse2')).toThrow(/a tie/);
  });

  it('reads the drums on the noise channel, and nowhere else', () => {
    expect(parsePattern('K:2 H:2 S:2! -:2', 'noise').notes).toEqual([
      { step: 0, steps: 2, drum: 'kick', velocity: 0.8 },
      { step: 2, steps: 2, drum: 'hat', velocity: 0.8 },
      { step: 4, steps: 2, drum: 'snare', velocity: 1 },
    ]);
    expect(() => parsePattern('C5:2', 'noise')).toThrow(/not a drum/);
    expect(() => parsePattern('K:2', 'triangle')).toThrow(/only the noise channel/);
  });

  it('refuses what it cannot read, naming the channel and the token', () => {
    expect(() => parsePattern('C5:x', 'pulse1')).toThrow("pulse1: bad token 'C5:x'");
    expect(() => parsePattern('C5', 'pulse1')).toThrow(ChiptuneError);
    expect(() => parsePattern('C5:0', 'pulse1')).toThrow(/no length/);
    expect(parsePattern('', 'pulse1')).toEqual({ notes: [], steps: 0 });
  });
});

describe('a song', () => {
  it('times its steps from the tempo', () => {
    expect(stepSeconds(song())).toBe(0.125);
    expect(stepSeconds(song({}, { bpm: 113, stepsPerBeat: 4 }))).toBeCloseTo(60 / 113 / 4, 9);
  });

  it('is as long as its channels, which must all be the same length to loop', () => {
    const parsed = parseSong(song());
    expect(parsed.steps).toBe(16);
    expect(parsed.seconds).toBe(2);
    expect(loopSeconds(song())).toBe(2);
    expect(() => parseSong(song({ triangle: 'C3:8' }))).toThrow('triangle is 8 steps long, pulse1 16: every channel must be the same length to loop');
    expect(() => parseSong(song({ pulse1: '', pulse2: '', triangle: '', noise: '' }))).toThrow(/empty/);
    expect(() => parseSong(song({}, { bpm: 0 }))).toThrow(/tempo/);
    expect(() => parseSong(song({}, { stepsPerBeat: 1.5 }))).toThrow(/tempo/);
  });

  it('schedules every note from the time it is given, in time order, with frequencies and drums', () => {
    const events = schedule(song(), 10);
    expect(events.map((event) => event.time)).toEqual([...events.map((event) => event.time)].sort((a, b) => a - b));
    expect(events[0]).toEqual({ channel: 'pulse1', time: 10, duration: 0.5, frequency: midiFrequency(72), velocity: 0.8 });
    expect(events.filter((event) => event.channel === 'noise')).toEqual([
      { channel: 'noise', time: 10, duration: 0.5, frequency: 0, velocity: 0.8, drum: 'kick' },
      { channel: 'noise', time: 10.5, duration: 0.5, frequency: 0, velocity: 0.8, drum: 'snare' },
      { channel: 'noise', time: 11, duration: 0.5, frequency: 0, velocity: 0.8, drum: 'kick' },
      { channel: 'noise', time: 11.5, duration: 0.5, frequency: 0, velocity: 0.8, drum: 'snare' },
    ]);
    expect(events.find((event) => event.channel === 'triangle')).toMatchObject({ time: 10, duration: 2, frequency: midiFrequency(48) });
    // Rests make no event.
    expect(events.filter((event) => event.channel === 'pulse1')).toHaveLength(3);
    expect(events).toHaveLength(3 + 2 + 1 + 4);
  });

  it('never has two notes sounding at once on one channel, and ends every loop where the next begins', () => {
    const tune = song({ pulse1: 'C5:1 ~:1 D5:2 -:1 E5:3 F5:4 ~:4', pulse2: 'C4:1 D4:1 E4:1 F4:1 G4:12' });
    const loop = loopSeconds(tune);
    const events = schedule(tune, 0);
    for (const channel of CHANNELS) {
      const own = events.filter((event) => event.channel === channel);
      own.forEach((event, i) => {
        const following = own[i + 1];
        expect(event.time + event.duration).toBeLessThanOrEqual((following?.time ?? loop) + 1e-9);
      });
    }
    // The second loop starts where the first ends, so a loop of loops has no gap or overlap.
    const again = schedule(tune, loop);
    expect(again[0]?.time).toBeCloseTo(loop, 9);
    const lastEnd = Math.max(...events.map((event) => event.time + event.duration));
    expect(lastEnd).toBeCloseTo(loop, 9);
  });
});
