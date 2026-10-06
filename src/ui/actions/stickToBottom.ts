// The one scroll owner for the transcript (use:stickToBottom on <main>). When the content changes,
// the view follows it to the bottom only if the visitor was already there, within 40px; anyone
// who has scrolled up to read is left where they are and offered a '↓ New output' pill instead.
// On touch, an output taller than three quarters of the screen is shown from its echo line, so it
// reads from the start. When the screen itself shrinks (the soft keyboard opening), the bottom
// edge of the view stays put. Pressing Enter or typing in the prompt goes back to the bottom.
import type { ActionReturn } from 'svelte/action';

/** Within this many pixels of the bottom, the view follows new output. */
export const PIN_THRESHOLD_PX = 40;
/** On touch, an entry taller than this share of the screen is anchored to its echo line. */
export const LONG_OUTPUT_RATIO = 0.75;
/** Space left above an anchored echo line. */
export const ANCHOR_MARGIN_PX = 8;

export type ContentReaction = 'bottom' | 'anchor' | 'pill' | 'none';

export interface ContentFacts {
  /** The view was within PIN_THRESHOLD_PX of the bottom before the change. */
  readonly pinned: boolean;
  /** The content is taller than it was. */
  readonly grew: boolean;
  readonly touch: boolean;
  /** The last entry's height, the first time the content changes with it last; otherwise null. */
  readonly freshEntryHeight: number | null;
  /** The scroller's visible height. */
  readonly viewHeight: number;
}

/** What to do after the content changed size. */
export function reactToContent(facts: ContentFacts): ContentReaction {
  if (!facts.pinned) return facts.grew ? 'pill' : 'none';
  if (facts.touch && facts.freshEntryHeight !== null && facts.freshEntryHeight > facts.viewHeight * LONG_OUTPUT_RATIO) {
    return 'anchor';
  }
  return 'bottom';
}

export function distanceFromBottom(el: Element): number {
  return el.scrollHeight - el.scrollTop - el.clientHeight;
}

function prefersReducedMotion(win: Window | null): boolean {
  return win?.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

function coarsePointer(win: Window | null): boolean {
  return win?.matchMedia?.('(pointer: coarse)').matches ?? false;
}

/** Scrolls to the end: smoothly, unless the visitor prefers reduced motion. For the pill. */
export function scrollToEnd(el: HTMLElement): void {
  const reduce = prefersReducedMotion(el.ownerDocument.defaultView);
  el.scrollTo({ top: el.scrollHeight, behavior: reduce ? 'auto' : 'smooth' });
}

export interface StickToBottomOptions {
  /** The scrolling content inside the node; its size changes when output arrives. */
  readonly content?: string;
  /** The element whose children are the entries (an echo line and its output each). */
  readonly entries?: string;
  /** Shows or hides the '↓ New output' pill. */
  readonly onpill?: (visible: boolean) => void;
}

function isTextField(target: EventTarget | null): boolean {
  const tag = (target as Element | null)?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA';
}

export function stickToBottom(node: HTMLElement, options: StickToBottomOptions = {}): ActionReturn<StickToBottomOptions> {
  let opts = options;
  const win = node.ownerDocument.defaultView;
  let pinned = true;
  let pill = false;
  let viewHeight = node.clientHeight;
  let contentHeight = -1;
  // An entry is anchored, or not, once: when it first appears. Later changes (the keyboard
  // opening, a suggestion row) must not pull the view back up to it.
  let seen: Element | null = null;

  const setPill = (visible: boolean): void => {
    if (visible === pill) return;
    pill = visible;
    opts.onpill?.(visible);
  };
  const toBottom = (): void => {
    node.scrollTop = node.scrollHeight;
    pinned = true;
    setPill(false);
  };
  const onScroll = (): void => {
    pinned = distanceFromBottom(node) <= PIN_THRESHOLD_PX;
    if (pinned) setPill(false);
  };

  const content = (): Element | null => (opts.content ? node.querySelector(opts.content) : null);
  const lastEntry = (): Element | null => (opts.entries ? node.querySelector(opts.entries)?.lastElementChild ?? null : null);

  // Each report scrolls at most once: when the content changed too, the content decides where a
  // pinned view goes (the bottom, or a long output's first line).
  const viewResized = (contentToo: boolean): void => {
    const height = node.clientHeight;
    const shrink = viewHeight - height;
    viewHeight = height;
    if (pinned) {
      if (!contentToo) toBottom();
    }
    // Keep the bottom edge where it was, so whatever sat just above the keyboard still does.
    else if (shrink > 0) node.scrollTop += shrink;
  };

  const contentResized = (height: number): void => {
    const grew = height > contentHeight;
    contentHeight = height;
    const entry = lastEntry();
    const fresh = entry !== seen ? entry : null;
    seen = entry;
    const reaction = reactToContent({
      pinned,
      grew,
      touch: coarsePointer(win),
      freshEntryHeight: fresh ? fresh.getBoundingClientRect().height : null,
      viewHeight: node.clientHeight,
    });
    if (reaction === 'bottom') toBottom();
    else if (reaction === 'pill') setPill(true);
    else if (reaction === 'anchor' && fresh) {
      node.scrollTop += fresh.getBoundingClientRect().top - node.getBoundingClientRect().top - ANCHOR_MARGIN_PX;
      // Reading from the top of a long output is not being left behind by it.
      pinned = false;
    }
  };

  const observer =
    typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver((records) => {
          const contentRecord = records.find((record) => record.target !== node);
          if (records.some((record) => record.target === node)) viewResized(contentRecord !== undefined);
          if (contentRecord) contentResized(contentRecord.contentRect.height);
        });

  let observed: Element | null = null;
  const observe = (): void => {
    const next = content();
    if (next === observed || observer === null) return;
    if (observed) observer.unobserve(observed);
    observed = next;
    if (next) observer.observe(next);
  };

  // Enter in the prompt submits a line: its output is followed whatever the view was showing.
  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Enter' && !event.isComposing && isTextField(event.target)) pinned = true;
  };
  // Typing at the prompt brings it back into view, as in a terminal.
  const onInput = (event: Event): void => {
    if (!pinned && isTextField(event.target)) toBottom();
  };

  observer?.observe(node);
  observe();
  node.addEventListener('scroll', onScroll, { passive: true });
  node.addEventListener('keydown', onKeydown);
  node.addEventListener('input', onInput);

  return {
    update(next) {
      opts = next;
      observe();
    },
    destroy() {
      observer?.disconnect();
      node.removeEventListener('scroll', onScroll);
      node.removeEventListener('keydown', onKeydown);
      node.removeEventListener('input', onInput);
    },
  };
}
