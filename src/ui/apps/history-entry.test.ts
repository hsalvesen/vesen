// One history entry for each full-screen view (history-entry.ts): Back off it closes the view, or
// gives the entry back while the view asks something; a view that closes itself goes back once,
// and that popstate is not the visitor's Back; a view opened while that Back is on its way pushes
// only once it has landed, since a browser may undo a push made before it.
import { describe, expect, it, vi } from 'vitest';
import { createHistoryEntries, HISTORY_KEY, OWN_BACK_WAIT_MS, type HistoryHost } from './history-entry';

/**
 * A browser's session history for one document. The page's own back() lands only when the test
 * says (`land`), as a real traversal lands a task or more later; the visitor's Back (`visitorBack`)
 * lands at once.
 */
function browser() {
  const entries: unknown[] = [null];
  let index = 0;
  let pending = 0;
  const listeners: (() => void)[] = [];
  const timers: (() => void)[] = [];
  const pushState = vi.fn((state: unknown, _unused: string, url?: string) => {
    void url;
    entries.splice(index + 1, entries.length, state);
    index += 1;
  });
  const back = vi.fn(() => {
    pending += 1;
  });
  const go = (delta: number): void => {
    const next = index + delta;
    if (next < 0 || next >= entries.length) return;
    index = next;
    for (const listener of listeners) listener();
  };
  const host: HistoryHost = {
    history: {
      get state() {
        return entries[index];
      },
      pushState,
      back,
    } as HistoryHost['history'],
    addEventListener: (_type, listener) => listeners.push(listener),
    setTimeout: (run) => timers.push(run),
    clearTimeout: () => {},
  };
  return {
    host,
    pushState,
    back,
    /** The page's own back() calls land, each with its popstate. */
    land(): void {
      for (; pending > 0; pending -= 1) go(-1);
    },
    visitorBack: () => go(-1),
    visitorForward: () => go(1),
    /** The page's own timers run. */
    runTimers(): void {
      for (const run of timers.splice(0)) run();
    },
    get index() {
      return index;
    },
    get length() {
      return entries.length;
    },
    get state() {
      return entries[index];
    },
  };
}

const ours = (state: unknown): boolean => typeof state === 'object' && state !== null && typeof (state as Record<string, unknown>)[HISTORY_KEY] === 'string';

