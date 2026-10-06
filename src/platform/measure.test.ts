// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyInputScale, INPUT_FONT_PX, inputScale, plainInputRequested, startMeasuring } from './measure';

interface HappyDOMApi {
  setURL(url: string): void;
}
const happyDOM = (globalThis as unknown as { happyDOM: HappyDOMApi }).happyDOM;

const root = document.documentElement;
const scale = () => root.style.getPropertyValue('--input-scale');
const plain = () => root.classList.contains('input-plain');

/** A FontFaceSet whose `ready` resolves when told to, and which can dispatch loadingdone. */
class FakeFonts extends EventTarget {
  private resolveReady: () => void = () => {};
  readonly ready = new Promise<void>((resolve) => {
    this.resolveReady = resolve;
  });
  finishLoading(): void {
    this.resolveReady();
  }
}

let frames: FrameRequestCallback[] = [];
const flushFrames = () => {
  const pending = frames;
  frames = [];
  for (const callback of pending) callback(0);
};

beforeEach(() => {
  happyDOM.setURL('https://www.vesen.app/');
  document.body.style.fontSize = '13px';
  frames = [];
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => frames.push(callback));
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(document, 'fonts');
  root.removeAttribute('style');
  root.removeAttribute('class');
  document.body.removeAttribute('style');
});

describe('inputScale', () => {
  it('draws the real 16px input at the terminal size', () => {
    expect(INPUT_FONT_PX).toBe(16);
    expect(inputScale(13, false)).toBe(0.8125);
    expect(inputScale(14, false)).toBe(0.875);
    expect(inputScale(16, false)).toBe(1);
    expect(inputScale(15.5, false)).toBe(0.9688);
  });

  it('is 1 when switched off or when the size is unknown', () => {
    expect(inputScale(13, true)).toBe(1);
    for (const px of [Number.NaN, 0, -13, Number.POSITIVE_INFINITY]) expect(inputScale(px, false), String(px)).toBe(1);
  });
});

describe('plainInputRequested', () => {
  it('honours ?input=plain and nothing else in the query', () => {
    expect(plainInputRequested('?input=plain', '')).toBe(true);
    expect(plainInputRequested('?debug=1&input=plain', '')).toBe(true);
    expect(plainInputRequested('?input=scaled', '')).toBe(false);
    expect(plainInputRequested('', '')).toBe(false);
  });

  it('honours --input-scale-off set to anything but an off value', () => {
    expect(plainInputRequested('', ' 1')).toBe(true);
    expect(plainInputRequested('', 'true')).toBe(true);
    for (const off of ['', ' ', '0', 'false', 'none']) expect(plainInputRequested('', off), JSON.stringify(off)).toBe(false);
  });
});

describe('applyInputScale', () => {
  it('reads the terminal size from the body and writes the scale onto <html>', () => {
    expect(applyInputScale(window)).toBe(0.8125);
    expect(scale()).toBe('0.8125');
    expect(plain()).toBe(false);
  });

  it('writes 1 and the input-plain class when the kill switch is on', () => {
    root.style.setProperty('--input-scale-off', '1');
    expect(applyInputScale(window)).toBe(1);
    expect(scale()).toBe('1');
    expect(plain()).toBe(true);

    root.style.removeProperty('--input-scale-off');
    applyInputScale(window);
    expect(plain()).toBe(false);
  });
});

describe('startMeasuring', () => {
  it('measures at once, and again after a resize, at most once a frame', () => {
    const stop = startMeasuring(window);
    expect(scale()).toBe('0.8125');

    document.body.style.fontSize = '14px';
    window.dispatchEvent(new Event('resize'));
    window.dispatchEvent(new Event('resize'));
    expect(frames).toHaveLength(1);
    flushFrames();
    expect(scale()).toBe('0.875');
    stop();
  });

  it('measures again when the page loads, when fonts are ready and when one finishes loading', async () => {
    const fonts = new FakeFonts();
    Object.defineProperty(document, 'fonts', { configurable: true, value: fonts });
    const stop = startMeasuring(window);

    document.body.style.fontSize = '16px';
    window.dispatchEvent(new Event('load'));
    flushFrames();
    expect(scale()).toBe('1');

    document.body.style.fontSize = '14px';
    fonts.finishLoading();
    await fonts.ready;
    flushFrames();
    expect(scale()).toBe('0.875');

    document.body.style.fontSize = '13px';
    fonts.dispatchEvent(new Event('loadingdone'));
    flushFrames();
    expect(scale()).toBe('0.8125');
    stop();
  });

  it('keeps a plain 16px input with ?input=plain', () => {
    happyDOM.setURL('https://www.vesen.app/?input=plain');
    const stop = startMeasuring(window);
    expect(scale()).toBe('1');
    expect(plain()).toBe(true);
    stop();
  });

  it('stops listening when stopped', () => {
    const fonts = new FakeFonts();
    Object.defineProperty(document, 'fonts', { configurable: true, value: fonts });
    const stop = startMeasuring(window);
    stop();

    document.body.style.fontSize = '16px';
    window.dispatchEvent(new Event('resize'));
    window.dispatchEvent(new Event('load'));
    fonts.dispatchEvent(new Event('loadingdone'));
    flushFrames();
    expect(frames).toHaveLength(0);
    expect(scale()).toBe('0.8125');
  });
});
