import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ANCHOR_MARGIN_PX,
  LONG_OUTPUT_RATIO,
  MOMENTUM_MS,
  PIN_THRESHOLD_PX,
  reactToContent,
  scrollToEnd,
  stickToBottom,
  type ContentFacts,
} from './stickToBottom';

describe('reactToContent', () => {
  const facts: ContentFacts = { pinned: true, grew: true, touch: false, freshEntryHeight: null, viewHeight: 600 };

  it('follows new output to the bottom when the view was there', () => {
    expect(reactToContent(facts)).toBe('bottom');
    expect(reactToContent({ ...facts, freshEntryHeight: 590 }), 'long output on desktop').toBe('bottom');
  });

  it('offers the pill instead when the visitor has scrolled up, but only for more output', () => {
    expect(reactToContent({ ...facts, pinned: false })).toBe('pill');
    expect(reactToContent({ ...facts, pinned: false, grew: false })).toBe('none');
  });

  it('on touch, shows an output taller than three quarters of the screen from its start', () => {
    const touch = { ...facts, touch: true };
    expect(reactToContent({ ...touch, freshEntryHeight: 600 * LONG_OUTPUT_RATIO + 1 })).toBe('anchor');
    expect(reactToContent({ ...touch, freshEntryHeight: 600 * LONG_OUTPUT_RATIO })).toBe('bottom');
    expect(reactToContent({ ...touch, freshEntryHeight: null }), 'no new entry').toBe('bottom');
    expect(reactToContent({ ...touch, pinned: false, freshEntryHeight: 590 }), 'scrolled up').toBe('pill');
  });
});

/** Stands in for ResizeObserver: tests report size changes by hand. */
class FakeResizeObserver {
  static current: FakeResizeObserver | undefined;
  readonly targets = new Set<Element>();
  constructor(private readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.current = this;
  }
  observe(target: Element): void {
    this.targets.add(target);
  }
  unobserve(target: Element): void {
    this.targets.delete(target);
  }
  disconnect(): void {
    this.targets.clear();
  }
  /** Reports that these elements were resized; a content box is reported with its height. */
  resize(...entries: { target: Element; height: number }[]): void {
    const records = entries
      .filter(({ target }) => this.targets.has(target))
      .map(({ target, height }) => ({ target, contentRect: { height } }) as unknown as ResizeObserverEntry);
    if (records.length > 0) this.callback(records, this as unknown as ResizeObserver);
  }
}

/** A scroller with real-looking metrics: scrollTop is clamped to what the content allows. */
function scroller(main: HTMLElement, metrics: { view: number; content: number }) {
  let top = 0;
  const max = () => Math.max(0, metrics.content - metrics.view);
  Object.defineProperties(main, {
    clientHeight: { configurable: true, get: () => metrics.view },
    scrollHeight: { configurable: true, get: () => metrics.content },
    scrollTop: {
      configurable: true,
      get: () => top,
      set: (value: number) => {
        top = Math.min(max(), Math.max(0, value));
      },
    },
  });
  main.scrollTo = ((options: ScrollToOptions) => {
    main.scrollTop = options.top ?? top;
  }) as typeof main.scrollTo;
  main.getBoundingClientRect = () => ({ top: 0, height: metrics.view }) as DOMRect;
  return {
    metrics,
    /** The visitor scrolls to `to`. */
    scroll(to: number) {
      main.scrollTop = to;
      main.dispatchEvent(new Event('scroll'));
    },
    atBottom: () => top === max(),
  };
}

/** Places an entry at `top` in content coordinates with `height`. */
function place(entry: Element, main: HTMLElement, top: number, height: number): void {
  entry.getBoundingClientRect = () => ({ top: top - main.scrollTop, height }) as DOMRect;
}

