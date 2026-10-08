// One history entry for each full-screen view that is open: a command's app in AppHost, or the QR
// card's Present mode. Back (Android's button, iOS's edge swipe, the browser's arrow) then leaves
// the view's entry rather than the page, so a visitor who came from Instagram's bio and opens
// man, nano or sl comes back to the prompt instead of leaving vesen.
//
// - Opening a view pushes an entry with no URL of its own, only `{ vesenApp: token }`.
// - Back off that entry calls the view's `onBack`, which closes it through its own close path. A
//   view that stays open (nano asking 'Save modified buffer?') gets its entry back, so the next
//   Back is caught too.
// - A view that closes itself takes its entry off with one history.back() of its own, only if
//   the entry is still the current one, and that popstate is not taken for the visitor's Back. A
//   view opened before it lands waits for it to push its own entry, as a push made while a
//   traversal is pending can land in either order.
// - An entry of vesen's that no open view holds comes off the same way, so Back never seems to do
//   nothing: the page starts on one after a reload (pull to refresh, a discarded tab reopened)
//   or after Back to a page left with a view open (`dropStrayEntry`, at boot), and Forward can
//   land on one a view left when it closed.
//
// Nothing else changes history: the Back snapshot (services/session-snapshot.ts) still comes
// back only when the page itself is reached by Back or Forward.

/** The key vesen's entries carry in history.state. */
export const HISTORY_KEY = 'vesenApp';

/** How long a view's own Back may take before the next view stops waiting for it. */
export const OWN_BACK_WAIT_MS = 1000;

/** A view's entry, while the view is open. */
export interface HistoryEntry {
  /** The view closed itself (or was taken down): its entry comes off the history. Idempotent. */
  release(): void;
}

/** What this module needs of the window; tests give a fake. */
export interface HistoryHost {
  readonly history: Pick<History, 'state' | 'pushState' | 'back'>;
  addEventListener(type: 'popstate', listener: () => void): void;
  setTimeout(run: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}

interface Entry {
  readonly token: string;
  readonly onBack: () => void;
  /** On the history now. */
  pushed: boolean;
  released: boolean;
}

export interface HistoryEntries {
  /** Adds an entry for a view that has just opened; `onBack` closes it, or asks first. */
  hold(onBack: () => void): HistoryEntry;
  /** Goes back off the current entry if it is vesen's and no open view holds it. */
  dropStray(): void;
}

let tokens = 0;

function newToken(): string {
  tokens += 1;
  return `${Date.now().toString(36)}-${tokens.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createHistoryEntries(host: HistoryHost): HistoryEntries {
  /** The views open now, oldest first. */
  const open: Entry[] = [];
  /** Views waiting for a view's own Back to land before they push. */
  let waiting: Entry[] = [];
  /** The token of the entry a view's own Back is leaving, until the popstate comes. */
  let leaving: string | null = null;
  let leavingTimer: unknown = null;
  let listening = false;

  function current(): string | null {
    const state: unknown = host.history.state;
    if (typeof state !== 'object' || state === null) return null;
    const token = (state as Record<string, unknown>)[HISTORY_KEY];
    return typeof token === 'string' ? token : null;
  }

  function push(entry: Entry): void {
    try {
      host.history.pushState({ [HISTORY_KEY]: entry.token }, '');
      entry.pushed = true;
    } catch {
      // A sandboxed frame, or too many entries: Back is the page's own, as before.
      entry.pushed = false;
    }
  }

  /** A view's own Back has landed (or never will): the views waiting for it push. */
  function landed(): void {
    leaving = null;
    if (leavingTimer !== null) host.clearTimeout(leavingTimer);
    leavingTimer = null;
    const ready = waiting.filter((entry) => !entry.released);
    waiting = [];
    for (const entry of ready) push(entry);
  }

  /** Whether a view's own Back is still on its way: its entry is still the current one. */
  function inFlight(): boolean {
    if (leaving === null) return false;
    if (current() === leaving) return true;
    // It landed without a popstate this module saw.
    landed();
    return false;
  }

  function listen(): void {
    if (listening) return;
    host.addEventListener('popstate', onPopState);
    listening = true;
  }

  /** Goes back once from an entry of vesen's that no open view holds, as a view's own Back. */
  function dropStray(): void {
    const now = current();
    if (now === null || leaving !== null || open.some((entry) => entry.pushed && entry.token === now)) return;
    listen();
    leaving = now;
    leavingTimer = host.setTimeout(landed, OWN_BACK_WAIT_MS);
    host.history.back();
  }

  function onPopState(): void {
    if (leaving !== null) {
      // The popstate of a view's own Back: not the visitor's. Another stray under it goes too.
      if (current() !== leaving) {
        landed();
        dropStray();
      }
      return;
    }
    const now = current();
    // From the newest view down, each one whose entry Back has left closes, or asks first.
    for (const entry of open.slice().reverse()) {
      if (!entry.pushed) continue;
      if (entry.token === now) break;
      entry.pushed = false;
      entry.onBack();
      if (!entry.released) push(entry);
    }
    // Forward onto the entry of a view that has closed, or Back onto one left under another.
    dropStray();
  }

  function release(entry: Entry): void {
    if (entry.released) return;
    entry.released = true;
    const at = open.indexOf(entry);
    if (at !== -1) open.splice(at, 1);
    waiting = waiting.filter((other) => other !== entry);
    // Never pushed, or Back has already taken it off.
    if (!entry.pushed) return;
    entry.pushed = false;
    // Something else is on top of it: leave the history alone rather than go back past that.
    if (current() !== entry.token) return;
    leaving = entry.token;
    leavingTimer = host.setTimeout(landed, OWN_BACK_WAIT_MS);
    host.history.back();
  }

  return {
    hold(onBack) {
      listen();
      const entry: Entry = { token: newToken(), onBack, pushed: false, released: false };
      open.push(entry);
      if (inFlight()) waiting.push(entry);
      else push(entry);
      return { release: () => release(entry) };
    },
    dropStray,
  };
}

let shared: HistoryEntries | null = null;

/** An entry on the page's own history for a view that has just opened. */
export function holdHistoryEntry(onBack: () => void): HistoryEntry {
  if (typeof window === 'undefined') return { release() {} };
  shared ??= createHistoryEntries(window);
  return shared.hold(onBack);
}

/**
 * At boot: a page reloaded, or reached by Back or Forward, while a view was open starts on that
 * view's entry, which nothing holds now; it comes off, so one Back leaves vesen again.
 */
export function dropStrayEntry(): void {
  if (typeof window === 'undefined') return;
  shared ??= createHistoryEntries(window);
  shared.dropStray();
}
