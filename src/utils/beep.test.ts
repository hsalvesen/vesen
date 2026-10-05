import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Just enough of the Web Audio API for playBeep, counting what it creates. */
class FakeAudioContext {
  static instances = 0;
  state = 'running';
  currentTime = 0;
  destination = {};
  oscillators = 0;

  constructor() {
    FakeAudioContext.instances += 1;
  }

  resume() {
    return Promise.resolve();
  }

  createOscillator() {
    this.oscillators += 1;
    return {
      type: 'sine',
      frequency: { setValueAtTime: vi.fn() },
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      onended: null,
    };
  }

  createGain() {
    const param = { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() };
    return { gain: param, connect: vi.fn(), disconnect: vi.fn() };
  }
}

describe('playBeep', () => {
  beforeEach(() => {
    vi.resetModules();
    FakeAudioContext.instances = 0;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reuses a single AudioContext across rings', async () => {
    vi.stubGlobal('AudioContext', FakeAudioContext);
    const { playBeep } = await import('./beep');

    playBeep();
    playBeep();
    playBeep();

    expect(FakeAudioContext.instances).toBe(1);
  });

  it('stays silent without Web Audio', async () => {
    vi.stubGlobal('AudioContext', undefined);
    const { playBeep } = await import('./beep');

    expect(() => playBeep()).not.toThrow();
    expect(FakeAudioContext.instances).toBe(0);
  });
});