describe('use:stickToBottom', () => {
  let main: HTMLElement;
  let content: HTMLElement;
  let log: HTMLElement;
  let pills: boolean[];
  let action: ReturnType<typeof stickToBottom> | undefined;
  let coarse = false;
  let reduce = false;

  const observer = () => {
    const current = FakeResizeObserver.current;
    if (!current) throw new Error('no ResizeObserver');
    return current;
  };

  function addEntry(top: number, height: number): HTMLElement {
    const entry = document.createElement('div');
    log.append(entry);
    place(entry, main, top, height);
    return entry;
  }

  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) =>
        ({ matches: query.includes('pointer: coarse') ? coarse : query.includes('reduce') ? reduce : false }) as MediaQueryList,
    );
    document.body.innerHTML = `
      <main>
        <div class="scrollback"><div role="log"></div><div class="prompt"><input /></div></div>
      </main>`;
    main = document.querySelector('main') as HTMLElement;
    content = document.querySelector('.scrollback') as HTMLElement;
    log = document.querySelector('[role="log"]') as HTMLElement;
    pills = [];
    coarse = false;
    reduce = false;
  });

  afterEach(() => {
    action?.destroy?.();
    action = undefined;
    FakeResizeObserver.current = undefined;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  function start(metrics: { view: number; content: number }) {
    const view = scroller(main, metrics);
    action = stickToBottom(main, { content: '.scrollback', entries: '[role="log"]', onpill: (v) => pills.push(v) });
    // Observation starts with a report of the current sizes, as in a browser.
    observer().resize({ target: main, height: metrics.view }, { target: content, height: metrics.content });
    return view;
  }

  /** New output: the content grows and the observer reports it. */
  function grow(view: ReturnType<typeof scroller>, to: number) {
    view.metrics.content = to;
    observer().resize({ target: content, height: to });
  }

  it('observes the scroller and its content', () => {
    start({ view: 600, content: 400 });
    expect([...observer().targets]).toEqual([main, content]);
  });

  it('follows new output to the bottom, instantly, while the view is at the bottom', () => {
    const view = start({ view: 600, content: 400 });
    grow(view, 1000);
    expect(main.scrollTop).toBe(400);

    // Within the threshold still counts as the bottom.
    view.scroll(400 - PIN_THRESHOLD_PX);
    grow(view, 1500);
    expect(view.atBottom()).toBe(true);
    expect(pills).toEqual([]);
  });

  it('leaves a visitor who scrolled up where they are, and offers the pill', () => {
    const view = start({ view: 600, content: 2000 });
    expect(view.atBottom()).toBe(true);

    view.scroll(500);
    grow(view, 2400);
    expect(main.scrollTop).toBe(500);
    expect(pills).toEqual([true]);

    // More output while the pill is up does not repeat it.
    grow(view, 2600);
    expect(pills).toEqual([true]);

    // Reaching the bottom, by the pill or by hand, puts it away.
    view.scroll(2000);
    expect(pills).toEqual([true, false]);
  });

  it('shows no pill when the content shrinks', () => {
    const view = start({ view: 600, content: 2000 });
    view.scroll(100);
    grow(view, 1500);
    expect(pills).toEqual([]);
  });

  // Scroll events run before ResizeObserver callbacks in a frame, so a scroll the visitor did
  // not make can arrive together with output the observer has not reported yet.
  describe('a scroll in the same frame as new output', () => {
    /** Fires the scroll event an engine queued, without the visitor scrolling. */
    const engineScroll = () => main.dispatchEvent(new Event('scroll'));

    it('the engine clamping scrollTop as the running line goes leaves the view following', () => {
      const view = start({ view: 600, content: 2000 });
      // The running line and the cancel button go; the shorter layout clamps the scroll.
      grow(view, 1952);
      main.scrollTop = 1352;
      // The output arrives before the clamp's scroll event is dispatched.
      view.metrics.content = 2600;
      engineScroll();
      observer().resize({ target: content, height: 2600 });
      expect(view.atBottom()).toBe(true);
      expect(pills).toEqual([]);
    });

    it('scroll anchoring leaves the view following', () => {
      const view = start({ view: 600, content: 2000 });
      view.metrics.content = 2600;
      main.scrollTop = 1440;
      engineScroll();
      observer().resize({ target: content, height: 2600 });
      expect(view.atBottom()).toBe(true);
      expect(pills).toEqual([]);
    });

    it('on touch, a long output is still anchored to its echo line', () => {
      coarse = true;
      const view = start({ view: 600, content: 2000 });
      const entry = addEntry(2000, 1000);
      view.metrics.content = 3000;
      main.scrollTop = 1440;
      engineScroll();
      observer().resize({ target: content, height: 3000 });
      expect(main.scrollTop).toBe(2000 - ANCHOR_MARGIN_PX);
      expect(entry.getBoundingClientRect().top).toBe(ANCHOR_MARGIN_PX);
      expect(pills).toEqual([]);
    });

    it('the visitor scrolling up with a wheel still leaves the view where they put it', () => {
      const view = start({ view: 600, content: 2000 });
      main.dispatchEvent(new WheelEvent('wheel', { deltaY: -1500 }));
      view.metrics.content = 2600;
      view.scroll(500);
      observer().resize({ target: content, height: 2600 });
      expect(main.scrollTop).toBe(500);
      expect(pills).toEqual([true]);
    });

    it('so does a flick, while it carries on after the finger lifts', () => {
      const now = vi.spyOn(performance, 'now').mockReturnValue(1000);
      const view = start({ view: 600, content: 2000 });
      main.dispatchEvent(new Event('touchstart'));
      main.dispatchEvent(new Event('touchmove'));
      main.dispatchEvent(new Event('touchend'));
      now.mockReturnValue(1000 + MOMENTUM_MS - 1);
      view.metrics.content = 2600;
      view.scroll(500);
      observer().resize({ target: content, height: 2600 });
      expect(main.scrollTop).toBe(500);
      expect(pills).toEqual([true]);
    });

    it('a tap is not a scroll, and a flick is over once the momentum is', () => {
      const now = vi.spyOn(performance, 'now').mockReturnValue(1000);
      const view = start({ view: 600, content: 2000 });
      main.dispatchEvent(new Event('touchstart'));
      main.dispatchEvent(new Event('touchend'));
      view.metrics.content = 2600;
      main.scrollTop = 1440;
      engineScroll();
      observer().resize({ target: content, height: 2600 });
      expect(view.atBottom()).toBe(true);

      main.dispatchEvent(new Event('touchstart'));
      main.dispatchEvent(new Event('touchmove'));
      main.dispatchEvent(new Event('touchend'));
      now.mockReturnValue(1000 + MOMENTUM_MS + 1);
      view.metrics.content = 3200;
      main.scrollTop = 2040;
      engineScroll();
      observer().resize({ target: content, height: 3200 });
      expect(view.atBottom()).toBe(true);
      expect(pills).toEqual([]);
    });

    it('dragging the scrollbar counts as the visitor scrolling', () => {
      const view = start({ view: 600, content: 2000 });
      main.dispatchEvent(new Event('pointerdown'));
      view.metrics.content = 2600;
      view.scroll(500);
      observer().resize({ target: content, height: 2600 });
      window.dispatchEvent(new Event('pointerup'));
      expect(main.scrollTop).toBe(500);
      expect(pills).toEqual([true]);
    });
  });

  it('keeps the bottom in view when the screen shrinks for the keyboard', () => {
    const view = start({ view: 600, content: 2000 });
    view.metrics.view = 300;
    observer().resize({ target: main, height: 300 });
    expect(view.atBottom()).toBe(true);

    // Scrolled up, the bottom edge of what was visible stays put.
    view.scroll(1000);
    view.metrics.view = 600;
    observer().resize({ target: main, height: 600 });
    view.metrics.view = 300;
    observer().resize({ target: main, height: 300 });
    expect(main.scrollTop).toBe(1300);
    expect(pills).toEqual([]);
  });

  it('on touch, shows a long new output from its echo line', () => {
    coarse = true;
    const view = start({ view: 600, content: 300 });
    addEntry(0, 300);
    grow(view, 500);

    const help = addEntry(500, 1000);
    grow(view, 1500);
    expect(main.scrollTop).toBe(500 - ANCHOR_MARGIN_PX);
    expect(pills).toEqual([]);

    // Later changes leave it there, and offer the way down.
    place(help, main, 500, 1000);
    grow(view, 1520);
    expect(main.scrollTop).toBe(500 - ANCHOR_MARGIN_PX);
    expect(pills).toEqual([true]);
  });

  it('on touch, anchors an entry when its streaming output grows past three quarters of the screen, once', () => {
    coarse = true;
    const view = start({ view: 600, content: 500 });
    // The line is on the screen at once, with nothing under it yet: followed.
    const entry = addEntry(500, 40);
    grow(view, 540);
    expect(view.atBottom()).toBe(true);
    // Its output arrives, a frame at a time.
    place(entry, main, 500, 300);
    grow(view, 800);
    expect(view.atBottom()).toBe(true);
    place(entry, main, 500, 900);
    grow(view, 1400);
    expect(main.scrollTop).toBe(500 - ANCHOR_MARGIN_PX);
    // More of it leaves the view where it is, and offers the way down.
    place(entry, main, 500, 1200);
    grow(view, 1700);
    expect(main.scrollTop).toBe(500 - ANCHOR_MARGIN_PX);
    expect(pills).toEqual([true]);
  });

  it('on touch, follows a short new output to the bottom, and never re-anchors an old one', () => {
    coarse = true;
    const view = start({ view: 600, content: 500 });
    addEntry(500, 300);
    grow(view, 800);
    expect(view.atBottom()).toBe(true);

    // The keyboard makes the same entry taller than three quarters of the screen.
    view.metrics.view = 300;
    observer().resize({ target: main, height: 300 });
    grow(view, 820);
    expect(view.atBottom()).toBe(true);
  });

  it('on a fine pointer, follows even a long output to the bottom', () => {
    const view = start({ view: 600, content: 500 });
    addEntry(500, 1000);
    grow(view, 1500);
    expect(view.atBottom()).toBe(true);
  });

  it('goes back to the bottom when a line is submitted or typed at the prompt', () => {
    const input = main.querySelector('input') as HTMLInputElement;
    const view = start({ view: 600, content: 2000 });

    view.scroll(200);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    grow(view, 2100);
    expect(view.atBottom()).toBe(true);

    view.scroll(200);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(view.atBottom()).toBe(true);

    // Enter while an input method is composing is not a submit.
    view.scroll(200);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, isComposing: true }));
    grow(view, 2200);
    expect(main.scrollTop).toBe(200);
  });

  it('stops once destroyed', () => {
    const view = start({ view: 600, content: 2000 });
    action?.destroy?.();
    action = undefined;
    expect(observer().targets.size).toBe(0);
    view.scroll(200);
    main.querySelector('input')?.dispatchEvent(new Event('input', { bubbles: true }));
    expect(main.scrollTop).toBe(200);
  });
});

describe('scrollToEnd', () => {
  afterEach(() => vi.restoreAllMocks());

  function scrolled(reduce: boolean): ScrollToOptions | undefined {
    vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({ matches: reduce && query.includes('reduce') }) as MediaQueryList);
    const el = document.createElement('main');
    Object.defineProperty(el, 'scrollHeight', { value: 900 });
    let options: ScrollToOptions | undefined;
    el.scrollTo = ((o: ScrollToOptions) => {
      options = o;
    }) as typeof el.scrollTo;
    scrollToEnd(el);
    return options;
  }

  it('scrolls smoothly, or instantly for visitors who prefer reduced motion', () => {
    expect(scrolled(false)).toEqual({ top: 900, behavior: 'smooth' });
    expect(scrolled(true)).toEqual({ top: 900, behavior: 'auto' });
  });
});
