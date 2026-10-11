// A tiny tracker for chiptunes, DOM-free: a Song is four pattern strings, one for each channel
// of an 8-bit sound chip (two pulse waves with a duty cycle each, a triangle for the bass and a
// noise channel for the drums), written in a readable notation, and schedule() turns a Song into
// timed note events for a synth to play (services/chiptune.ts plays them through Web Audio).
//
// The notation, one token per note, separated by spaces, with `|` allowed between bars:
//
//   C5:2      the note C in octave 5 for 2 steps        -:4   a rest of 4 steps
//   F#4:1     sharps with #, flats with b               ~:2   a tie: the note before goes on 2 more
//   G5:3!     an accent (louder)   G5:3.  a soft note   K:2 S:2 H:2   kick, snare, hat (noise only)
//
// A step is a fraction of a beat (stepsPerBeat; 4 makes a step a sixteenth), so every channel's
// tokens must add up to the same number of steps for the song to loop seamlessly. A4 is 440 Hz.

/** The four channels of the chip. */
export type Channel = 'pulse1' | 'pulse2' | 'triangle' | 'noise';
export const CHANNELS: readonly Channel[] = ['pulse1', 'pulse2', 'triangle', 'noise'];

/** A pulse wave's duty cycle: how much of each period is high, as the hardware offered them. */
export type Duty = 0.125 | 0.25 | 0.5;

/** The drums the noise channel plays. */
export type Drum = 'kick' | 'snare' | 'hat';

/** A volume envelope: attack and decay in seconds to a sustain level (0 to 1), and the release in seconds. */
export interface Envelope {
  readonly attack: number;
  readonly decay: number;
  readonly sustain: number;
  readonly release: number;
}

export interface Song {
  readonly title: string;
  /** Beats per minute. */
  readonly bpm: number;
  /** Steps in a beat: 4 makes a step a sixteenth note. */
  readonly stepsPerBeat: number;
  readonly duty: Readonly<Record<'pulse1' | 'pulse2', Duty>>;
  readonly envelope: Readonly<Record<Channel, Envelope>>;
  /** One pattern per channel, in the notation above. */
  readonly patterns: Readonly<Record<Channel, string>>;
}

/** One note (or drum hit) of a pattern, in steps from its start. */
export interface PatternNote {
  readonly step: number;
  readonly steps: number;
  /** MIDI note number for a melodic channel; absent for a drum. */
  readonly midi?: number;
  readonly drum?: Drum;
  /** 0 to 1. */
  readonly velocity: number;
}

export interface ParsedPattern {
  readonly notes: readonly PatternNote[];
  /** The pattern's length in steps, rests included. */
  readonly steps: number;
}

/** A note for the synth: when, how long, what and how loud. Times are seconds in the clock `schedule` was given. */
export interface NoteEvent {
  readonly channel: Channel;
  readonly time: number;
  readonly duration: number;
  /** In Hz; 0 for a drum. */
  readonly frequency: number;
  readonly velocity: number;
  readonly drum?: Drum;
}

export class ChiptuneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChiptuneError';
  }
}

const VELOCITY = { plain: 0.8, accent: 1, soft: 0.5 } as const;

const SEMITONES: Readonly<Record<string, number>> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

const DRUMS: Readonly<Record<string, Drum>> = { K: 'kick', S: 'snare', H: 'hat' };

