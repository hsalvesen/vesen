// When a click or tap should put the caret in the prompt (use:focusPolicy on the app shell).
//
// A mouse click anywhere focuses the prompt without scrolling, unless the visitor was doing
// something else: double-clicking or dragging to select, or clicking a control. A touch tap
// focuses it only on the prompt row or the empty space under the last entry, because focusing
// opens the soft keyboard, and a visitor tapping output is reading, not typing. Printable keys
// pressed while nothing has focus go to the prompt, so the first character is not lost.
import type { ActionReturn } from 'svelte/action';

export type PointerKind = 'mouse' | 'touch' | 'pen';

/** Pointer movement beyond this between press and release is a drag (or a scroll), not a click. */
export const DRAG_PX: Readonly<Record<PointerKind, number>> = { mouse: 6, touch: 10, pen: 10 };

/** Clicks on these act for themselves. */
export const INTERACTIVE_SELECTOR = 'a, button, input, textarea, select, [data-interactive]';
/** Where a tap means "I want to type": the prompt row and the empty space below the last entry. */
export const PROMPT_AREA_SELECTOR = '[data-prompt-area]';

export interface TapFacts {
  readonly pointer: PointerKind;
  /** The click's detail: 2 or more for the later clicks of a double or triple click. */
  readonly clicks: number;
  /** How far the pointer moved between press and release, in CSS pixels. */
  readonly moved: number;
  /** The page has a non-empty selection after the click. */
  readonly selection: boolean;
  /** The click landed on or inside a link, button, form control or [data-interactive]. */
  readonly interactive: boolean;
  /** The click landed on the prompt row or the empty space below the last entry. */
  readonly promptArea: boolean;
}

export function shouldFocusOnTap(tap: TapFacts): boolean {
  if (tap.interactive || tap.selection || tap.clicks > 1 || tap.moved > DRAG_PX[tap.pointer]) return false;
  return tap.pointer === 'mouse' || tap.promptArea;
}

export interface KeyFacts {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly isComposing: boolean;
}

/** A key that types a character, rather than a shortcut, a modifier or a named key. */
export function isPrintableKey(event: KeyFacts): boolean {
  // One character, or one astral character (an emoji) as two UTF-16 units.
  return !event.ctrlKey && !event.metaKey && !event.altKey && !event.isComposing && [...event.key].length === 1;
}

function pointerKind(type: string | undefined): PointerKind {
  return type === 'touch' || type === 'pen' ? type : 'mouse';
}

export interface FocusPolicyOptions {
  /** The prompt's input. */
  readonly input: () => HTMLInputElement | null | undefined;
}

export function focusPolicy(node: HTMLElement, options: FocusPolicyOptions): ActionReturn<FocusPolicyOptions> {
  let opts = options;
  const doc = node.ownerDocument;
  const win = doc.defaultView;
  let press: { x: number; y: number; pointer: PointerKind } | null = null;

  const focusInput = (): void => {
    const input = opts.input();
    if (input && doc.activeElement !== input) input.focus({ preventScroll: true });
  };

  const onPointerDown = (event: PointerEvent): void => {
    press = { x: event.clientX, y: event.clientY, pointer: pointerKind(event.pointerType) };
  };

  const onClick = (event: MouseEvent): void => {
    // detail 0 is a click made with the keyboard (Enter on a button), which is never a tap.
    if (event.detail === 0) return;
    const target = event.target instanceof Element ? event.target : null;
    const start = press;
    press = null;
    const decision = shouldFocusOnTap({
      pointer: start?.pointer ?? 'mouse',
      clicks: event.detail,
      moved: start ? Math.hypot(event.clientX - start.x, event.clientY - start.y) : 0,
      selection: (win?.getSelection()?.toString() ?? '') !== '',
      interactive: target?.closest(INTERACTIVE_SELECTOR) != null,
      promptArea: target?.closest(PROMPT_AREA_SELECTOR) != null,
    });
    if (decision) focusInput();
  };

  // With nothing focused, a typed character would go nowhere. Focusing the prompt during keydown
  // sends this key's character to it.
  const onKeyDown = (event: KeyboardEvent): void => {
    const active = doc.activeElement;
    const idle = active === null || active === doc.body || active === doc.documentElement || active.tagName === 'MAIN';
    if (idle && !event.defaultPrevented && isPrintableKey(event)) focusInput();
  };

  node.addEventListener('pointerdown', onPointerDown, { capture: true, passive: true });
  node.addEventListener('click', onClick);
  win?.addEventListener('keydown', onKeyDown);

  return {
    update(next) {
      opts = next;
    },
    destroy() {
      node.removeEventListener('pointerdown', onPointerDown, { capture: true });
      node.removeEventListener('click', onClick);
      win?.removeEventListener('keydown', onKeyDown);
    },
  };
}
