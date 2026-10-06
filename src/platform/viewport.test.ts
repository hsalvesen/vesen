// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyViewport,
  computeViewport,
  dockMode,
  type VisibleArea,
  FOCUS_REMEASURE_MS,
  INITIAL_VIEWPORT,
  KEYBOARD_THRESHOLD_PX,
  startViewport,
  type Viewport,
  type ViewportSample,
} from './viewport';

/** A reading: the layout viewport, the visual viewport and whether a text field has focus. */
function sample(
  layout: [width: number, height: number],
  visual: { height: number; offsetTop?: number; scale?: number } | null,
  editing = false,
): ViewportSample {
  return {
    layoutWidth: layout[0],
    layoutHeight: layout[1],
    visual: visual && { height: visual.height, offsetTop: visual.offsetTop ?? 0, scale: visual.scale ?? 1 },
    editing,
  };
}

/** Folds a recorded sequence of readings, returning the viewport after each one. */
function replay(samples: readonly ViewportSample[], start: Viewport = INITIAL_VIEWPORT): Viewport[] {
  const seen: Viewport[] = [];
  let viewport = start;
  for (const next of samples) {
    viewport = computeViewport(next, viewport);
    seen.push(viewport);
  }
  return seen;
}

const shell = (v: Viewport | undefined) =>
  v?.state && { height: v.state.height, top: v.state.top, keyboard: v.state.keyboard, open: v.state.keyboardOpen };

describe('computeViewport', () => {
  it('follows the iOS keyboard, which shrinks and pans only the visual viewport', () => {
    // Instagram's in-app browser on a 6.1-inch iPhone: the layout viewport never changes.
    const layout: [number, number] = [390, 664];
    const states = replay([
      sample(layout, { height: 664 }),
      sample(layout, { height: 664 }, true), // focus: the keyboard has not started yet
      sample(layout, { height: 420 }, true), // animating in
      sample(layout, { height: 328 }, true), // open, with the accessory bar
      sample(layout, { height: 328, offsetTop: 120 }, true), // iOS pans the page to the input
      sample(layout, { height: 664, offsetTop: 120 }), // blur: the keyboard goes
      sample(layout, { height: 664 }), // and the pan is undone
    ]);

    expect(states.map(shell)).toEqual([
      { height: 664, top: 0, keyboard: 0, open: false },
      { height: 664, top: 0, keyboard: 0, open: false },
      { height: 420, top: 0, keyboard: 244, open: true },
      { height: 328, top: 0, keyboard: 336, open: true },
      { height: 328, top: 120, keyboard: 336, open: true },
      { height: 664, top: 120, keyboard: 0, open: false },
      { height: 664, top: 0, keyboard: 0, open: false },
    ]);
  });

  it('follows the Android keyboard, which shrinks the layout viewport too (resizes-content)', () => {
    const states = replay([
      sample([412, 915], { height: 915 }),
      sample([412, 915], { height: 915 }, true),
      sample([412, 500], { height: 500 }, true),
      sample([412, 915], { height: 915 }),
    ]);

    expect(states.map(shell)).toEqual([
      { height: 915, top: 0, keyboard: 0, open: false },
      { height: 915, top: 0, keyboard: 0, open: false },
      { height: 500, top: 0, keyboard: 415, open: true },
      { height: 915, top: 0, keyboard: 0, open: false },
    ]);
    expect(states[2]?.baseline.portrait).toBe(915);
  });

  it('does not take a toolbar showing or hiding for a keyboard', () => {
    const states = replay([
      sample([390, 664], { height: 664 }),
      sample([390, 664], { height: 664 - KEYBOARD_THRESHOLD_PX }, true),
      sample([390, 750], { height: 750 }, true), // the toolbar hides while typing
      sample([390, 750], { height: 600 }, true),
    ]);

    expect(states.map((v) => v.state?.keyboardOpen)).toEqual([false, false, false, false]);
    // A taller layout while typing raises the baseline it is measured against.
    expect(states[2]?.baseline.portrait).toBe(750);
    expect(states[3]?.state?.height).toBe(600);
  });

  it('counts a shrink as the keyboard only while a text field has focus', () => {
    const [state] = replay([sample([390, 664], { height: 300 })]);
    expect(state?.state).toMatchObject({ height: 300, keyboard: 0, keyboardOpen: false });
  });

  it('keeps a baseline for each orientation across rotation', () => {
    const states = replay([
      sample([390, 664], { height: 664 }),
      sample([844, 340], { height: 340 }), // rotated to landscape
      sample([844, 340], { height: 340 }, true),
      sample([844, 340], { height: 150 }, true), // the keyboard in landscape
      sample([390, 664], { height: 664 }), // back to portrait, unfocused
      sample([390, 664], { height: 328 }, true),
    ]);

    expect(states.map((v) => v.state?.orientation)).toEqual([
      'portrait',
      'landscape',
      'landscape',
      'landscape',
      'portrait',
      'portrait',
    ]);
    expect(states[3]?.state).toMatchObject({ height: 150, keyboard: 190, keyboardOpen: true });
    expect(states[5]?.baseline).toEqual({ portrait: 664, landscape: 340 });
    expect(states[5]?.state).toMatchObject({ keyboard: 336, keyboardOpen: true });
  });

  it('keeps the orientation while the Android keyboard makes the page wider than tall', () => {
    // A nearly square screen: the keyboard leaves the layout wider than it is tall.
    const states = replay([sample([700, 760], { height: 760 }), sample([700, 400], { height: 400 }, true)]);

    expect(states.map((v) => v.state?.orientation)).toEqual(['portrait', 'portrait']);
    expect(states[1]?.state).toMatchObject({ keyboard: 360, keyboardOpen: true });
  });

  it('holds the shell still while the page is pinch-zoomed, then tracks again', () => {
    const states = replay([
      sample([390, 664], { height: 664 }),
      sample([390, 664], { height: 332, offsetTop: 200, scale: 2 }),
      sample([390, 664], { height: 221, offsetTop: 300, scale: 3 }),
      sample([390, 664], { height: 664, scale: 1.005 }), // within rounding of 1
    ]);

    expect(states[1]?.state).toMatchObject({ height: 664, top: 0, zoomed: true });
    expect(states[2]?.state).toMatchObject({ height: 664, top: 0, zoomed: true });
    expect(states[3]?.state).toMatchObject({ height: 664, top: 0, zoomed: false });
  });

  it('writes nothing when zoomed from the start, or without visualViewport', () => {
    expect(replay([sample([390, 664], { height: 332, scale: 2 })])[0]?.state).toBeNull();
    expect(replay([sample([390, 664], null)])[0]).toEqual(INITIAL_VIEWPORT);
  });
});

