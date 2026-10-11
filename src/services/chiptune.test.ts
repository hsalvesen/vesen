// The 8-bit synth over a fake AudioContext: notes are handed to the clock a look-ahead at a time
// and the song loops; stop fades the master and silences every source; mute and unmute move the
// master gain; a suspended context is waited for, then started when the browser lets it run.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Envelope, Song } from '../lib/chiptune';
import { createChiptune, FADE_OUT_MS, LOOKAHEAD_S, MASTER_GAIN, RESUME_WAIT_MS, TICK_MS } from './chiptune';

const env: Envelope = { attack: 0.01, decay: 0.05, sustain: 0.6, release: 0.03 };

/** 120 bpm in sixteenths: a step is 125 ms; one bar, two seconds a loop. */
const SONG: Song = {
  title: 'test',
  bpm: 120,
  stepsPerBeat: 4,
  duty: { pulse1: 0.5, pulse2: 0.25 },
  envelope: { pulse1: env, pulse2: env, triangle: env, noise: env },
  patterns: { pulse1: 'C5:4 E5:4 G5:4 -:4', pulse2: 'C4:8 E4:8', triangle: 'C3:16', noise: 'K:4 S:4 H:4 -:4' },
};

class FakeParam {
  value = 0;
  readonly calls: { kind: string; value: number; time: number }[] = [];

  setValueAtTime(value: number, time: number): this {
    this.value = value;
    this.calls.push({ kind: 'set', value, time });
    return this;
  }

  linearRampToValueAtTime(value: number, time: number): this {
    this.calls.push({ kind: 'linear', value, time });
    return this;
  }

  exponentialRampToValueAtTime(value: number, time: number): this {
    this.calls.push({ kind: 'exponential', value, time });
    return this;
  }

  cancelScheduledValues(time: number): this {
    this.calls.push({ kind: 'cancel', value: 0, time });
    return this;
  }
}

class FakeNode {
  readonly connections: unknown[] = [];
  disconnects = 0;

  connect(node: unknown): unknown {
    this.connections.push(node);
    return node;
  }

  disconnect(): void {
    this.disconnects += 1;
  }
}

class FakeSource extends FakeNode {
  readonly starts: number[] = [];
  readonly stops: number[] = [];
  onended: (() => void) | null = null;

  start(time = 0): void {
    this.starts.push(time);
  }

  stop(time = 0): void {
    this.stops.push(time);
  }
}

class FakeOscillator extends FakeSource {
  type = 'sine';
  frequency = new FakeParam();
  wave: unknown = null;

  setPeriodicWave(wave: unknown): void {
    this.wave = wave;
  }
}

class FakeGain extends FakeNode {
  gain = new FakeParam();
}

class FakeFilter extends FakeNode {
  type = 'lowpass';
  frequency = new FakeParam();
  Q = new FakeParam();
}

class FakeBufferSource extends FakeSource {
  buffer: unknown = null;
}

class FakeContext {
  state: AudioContextState = 'running';
  currentTime = 0;
  sampleRate = 44100;
  destination = new FakeNode();
  readonly oscillators: FakeOscillator[] = [];
  readonly gains: FakeGain[] = [];
  readonly sources: FakeBufferSource[] = [];
  readonly filters: FakeFilter[] = [];
  waves = 0;
  buffers = 0;
  resumes = 0;
  /** What resume() answers; a test may leave it pending, as Chrome does until a gesture. */
  resumeWith: Promise<void> = Promise.resolve();

  resume(): Promise<void> {
    this.resumes += 1;
    return this.resumeWith;
  }

  createOscillator(): FakeOscillator {
    const node = new FakeOscillator();
    this.oscillators.push(node);
    return node;
  }

  createGain(): FakeGain {
    const node = new FakeGain();
    this.gains.push(node);
    return node;
  }

  createBufferSource(): FakeBufferSource {
    const node = new FakeBufferSource();
    this.sources.push(node);
    return node;
  }

  createBiquadFilter(): FakeFilter {
    const node = new FakeFilter();
    this.filters.push(node);
    return node;
  }

