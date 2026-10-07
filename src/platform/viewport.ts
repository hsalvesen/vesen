// Sizes the app shell to the part of the page the visitor can see. Phone toolbars and the soft
// keyboard hide the bottom of a 100vh page; window.visualViewport reports what is left. The
// controller writes three variables on <html>, which the shell (styles/shell.css) is positioned
// with, using top rather than a transform:
//   --app-h   the visible height
//   --app-top how far the visible area is panned down the page (iOS pans it to show the input)
//   --kb-h    the soft keyboard's height, 0 when it is closed
// and the class kb-open while the keyboard is open. Without visualViewport nothing is written,
// and the shell falls back to 100dvh, then 100vh. computeViewport is the pure core.

export type Orientation = 'portrait' | 'landscape';

/** One reading of the page. */
export interface ViewportSample {
  /** window.innerWidth and innerHeight: the layout viewport. */
  readonly layoutWidth: number;
  readonly layoutHeight: number;
  /** window.visualViewport, or null where the browser has none. */
  readonly visual: { readonly height: number; readonly offsetTop: number; readonly scale: number } | null;
  /** True while a text field has focus, which is when the soft keyboard can be open. */
  readonly editing: boolean;
}

/** What the shell is sized to. */
export interface ViewportState {
  readonly height: number;
  readonly top: number;
  readonly keyboard: number;
  readonly keyboardOpen: boolean;
  /** Pinch zoom is active, and the state is held where it was before the zoom. */
  readonly zoomed: boolean;
  readonly orientation: Orientation;
  /** The layout width the orientation was decided at; the keyboard never changes it. */
  readonly width: number;
}

/** The tallest the page has been with no keyboard open, for each orientation. */
export interface Baseline {
  readonly portrait: number;
  readonly landscape: number;
}

export interface Viewport {
  /** Null until there is something to write: no visualViewport, or zoomed from the start. */
  readonly state: ViewportState | null;
  readonly baseline: Baseline;
}

/** How the phone dock lays itself out for the visible height. */
export type DockMode = 'full' | 'compact' | 'minimal';

/** At least this tall: the dock's two rows, chips over keys. */
export const DOCK_FULL_MIN_PX = 460;
/** At least this tall: one row, three keys then the chips. Shorter: the keys only. */
export const DOCK_COMPACT_MIN_PX = 300;

/** The dock's layout for a visible height; full while the height is unknown (0). */
export function dockMode(height: number): DockMode {
  if (!(height > 0) || height >= DOCK_FULL_MIN_PX) return 'full';
  return height >= DOCK_COMPACT_MIN_PX ? 'compact' : 'minimal';
}

/** What the rest of the app hears of the viewport: the visible height, and the keyboard. */
export interface VisibleArea {
  readonly height: number;
  readonly keyboardOpen: boolean;
}

/** A shrink smaller than this is a toolbar showing or hiding, not a keyboard. */
export const KEYBOARD_THRESHOLD_PX = 150;
/** Further from 1 than this, the page is pinch-zoomed. */
export const ZOOM_EPSILON = 0.01;

export const INITIAL_VIEWPORT: Viewport = { state: null, baseline: { portrait: 0, landscape: 0 } };

function orientationOf(sample: ViewportSample, previous: ViewportState | null): Orientation {
  // A keyboard on Android shrinks the layout height but never the width; only rotation (or a
  // window resize) changes the width.
  if (previous && previous.width === sample.layoutWidth) return previous.orientation;
  return sample.layoutWidth > sample.layoutHeight ? 'landscape' : 'portrait';
}

/**
 * The next viewport from a new sample. Two keyboard models are covered: iOS (and WKWebView)
 * shrink only the visual viewport, while Android with interactive-widget=resizes-content (and a
 * WebView with adjustResize) shrink the layout viewport too. Either way the keyboard is the
 * baseline height minus the visible height, counted only while a text field has focus.
 */
export function computeViewport(sample: ViewportSample, previous: Viewport): Viewport {
  const { visual } = sample;
  if (visual === null) return { state: null, baseline: previous.baseline };

  // Pinch zoom: hold the shell where it was, so the zoom pans over a still page.
  if (Math.abs(visual.scale - 1) > ZOOM_EPSILON) {
    return {
      state: previous.state && (previous.state.zoomed ? previous.state : { ...previous.state, zoomed: true }),
      baseline: previous.baseline,
    };
  }

  const orientation = orientationOf(sample, previous.state);
  // Unfocused, the page has no keyboard, so its height is the baseline. Focused, the baseline
  // only grows: the layout can be taller than it was if a toolbar has since hidden.
  const current = previous.baseline[orientation];
  const baselineHeight = sample.editing ? Math.max(current, sample.layoutHeight) : sample.layoutHeight;
  const baseline = { ...previous.baseline, [orientation]: baselineHeight };

  const shrink = sample.editing ? baselineHeight - visual.height : 0;
  const keyboardOpen = shrink > KEYBOARD_THRESHOLD_PX;

  return {
    state: {
      height: visual.height,
      top: visual.offsetTop,
      keyboard: keyboardOpen ? shrink : 0,
      keyboardOpen,
      zoomed: false,
      orientation,
      width: sample.layoutWidth,
    },
    baseline,
  };
}

/**
 * The soft keyboard went away while a text field kept focus: Android's Back (or a keyboard's own
 * hide key) does this, where iOS blurs the field. It is the same layout width (not a rotation),
 * the visible height grew back, and the field still has focus.
 */