describe('applyViewport', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('style');
    document.documentElement.removeAttribute('class');
  });

  it('writes the variables and the keyboard class, and clears them for the CSS fallback', () => {
    const root = document.documentElement;
    const [, open] = replay([sample([390, 664], { height: 664 }), sample([390, 664], { height: 328, offsetTop: 12 }, true)]);
    applyViewport(root, open?.state ?? null);

    expect(root.style.getPropertyValue('--app-h')).toBe('328px');
    expect(root.style.getPropertyValue('--app-top')).toBe('12px');
    expect(root.style.getPropertyValue('--kb-h')).toBe('336px');
    expect(root.classList.contains('kb-open')).toBe(true);

    applyViewport(root, null);
    expect(root.getAttribute('style') ?? '').toBe('');
    expect(root.classList.contains('kb-open')).toBe(false);
  });
});

/** A visualViewport that tests move by hand. */
class FakeVisualViewport extends EventTarget {
  height = 664;
  offsetTop = 0;
  scale = 1;
  set(values: Partial<Pick<FakeVisualViewport, 'height' | 'offsetTop' | 'scale'>>): void {
    Object.assign(this, values);
    this.dispatchEvent(new Event('resize'));
  }
}

describe('startViewport', () => {
  const root = document.documentElement;
  const height = () => root.style.getPropertyValue('--app-h');
  let frames: FrameRequestCallback[] = [];
  const flushFrames = () => {
    const pending = frames;
    frames = [];
    for (const callback of pending) callback(0);
  };
  let visual: FakeVisualViewport;
  let stop: (() => void) | undefined;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    frames = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => frames.push(callback));
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    visual = new FakeVisualViewport();
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: visual });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 664 });
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
  });

  afterEach(() => {
    stop?.();
    stop = undefined;
    vi.useRealTimers();
    vi.restoreAllMocks();
    Reflect.deleteProperty(window, 'visualViewport');
    Reflect.deleteProperty(window, 'innerHeight');
    Reflect.deleteProperty(window, 'innerWidth');
    root.removeAttribute('style');
    root.removeAttribute('class');
    document.body.innerHTML = '';
  });

  it('measures at once, then once a frame however many events arrive', () => {
    stop = startViewport(window);
    expect(height()).toBe('664px');

    visual.set({ height: 500 });
    visual.set({ height: 450 });
    expect(frames).toHaveLength(1);
    expect(height()).toBe('664px');

    flushFrames();
    expect(height()).toBe('450px');
  });

  it('measures again after focus moves, while the keyboard animates', () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) => ({ matches: query === '(any-pointer: coarse)' }) as MediaQueryList,
    );
    const input = document.createElement('input');
    document.body.append(input);
    stop = startViewport(window);

    input.focus();
    visual.height = 328; // the keyboard opened without a resize event reaching the page
    flushFrames();
    expect(root.classList.contains('kb-open')).toBe(true);
    expect(height()).toBe('328px');

    input.blur();
    visual.height = 664;
    for (const delay of FOCUS_REMEASURE_MS) {
      vi.advanceTimersByTime(delay);
      flushFrames();
    }
    expect(root.classList.contains('kb-open')).toBe(false);
    expect(height()).toBe('664px');
  });

  it('never takes a shorter desktop window for a keyboard', () => {
    const input = document.createElement('input');
    document.body.append(input);
    stop = startViewport(window);

    input.focus();
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 300 });
    visual.set({ height: 300 });
    flushFrames();
    expect(height()).toBe('300px');
    expect(root.classList.contains('kb-open')).toBe(false);
    expect(root.style.getPropertyValue('--kb-h')).toBe('0px');
  });

  it('leaves the shell alone while the page is zoomed', () => {
    stop = startViewport(window);
    visual.set({ height: 332, offsetTop: 100, scale: 2 });
    flushFrames();
    expect(height()).toBe('664px');
    expect(root.style.getPropertyValue('--app-top')).toBe('0px');
  });

  it('tells the dock the visible height and the keyboard, at once and on each change', () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) => ({ matches: query === '(any-pointer: coarse)' }) as MediaQueryList,
    );
    const heard: VisibleArea[] = [];
    stop = startViewport(window, { onChange: (area) => heard.push(area) });
    expect(heard).toEqual([{ height: 664, keyboardOpen: false }]);

    const input = document.body.appendChild(document.createElement('input'));
    input.focus();
    visual.set({ height: 330 });
    flushFrames();
    expect(heard[heard.length - 1]).toEqual({ height: 330, keyboardOpen: true });
    const count = heard.length;
    // The same reading again says nothing new; a zoom says nothing at all.
    visual.set({ height: 330 });
    flushFrames();
    visual.set({ height: 165, scale: 2 });
    flushFrames();
    expect(heard).toHaveLength(count);
  });

  it("reports the window's height where there is no visualViewport", () => {
    Reflect.deleteProperty(window, 'visualViewport');
    const heard: VisibleArea[] = [];
    stop = startViewport(window, { onChange: (area) => heard.push(area) });
    expect(heard).toEqual([{ height: 664, keyboardOpen: false }]);
  });

  it('stops listening, and writes nothing when there is no visualViewport', () => {
    stop = startViewport(window);
    stop();
    stop = undefined;
    visual.set({ height: 300 });
    expect(frames).toHaveLength(0);

    root.removeAttribute('style');
    Reflect.deleteProperty(window, 'visualViewport');
    stop = startViewport(window);
    expect(root.getAttribute('style')).toBeNull();
  });
});

describe('dockMode', () => {
  it('lays the dock out by the visible height: two rows, one row, or the keys only', () => {
    expect([1000, 460, 459, 300, 299, 120].map(dockMode)).toEqual(['full', 'full', 'compact', 'compact', 'minimal', 'minimal']);
    // Not measured yet: the full dock.
    expect(dockMode(0)).toBe('full');
    expect(dockMode(Number.NaN)).toBe('full');
  });
});