  createPeriodicWave(real: Float32Array, imag: Float32Array): unknown {
    this.waves += 1;
    return { real, imag };
  }

  createBuffer(_channels: number, length: number): unknown {
    this.buffers += 1;
    return { getChannelData: () => new Float32Array(length) };
  }

  /** Every source started so far. */
  get started(): FakeSource[] {
    return [...this.oscillators, ...this.sources].filter((source) => source.starts.length > 0);
  }
}

function setup(ready: Partial<FakeContext> = {}) {
  const fake = Object.assign(new FakeContext(), ready);
  const onChange = vi.fn();
  const synth = createChiptune(SONG, { context: () => fake as unknown as AudioContext, onChange });
  return { fake, synth, onChange };
}

/** Moves the audio clock and the timers on together. */
async function pass(fake: FakeContext, seconds: number): Promise<void> {
  fake.currentTime += seconds;
  await vi.advanceTimersByTimeAsync(seconds * 1000);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the chiptune synth', () => {
  it('starts at once on a running context, scheduling only the notes within the look-ahead', async () => {
    const { fake, synth, onChange } = setup();
    expect(synth.available).toBe(true);
    expect(synth.playing).toBe(false);
    expect(await synth.play()).toBe(true);
    expect(synth.playing).toBe(true);
    expect(onChange).toHaveBeenCalledTimes(1);
    // The master, at the house volume, into the destination.
    const master = fake.gains[0];
    expect(master?.gain.value).toBe(MASTER_GAIN);
    expect(master?.connections).toContain(fake.destination);
    // The first step: a lead note, a chord note, the bass, the kick (noise and its thump).
    expect(fake.sources).toHaveLength(1);
    expect(fake.oscillators).toHaveLength(4);
    const lead = fake.oscillators[0];
    expect(lead?.wave).not.toBeNull();
    expect(lead?.frequency.calls[0]).toMatchObject({ kind: 'set', value: expect.closeTo(523.25, 1) as number });
    expect(fake.oscillators[2]?.type).toBe('triangle');
    expect(fake.filters[0]?.type).toBe('lowpass');
    // Nothing from the second beat yet: it is further off than the look-ahead.
    expect(fake.started.every((source) => (source.starts[0] ?? 0) < LOOKAHEAD_S)).toBe(true);
  });

  it('hands over more notes as the clock advances, and starts the song over when the loop ends', async () => {
    const { fake, synth } = setup();
    await synth.play();
    const first = fake.started.length;
    await pass(fake, 0.5);
    // The second beat: the lead's E5 and the snare.
    expect(fake.started.length).toBe(first + 2);
    expect(fake.filters[1]?.type).toBe('bandpass');
    await pass(fake, 1.5);
    // Two seconds in: the loop starts again from its first step.
    const loopNotes = fake.oscillators.filter((osc) => osc.starts.some((time) => Math.abs(time - 2.05) < 1e-9));
    expect(loopNotes).toHaveLength(4);
    expect(fake.waves).toBe(2);
    expect(fake.buffers).toBe(1);
  });

  it('wakes the timer every 25 ms, and schedules nothing after stop', async () => {
    const { fake, synth } = setup();
    await synth.play();
    const before = fake.started.length;
    fake.currentTime += 0.5;
    await vi.advanceTimersByTimeAsync(TICK_MS);
    expect(fake.started.length).toBeGreaterThan(before);
    synth.stop();
    const after = fake.started.length;
    await pass(fake, 1);
    expect(fake.started.length).toBe(after);
  });

  it('stops with a short fade of the master, then silences every source and takes the graph down', async () => {
    const { fake, synth, onChange } = setup();
    await synth.play();
    await pass(fake, 0.5);
    const live = fake.started;
    expect(live.length).toBeGreaterThan(0);
    synth.stop();
    expect(synth.playing).toBe(false);
    expect(onChange).toHaveBeenCalledTimes(2);
    const master = fake.gains[0];
    expect(master?.gain.calls.slice(-3)).toEqual([
      { kind: 'cancel', value: 0, time: 0.5 },
      { kind: 'set', value: MASTER_GAIN, time: 0.5 },
      { kind: 'linear', value: 0, time: 0.5 + FADE_OUT_MS / 1000 },
    ]);
    // Still sounding through the fade.
    expect(live.every((source) => source.stops.length === 1)).toBe(true);
    await vi.advanceTimersByTimeAsync(FADE_OUT_MS + 20);
    expect(live.every((source) => source.stops.length === 2 && source.disconnects >= 1)).toBe(true);
    expect(master?.disconnects).toBe(1);
    // A second stop is harmless, and play starts afresh.
    synth.stop();
    expect(await synth.play()).toBe(true);
    expect(fake.gains.length).toBeGreaterThan(1);
  });

  it('mutes by taking the master gain to zero, and unmutes back to the house volume', async () => {
    const { fake, synth, onChange } = setup();
    await synth.play();
    const master = fake.gains[0];
    synth.mute();
    expect(synth.muted).toBe(true);
    expect(master?.gain.calls[master.gain.calls.length - 1]).toEqual({ kind: 'linear', value: 0, time: 0.02 });
    synth.mute();
    expect(onChange).toHaveBeenCalledTimes(2);
    synth.unmute();
    expect(synth.muted).toBe(false);
    expect(master?.gain.calls[master.gain.calls.length - 1]).toEqual({ kind: 'linear', value: MASTER_GAIN, time: 0.02 });
    expect(onChange).toHaveBeenCalledTimes(3);
    // Muted before playing: the master is made silent.
    const quiet = setup();
    quiet.synth.mute();
    await quiet.synth.play();
    expect(quiet.fake.gains[0]?.gain.value).toBe(0);
  });

  it('waits for a suspended context, says it is not playing, and starts when the browser lets it', async () => {
    let allow: () => void = () => {};
    const pending = new Promise<void>((resolve) => (allow = resolve));
    const { fake, synth, onChange } = setup({ state: 'suspended', resumeWith: pending });
    const asked = synth.play();
    await vi.advanceTimersByTimeAsync(RESUME_WAIT_MS + 5);
    expect(await asked).toBe(false);
    expect(fake.resumes).toBe(1);
    expect(synth.playing).toBe(false);
    expect(fake.started).toHaveLength(0);
    // The gesture comes: Chrome resumes the context and settles the promise.
    fake.state = 'running';
    allow();
    await vi.advanceTimersByTimeAsync(0);
    expect(synth.playing).toBe(true);
    expect(onChange).toHaveBeenCalled();
    expect(fake.started.length).toBeGreaterThan(0);
    // Asked again inside a gesture, with the context now running, it is simply playing.
    expect(await synth.play()).toBe(true);
  });

  it('does not start after a stop, even when the context resumes late', async () => {
    let allow: () => void = () => {};
    const pending = new Promise<void>((resolve) => (allow = resolve));
    const { fake, synth } = setup({ state: 'suspended', resumeWith: pending });
    const asked = synth.play();
    await vi.advanceTimersByTimeAsync(RESUME_WAIT_MS + 5);
    await asked;
    synth.stop();
    fake.state = 'running';
    allow();
    await vi.advanceTimersByTimeAsync(0);
    expect(synth.playing).toBe(false);
    expect(fake.started).toHaveLength(0);
  });

  it('is unavailable without Web Audio, and every call is a safe no-op', async () => {
    const onChange = vi.fn();
    const synth = createChiptune(SONG, { context: () => null, onChange });
    expect(synth.available).toBe(false);
    expect(await synth.play()).toBe(false);
    synth.mute();
    synth.unmute();
    synth.stop();
    expect(synth.playing).toBe(false);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('falls back to a square wave where the browser has no PeriodicWave', async () => {
    const fake = new FakeContext();
    (fake as { createPeriodicWave?: unknown }).createPeriodicWave = undefined;
    const synth = createChiptune(SONG, { context: () => fake as unknown as AudioContext });
    await synth.play();
    expect(fake.oscillators[0]?.type).toBe('square');
    expect(fake.oscillators[0]?.wave).toBeNull();
  });
});
