// An 8-bit synth for lib/chiptune.ts's songs, through the page's one AudioContext (audio.ts): the
// pulse channels are periodic waves at the song's duty cycles (a square wave where the browser
// cannot make one), the bass a triangle oscillator, and the drums white noise through a filter
// with a short envelope, with a thump under the kick. A look-ahead scheduler hands notes to the
// audio clock a little ahead of time, every 25 ms, as Web Audio music is usually played, and
// starts the song over when a loop ends, so it never gaps.
//
// Autoplay: a context made before any gesture is suspended, and some browsers resume it only inside
// one. play() asks; when the context stays suspended it says so, and the app plays again at the
// visitor's next key or tap.

import { loopSeconds, schedule, type Drum, type Duty, type NoteEvent, type Song } from '../lib/chiptune';
import { audioContext } from './audio';

/** How far ahead notes are handed to the audio clock, and how often the scheduler looks. */
export const LOOKAHEAD_S = 0.12;
export const TICK_MS = 25;
/** The master volume, and the fade when the music stops, so nothing clicks. */
export const MASTER_GAIN = 0.15;
export const FADE_OUT_MS = 60;
/** How long play() waits for a suspended context to resume before reporting that it has not. */
export const RESUME_WAIT_MS = 250;
/** The gap left at the end of every note, so repeated notes are heard as separate. */
const GAP_S = 0.02;
/** Each channel's level under the master. */
const LEVEL = { pulse1: 0.55, pulse2: 0.35, triangle: 0.8, noise: 0.6 } as const;

export interface Chiptune {
  /**
   * Starts the music, or tries to: resolves true when sound is running, false where there is no
   * Web Audio or while the browser waits for a gesture (then play() again inside one).
   */
  play(): Promise<boolean>;
  /** Fades out over FADE_OUT_MS and stops everything; play() may start it again. */
  stop(): void;
  mute(): void;
  unmute(): void;
  readonly muted: boolean;
  /** Notes are being scheduled and the context runs. */
  readonly playing: boolean;
  /** The browser has Web Audio. */
  readonly available: boolean;
}

export interface ChiptuneOptions {
  /** The context to play through; the page's shared one by default. */
  readonly context?: () => AudioContext | null;
  /** Called whenever `playing` or `muted` changes. */
  readonly onChange?: () => void;
}

/** The drums: how the noise is filtered and how long it rings. */
const DRUMS: Readonly<Record<Drum, { type: BiquadFilterType; frequency: number; decay: number }>> = {
  kick: { type: 'lowpass', frequency: 180, decay: 0.1 },
  snare: { type: 'bandpass', frequency: 1800, decay: 0.14 },
  hat: { type: 'highpass', frequency: 7000, decay: 0.04 },
};

