// A stand-in for window.visualViewport that a test moves by hand: the soft keyboard opening,
// without a phone.
import type { Page } from '@playwright/test';

declare global {
  interface Window {
    /** Moves the stand-in visualViewport installed by fakeVisualViewport. */
    __vv?: { set(next: { height?: number; offsetTop?: number }): void };
  }
}

/** Replaces window.visualViewport, before the app starts, with one the test moves by hand. */
export async function fakeVisualViewport(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const events = new EventTarget();
    let height: number | null = null;
    let offsetTop = 0;
    const visual = {
      get height() {
        return height ?? window.innerHeight;
      },
      get width() {
        return window.innerWidth;
      },
      get offsetTop() {
        return offsetTop;
      },
      get pageTop() {
        return offsetTop;
      },
      offsetLeft: 0,
      pageLeft: 0,
      scale: 1,
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
      dispatchEvent: events.dispatchEvent.bind(events),
    };
    Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => visual });
    window.__vv = {
      set(next) {
        if (next.height !== undefined) height = next.height;
        if (next.offsetTop !== undefined) offsetTop = next.offsetTop;
        events.dispatchEvent(new Event('resize'));
      },
    };
  });
}