/** The MIDI number of a note name such as C4 (60), A4 (69), F#3 or Bb5. */
export function noteMidi(name: string): number {
  const match = /^([A-G])([#b]?)(\d)$/.exec(name);
  if (match === null) throw new ChiptuneError(`not a note: ${name}`);
  const [, letter = 'C', accidental, octave = '4'] = match;
  const semitone = SEMITONES[letter] ?? 0;
  const shift = accidental === '#' ? 1 : accidental === 'b' ? -1 : 0;
  return (Number(octave) + 1) * 12 + semitone + shift;
}

/** The frequency of a MIDI note, with A4 (69) at 440 Hz. */
export function midiFrequency(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

/** Reads one channel's pattern. The noise channel takes drums; the others take notes and ties. */
export function parsePattern(text: string, channel: Channel): ParsedPattern {
  const notes: PatternNote[] = [];
  let step = 0;
  let last: PatternNote | null = null;
  for (const token of text.split(/\s+/)) {
    if (token === '' || token === '|') continue;
    const match = /^([A-G][#b]?\d|[-~KSH]):(\d+)([!.]?)$/.exec(token);
    if (match === null) throw new ChiptuneError(`${channel}: bad token '${token}'`);
    const [, head = '-', count = '0', mark = ''] = match;
    const steps = Number(count);
    if (steps < 1) throw new ChiptuneError(`${channel}: '${token}' has no length`);
    if (head === '-') {
      last = null;
    } else if (head === '~') {
      if (last === null) throw new ChiptuneError(`${channel}: a tie '${token}' with nothing before it`);
      const held: PatternNote = { ...last, steps: last.steps + steps };
      notes[notes.length - 1] = held;
      last = held;
    } else {
      const velocity = mark === '!' ? VELOCITY.accent : mark === '.' ? VELOCITY.soft : VELOCITY.plain;
      const drum = DRUMS[head];
      if (channel === 'noise' && drum === undefined) throw new ChiptuneError(`noise: '${token}' is not a drum (K, S or H)`);
      if (channel !== 'noise' && drum !== undefined) throw new ChiptuneError(`${channel}: '${token}' is a drum; only the noise channel plays them`);
      const note: PatternNote = drum === undefined ? { step, steps, midi: noteMidi(head), velocity } : { step, steps, drum, velocity };
      notes.push(note);
      last = note;
    }
    step += steps;
  }
  return { notes, steps: step };
}

/** Seconds in one step. */
export function stepSeconds(song: Song): number {
  return 60 / song.bpm / song.stepsPerBeat;
}

/** Every channel parsed, and the loop's length; throws when the channels' lengths differ. */
export function parseSong(song: Song): { readonly channels: Readonly<Record<Channel, ParsedPattern>>; readonly steps: number; readonly seconds: number } {
  if (!(song.bpm > 0) || !Number.isInteger(song.stepsPerBeat) || song.stepsPerBeat < 1) throw new ChiptuneError('a song needs a tempo and whole steps per beat');
  const channels = {
    pulse1: parsePattern(song.patterns.pulse1, 'pulse1'),
    pulse2: parsePattern(song.patterns.pulse2, 'pulse2'),
    triangle: parsePattern(song.patterns.triangle, 'triangle'),
    noise: parsePattern(song.patterns.noise, 'noise'),
  };
  const lengths = CHANNELS.map((channel) => channels[channel].steps);
  const steps = lengths[0] ?? 0;
  if (steps === 0) throw new ChiptuneError('an empty song');
  const odd = CHANNELS.find((channel) => channels[channel].steps !== steps);
  if (odd !== undefined) throw new ChiptuneError(`${odd} is ${channels[odd].steps} steps long, pulse1 ${steps}: every channel must be the same length to loop`);
  return { channels, steps, seconds: steps * stepSeconds(song) };
}

/** How long one loop of the song lasts, in seconds. */
export function loopSeconds(song: Song): number {
  return parseSong(song).seconds;
}

/**
 * The song's notes as events for a synth, one loop from `fromTime` (seconds), in time order.
 * Notes on a channel never overlap: each ends where the next begins at the latest.
 */
export function schedule(song: Song, fromTime: number): NoteEvent[] {
  const { channels } = parseSong(song);
  const step = stepSeconds(song);
  const events: NoteEvent[] = [];
  for (const channel of CHANNELS) {
    for (const note of channels[channel].notes) {
      const base = { channel, time: fromTime + note.step * step, duration: note.steps * step, velocity: note.velocity };
      events.push(note.drum === undefined ? { ...base, frequency: midiFrequency(note.midi ?? 69) } : { ...base, frequency: 0, drum: note.drum });
    }
  }
  return events.sort((a, b) => a.time - b.time || CHANNELS.indexOf(a.channel) - CHANNELS.indexOf(b.channel));
}