describe('history entries for full-screen views', () => {
  it('pushes one entry with no URL of its own when a view opens', () => {
    const page = browser();
    createHistoryEntries(page.host).hold(() => {});
    expect(page.pushState).toHaveBeenCalledTimes(1);
    expect(page.pushState.mock.calls[0]![1]).toBe('');
    expect(page.pushState.mock.calls[0]![2]).toBeUndefined();
    expect(ours(page.state)).toBe(true);
  });

  it("closes the view on the visitor's Back, without going back again", () => {
    const page = browser();
    const entries = createHistoryEntries(page.host);
    let entry = { release() {} };
    const onBack = vi.fn(() => entry.release());
    entry = entries.hold(onBack);
    page.visitorBack();
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(page.back).not.toHaveBeenCalled();
    // Nothing is pushed again for a view that closed.
    expect(page.pushState).toHaveBeenCalledTimes(1);
    expect(page.index).toBe(0);
  });

  it('gives the entry back to a view that stays open, so the next Back is caught too, and takes it off once when it closes', () => {
    const page = browser();
    const entries = createHistoryEntries(page.host);
    const onBack = vi.fn();
    const entry = entries.hold(onBack);
    page.visitorBack();
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(page.pushState).toHaveBeenCalledTimes(2);
    expect(page.index).toBe(1);
    page.visitorBack();
    expect(onBack).toHaveBeenCalledTimes(2);
    expect(page.index).toBe(1);

    // It closes itself: one back(), whose popstate is not the visitor's.
    entry.release();
    entry.release();
    expect(page.back).toHaveBeenCalledTimes(1);
    page.land();
    expect(onBack).toHaveBeenCalledTimes(2);
    expect(page.index).toBe(0);
  });

  it('goes back once when a view closes itself, and only while its entry is the current one', () => {
    const page = browser();
    const entries = createHistoryEntries(page.host);
    const first = entries.hold(() => {});
    first.release();
    expect(page.back).toHaveBeenCalledTimes(1);
    page.land();
    expect(page.index).toBe(0);

    // Something else pushed over it: the history is left alone.
    const second = entries.hold(() => {});
    page.host.history.pushState({ other: true }, '');
    second.release();
    expect(page.back).toHaveBeenCalledTimes(1);
  });

  it("waits for a view's own Back to land before the next view pushes, and Back then closes the new one", () => {
    const page = browser();
    const entries = createHistoryEntries(page.host);
    const firstBack = vi.fn();
    entries.hold(firstBack).release();
    let second = { release() {} };
    const secondBack = vi.fn(() => second.release());
    second = entries.hold(secondBack);
    // Not yet: the first one's Back has not landed.
    expect(page.pushState).toHaveBeenCalledTimes(1);
    page.land();
    expect(page.pushState).toHaveBeenCalledTimes(2);
    expect(page.index).toBe(1);
    expect(firstBack).not.toHaveBeenCalled();
    expect(secondBack).not.toHaveBeenCalled();

    page.visitorBack();
    expect(secondBack).toHaveBeenCalledTimes(1);
    expect(firstBack).not.toHaveBeenCalled();
    expect(page.index).toBe(0);
  });

  it('never pushes for a view that closed while it waited', () => {
    const page = browser();
    const entries = createHistoryEntries(page.host);
    entries.hold(() => {}).release();
    entries.hold(() => {}).release();
    page.land();
    expect(page.pushState).toHaveBeenCalledTimes(1);
    expect(page.back).toHaveBeenCalledTimes(1);
    expect(page.index).toBe(0);
  });

  it("stops waiting when the view's own Back never lands", () => {
    const page = browser();
    const entries = createHistoryEntries(page.host);
    entries.hold(() => {}).release();
    entries.hold(() => {});
    expect(page.pushState).toHaveBeenCalledTimes(1);
    expect(OWN_BACK_WAIT_MS).toBeGreaterThan(0);
    page.runTimers();
    expect(page.pushState).toHaveBeenCalledTimes(2);
  });

  it('takes Forward back off the entry of a view that has closed, so the next Back leaves', () => {
    const page = browser();
    const entries = createHistoryEntries(page.host);
    let entry = { release() {} };
    const onBack = vi.fn(() => entry.release());
    entry = entries.hold(onBack);
    page.visitorBack();
    page.visitorForward();
    // Nothing holds that entry now: the page goes back off it once, and that popstate is its own.
    expect(page.back).toHaveBeenCalledTimes(1);
    page.land();
    expect(page.index).toBe(0);
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(page.pushState).toHaveBeenCalledTimes(1);
  });

  describe('an entry the page starts on, which no view holds (a reload, or Back to a page left with a view open)', () => {
    /** The page as a reload finds it: its last entry is one an earlier page's view held. */
    function reloaded(strays = 1) {
      const page = browser();
      for (let i = 0; i < strays; i += 1) page.host.history.pushState({ [HISTORY_KEY]: `old-${i}` }, '');
      page.pushState.mockClear();
      return page;
    }

    it('comes off with one Back of its own, so the next Back leaves vesen', () => {
      const page = reloaded();
      const entries = createHistoryEntries(page.host);
      entries.dropStray();
      entries.dropStray();
      expect(page.back).toHaveBeenCalledTimes(1);
      page.land();
      expect(page.index).toBe(0);
      expect(page.pushState).not.toHaveBeenCalled();
    });

    it('takes off every stray entry under it too, one at a time', () => {
      const page = reloaded(2);
      const entries = createHistoryEntries(page.host);
      entries.dropStray();
      expect(page.back).toHaveBeenCalledTimes(1);
      // The first lands on the second, which goes too.
      page.land();
      expect(page.back).toHaveBeenCalledTimes(2);
      expect(page.index).toBe(0);
    });

    it("lets a view opened meanwhile wait for that Back, and its own Back still closes it", () => {
      const page = reloaded();
      const entries = createHistoryEntries(page.host);
      entries.dropStray();
      let entry = { release() {} };
      const onBack = vi.fn(() => entry.release());
      entry = entries.hold(onBack);
      expect(page.pushState).not.toHaveBeenCalled();
      page.land();
      expect(page.pushState).toHaveBeenCalledTimes(1);
      expect(page.index).toBe(1);
      expect(onBack).not.toHaveBeenCalled();
      page.visitorBack();
      expect(onBack).toHaveBeenCalledTimes(1);
      expect(page.index).toBe(0);
    });

    it("leaves alone an entry that is not vesen's, and one a view holds", () => {
      const page = browser();
      page.host.history.pushState({ other: true }, '');
      const entries = createHistoryEntries(page.host);
      entries.dropStray();
      expect(page.back).not.toHaveBeenCalled();
      entries.hold(() => {});
      entries.dropStray();
      expect(page.back).not.toHaveBeenCalled();
    });
  });

  it("leaves Back to the page when the entry cannot be pushed", () => {
    const page = browser();
    page.pushState.mockImplementation(() => {
      throw new Error('SecurityError');
    });
    const onBack = vi.fn();
    const entry = createHistoryEntries(page.host).hold(onBack);
    entry.release();
    expect(page.back).not.toHaveBeenCalled();
    expect(onBack).not.toHaveBeenCalled();
  });
});