export function keyboardDismissed(previous: ViewportState | null, next: ViewportState | null, editing: boolean): boolean {
  return (
    editing &&
    previous !== null &&
    next !== null &&
    previous.keyboardOpen &&
    !next.keyboardOpen &&
    !next.zoomed &&
    previous.width === next.width &&
    next.height > previous.height
  );
}

/** Writes a state onto the root, or clears it so the CSS fallbacks apply. */
export function applyViewport(root: HTMLElement, state: ViewportState | null): void {
  if (state === null) {
    for (const name of ['--app-h', '--app-top', '--kb-h']) root.style.removeProperty(name);
    root.classList.remove('kb-open');
    return;
  }
  root.style.setProperty('--app-h', `${state.height}px`);
  root.style.setProperty('--app-top', `${state.top}px`);
  root.style.setProperty('--kb-h', `${state.keyboard}px`);
  root.classList.toggle('kb-open', state.keyboardOpen);
}

function isTextField(element: Element | null): boolean {
  if (element === null) return false;
  const tag = element.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || (element as HTMLElement).isContentEditable === true;
}

/** Re-measured this long after focus moves: keyboards animate in and out over a few frames. */
export const FOCUS_REMEASURE_MS = [50, 300, 600] as const;

export interface ViewportOptions {
  /** Where the variables go; <html> by default. */
  readonly root?: HTMLElement;
  /**
   * True while a soft keyboard can be open. By default, while a text field has focus on a device
   * with a touch screen; a desktop window made shorter is never a keyboard.
   */
  readonly isEditing?: () => boolean;
  /**
   * Hears each change of the visible height or the keyboard, and the first reading at once:
   * from visualViewport, or the window's height where there is none. Not while pinch-zoomed.
   */
  readonly onChange?: (area: VisibleArea) => void;
}

/** Tracks the visual viewport until the returned function is called. */
export function startViewport(win: Window, options: ViewportOptions = {}): () => void {
  const doc = win.document;
  const root = options.root ?? doc.documentElement;
  const isEditing =
    options.isEditing ??
    (() => isTextField(doc.activeElement) && (win.matchMedia?.('(any-pointer: coarse)').matches ?? false));
  // Read once: a test may stand in for it before the app starts.
  const visual = win.visualViewport ?? null;

  let viewport = INITIAL_VIEWPORT;
  let written: ViewportState | null | undefined;
  let heard: VisibleArea | null = null;
  let frame = 0;
  let timers: number[] = [];
  let stopped = false;

  const update = (): void => {
    frame = 0;
    if (stopped) return;
    const previous = viewport.state;
    const editing = isEditing();
    viewport = computeViewport(
      {
        layoutWidth: win.innerWidth,
        layoutHeight: win.innerHeight,
        visual: visual && { height: visual.height, offsetTop: visual.offsetTop, scale: visual.scale },
        editing,
      },
      viewport,
    );
    const next = viewport.state;
    // Zoomed, the shell stays where it was; otherwise only a change is written.
    if (next?.zoomed) return;
    // The keyboard was put away without a blur (Android's Back): blur, as iOS does, so the page
    // stops behaving as if typing, and a tap on the prompt opens the keyboard again.
    if (keyboardDismissed(previous, next, editing)) {
      const active = doc.activeElement;
      if (isTextField(active)) (active as HTMLElement).blur();
    }
    const area: VisibleArea = { height: next?.height ?? win.innerHeight, keyboardOpen: next?.keyboardOpen ?? false };
    if (heard === null || heard.height !== area.height || heard.keyboardOpen !== area.keyboardOpen) {
      heard = area;
      options.onChange?.(area);
    }
    if (sameState(next, written)) return;
    written = next;
    applyViewport(root, next);
  };
  const schedule = (): void => {
    if (!stopped && frame === 0) frame = win.requestAnimationFrame(update);
  };
  const clearTimers = (): void => {
    for (const timer of timers) win.clearTimeout(timer);
    timers = [];
  };
  const onFocusChange = (): void => {
    schedule();
    clearTimers();
    timers = FOCUS_REMEASURE_MS.map((delay) => win.setTimeout(schedule, delay));
  };
  const onFocusOut = (): void => {
    onFocusChange();
    // iOS can leave the page panned once the keyboard has gone; the page itself never scrolls.
    win.requestAnimationFrame(() => {
      if (!stopped && !viewport.state?.zoomed && win.scrollY !== 0) win.scrollTo(0, 0);
    });
  };

  update();
  visual?.addEventListener('resize', schedule);
  visual?.addEventListener('scroll', schedule);
  win.addEventListener('resize', schedule);
  win.addEventListener('orientationchange', schedule);
  doc.addEventListener('focusin', onFocusChange);
  doc.addEventListener('focusout', onFocusOut);

  return () => {
    stopped = true;
    win.cancelAnimationFrame(frame);
    clearTimers();
    visual?.removeEventListener('resize', schedule);
    visual?.removeEventListener('scroll', schedule);
    win.removeEventListener('resize', schedule);
    win.removeEventListener('orientationchange', schedule);
    doc.removeEventListener('focusin', onFocusChange);
    doc.removeEventListener('focusout', onFocusOut);
  };
}

function sameState(a: ViewportState | null, b: ViewportState | null | undefined): boolean {
  if (a === null || b === null || b === undefined) return a === b;
  return a.height === b.height && a.top === b.top && a.keyboard === b.keyboard && a.keyboardOpen === b.keyboardOpen;
}