export function createChiptune(song: Song, options: ChiptuneOptions = {}): Chiptune {
  const getContext = options.context ?? audioContext;
  const loop = loopSeconds(song);
  let ctx: AudioContext | null | undefined;
  let master: GainNode | null = null;
  let noise: AudioBuffer | null = null;
  const waves = new Map<Duty, PeriodicWave | null>();
  const live = new Set<AudioScheduledSourceNode>();
  let timer: ReturnType<typeof setInterval> | null = null;
  let fade: ReturnType<typeof setTimeout> | null = null;
  let events: NoteEvent[] = [];
  let next = 0;
  let loopStart = 0;
  let muted = false;
  let playing = false;
  /** play() was called, and stop() has not been since. */
  let wanted = false;

  const changed = (): void => options.onChange?.();

  function context(): AudioContext | null {
    if (ctx === undefined) ctx = getContext();
    return ctx;
  }

  /** The master gain, made on the first play. */
  function graph(c: AudioContext): GainNode {
    if (master !== null) return master;
    master = c.createGain();
    master.gain.value = muted ? 0 : MASTER_GAIN;
    master.connect(c.destination);
    return master;
  }

  /** A pulse wave of the given duty cycle, from its Fourier series; null where the browser has no PeriodicWave. */
  function pulseWave(c: AudioContext, duty: Duty): PeriodicWave | null {
    const known = waves.get(duty);
    if (known !== undefined) return known;
    let wave: PeriodicWave | null = null;
    if (typeof c.createPeriodicWave === 'function') {
      const terms = 32;
      const real = new Float32Array(terms);
      const imag = new Float32Array(terms);
      for (let k = 1; k < terms; k += 1) real[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
      wave = c.createPeriodicWave(real, imag);
    }
    waves.set(duty, wave);
    return wave;
  }

  /** A second of white noise, made once. */
  function noiseBuffer(c: AudioContext): AudioBuffer {
    if (noise !== null) return noise;
    const rate = c.sampleRate > 0 ? c.sampleRate : 44100;
    noise = c.createBuffer(1, Math.floor(rate), rate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    return noise;
  }

  /** Keeps a source until it ends, so stop() can silence everything still sounding. */
  function keep(source: AudioScheduledSourceNode, ...nodes: AudioNode[]): void {
    live.add(source);
    source.onended = () => {
      live.delete(source);
      source.disconnect();
      for (const node of nodes) node.disconnect();
    };
  }

  function playNote(c: AudioContext, out: GainNode, event: NoteEvent): void {
    const osc = c.createOscillator();
    const gain = c.createGain();
    const envelope = song.envelope[event.channel];
    if (event.channel === 'triangle') osc.type = 'triangle';
    else {
      const wave = pulseWave(c, song.duty[event.channel === 'pulse1' ? 'pulse1' : 'pulse2']);
      if (wave !== null) osc.setPeriodicWave(wave);
      else osc.type = 'square';
    }
    osc.frequency.setValueAtTime(event.frequency, event.time);
    const peak = LEVEL[event.channel] * event.velocity;
    const start = event.time;
    const end = start + Math.max(0.03, event.duration - GAP_S);
    const decayed = Math.min(start + envelope.attack + envelope.decay, end);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(peak, Math.min(start + envelope.attack, end));
    gain.gain.linearRampToValueAtTime(peak * envelope.sustain, decayed);
    if (end > decayed) gain.gain.setValueAtTime(peak * envelope.sustain, end);
    gain.gain.linearRampToValueAtTime(0, end + envelope.release);
    osc.connect(gain);
    gain.connect(out);
    osc.start(start);
    osc.stop(end + envelope.release + 0.005);
    keep(osc, gain);
  }

  function playDrum(c: AudioContext, out: GainNode, event: NoteEvent, drum: Drum): void {
    const shape = DRUMS[drum];
    const source = c.createBufferSource();
    source.buffer = noiseBuffer(c);
    const filter = c.createBiquadFilter();
    filter.type = shape.type;
    filter.frequency.value = shape.frequency;
    const gain = c.createGain();
    const peak = LEVEL.noise * event.velocity;
    gain.gain.setValueAtTime(peak, event.time);
    gain.gain.exponentialRampToValueAtTime(0.001, event.time + shape.decay);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(out);
    source.start(event.time);
    source.stop(event.time + shape.decay + 0.005);
    keep(source, filter, gain);
    if (drum !== 'kick') return;
    // The thump under the kick: a falling triangle tone, as the chips did it.
    const thump = c.createOscillator();
    const thumpGain = c.createGain();
    thump.type = 'triangle';
    thump.frequency.setValueAtTime(150, event.time);
    thump.frequency.exponentialRampToValueAtTime(40, event.time + 0.08);
    thumpGain.gain.setValueAtTime(peak * 1.2, event.time);
    thumpGain.gain.exponentialRampToValueAtTime(0.001, event.time + 0.1);
    thump.connect(thumpGain);
    thumpGain.connect(out);
    thump.start(event.time);
    thump.stop(event.time + 0.105);
    keep(thump, thumpGain);
  }

  /** Hands the audio clock every note due within the look-ahead, starting the loop over as needed. */
  function tick(): void {
    const c = ctx;
    if (!c || !playing || master === null) return;
    const horizon = c.currentTime + LOOKAHEAD_S;
    for (;;) {
      if (next >= events.length) {
        if (events.length === 0) return;
        loopStart += loop;
        events = schedule(song, loopStart);
        next = 0;
      }
      const event = events[next];
      if (event === undefined || event.time >= horizon) return;
      next += 1;
      try {
        if (event.drum !== undefined) playDrum(c, master, event, event.drum);
        else playNote(c, master, event);
      } catch {
        // A note the browser refused is skipped; the rest play on.
      }
    }
  }

  /** Silences what is still sounding and takes the graph down. */
  function silence(): void {
    fade = null;
    for (const source of live) {
      try {
        source.stop();
      } catch {
        // Already stopped.
      }
      source.disconnect();
    }
    live.clear();
    master?.disconnect();
    master = null;
  }

  function start(c: AudioContext): void {
    if (playing) return;
    if (fade !== null) {
      clearTimeout(fade);
      silence();
    }
    const out = graph(c);
    out.gain.cancelScheduledValues(c.currentTime);
    out.gain.setValueAtTime(muted ? 0 : MASTER_GAIN, c.currentTime);
    loopStart = c.currentTime + 0.05;
    events = schedule(song, loopStart);
    next = 0;
    playing = true;
    timer = setInterval(tick, TICK_MS);
    tick();
    changed();
  }

  /** Ramps the master to `level` over `ms`, from wherever it is. */
  function level(target: number, ms: number): void {
    const c = ctx;
    if (!c || master === null) return;
    const gain = master.gain;
    const now = c.currentTime;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(target, now + ms / 1000);
  }

  return {
    get available() {
      return context() !== null;
    },
    get playing() {
      return playing;
    },
    get muted() {
      return muted;
    },
    async play() {
      const c = context();
      if (!c) return false;
      wanted = true;
      if (c.state === 'running') {
        start(c);
        return true;
      }
      // Suspended until the browser is satisfied there was a gesture: ask, and start when it
      // comes, whether now or at a later gesture. Chrome keeps the promise until then.
      const resumed = c.resume().then(
        () => {
          if (wanted && c.state === 'running') start(c);
        },
        () => {},
      );
      const waited = new Promise<void>((resolve) => setTimeout(resolve, RESUME_WAIT_MS));
      await Promise.race([resumed, waited]);
      return playing;
    },
    stop() {
      wanted = false;
      if (!playing && master === null) return;
      playing = false;
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
      level(0, FADE_OUT_MS);
      if (fade !== null) clearTimeout(fade);
      fade = setTimeout(silence, FADE_OUT_MS + 10);
      changed();
    },
    mute() {
      if (muted) return;
      muted = true;
      level(0, 20);
      changed();
    },
    unmute() {
      if (!muted) return;
      muted = false;
      level(MASTER_GAIN, 20);
      changed();
    },
  };
}
