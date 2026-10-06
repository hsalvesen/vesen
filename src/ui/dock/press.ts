// Taps, long presses and held keys on the dock's buttons (use:press). A press never takes focus
// from the prompt, so a phone's keyboard stays up:
//
// - mousedown is always cancelled, which is what moves focus to a button, on a touch screen too
//   (the mousedown that follows a tap);
// - pointerdown is cancelled for a mouse or a pen, never for touch: WebKit on iOS drops the whole
//   tap, click included, when a touch pointerdown is cancelled.
//
// A tap acts on click, so Enter or Space on a focused button acts too. A press held for
// LONG_PRESS_MS calls `hold` while still held and `longPress` when let go: inside the release, so
// focus may still open the keyboard there. A key that repeats acts once on a tap, and when held,
// again every REPEAT_EVERY_MS. A press that moves is a scroll of the row, and does nothing.
import type { ActionReturn } from 'svelte/action';

export const LONG_PRESS_MS = 500;
export const REPEAT_DELAY_MS = 400;
export const REPEAT_EVERY_MS = 80;
/** Further than this from where it went down, a press is a scroll or a drag. */
export const MOVE_PX = 10;

export interface PressOptions {
  /** A tap, a click, or Enter or Space on the focused button. */
  readonly tap?: () => void;
  /** Held LONG_PRESS_MS, while still held. */
  readonly hold?: () => void;
  /** Held LONG_PRESS_MS, then let go. */
  readonly longPress?: () => void;
  /** Held, `tap` repeats. */
  readonly repeat?: boolean;
}

export function press(node: HTMLElement, options: PressOptions): ActionReturn<PressOptions> {
  let opts = options;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let repeater: ReturnType<typeof setInterval> | undefined;
  let down: { readonly x: number; readonly y: number } | null = null;
  /** The press went on long enough to hold, or to repeat. */
  let held = false;
  /** The click that ends a long press or a repeat is not a tap. */
  let swallow = false;
  /** A pointer went down on this button since the last click: a click without one began elsewhere. */
  let pressed = false;

  const stopTimers = (): void => {
    clearTimeout(timer);
    clearInterval(repeater);
    timer = undefined;
    repeater = undefined;
  };

  const cancel = (): void => {
    stopTimers();
    down = null;
    held = false;
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType !== 'touch') event.preventDefault();
    if (event.button !== 0) return;
    cancel();
    swallow = false;
    pressed = true;
    down = { x: event.clientX, y: event.clientY };
    if (opts.repeat === true) {
      timer = setTimeout(() => {
        held = true;
        opts.tap?.();
        repeater = setInterval(() => opts.tap?.(), REPEAT_EVERY_MS);
      }, REPEAT_DELAY_MS);
    } else if (opts.hold !== undefined || opts.longPress !== undefined) {
      timer = setTimeout(() => {
        held = true;
        opts.hold?.();
      }, LONG_PRESS_MS);
    }
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (down === null || held) return;
    if (Math.hypot(event.clientX - down.x, event.clientY - down.y) > MOVE_PX) cancel();
  };

  const onPointerUp = (): void => {
    if (down === null) return;
    const wasHeld = held;
    cancel();
    if (!wasHeld) return;
    swallow = true;
    if (opts.repeat !== true) opts.longPress?.();
  };

  const onClick = (event: MouseEvent): void => {
    const began = pressed;
    pressed = false;
    if (swallow) {
      swallow = false;
      event.preventDefault();
      return;
    }
    // A pointer click whose press began on something else, such as the button the history sheet
    // opened under the finger. detail 0 is Enter or Space.
    if (event.detail !== 0 && !began && typeof PointerEvent !== 'undefined') return;
    opts.tap?.();
  };

  const onMouseDown = (event: MouseEvent): void => event.preventDefault();

  // A long press on a touch screen is ours, not the browser's menu.
  const onContextMenu = (event: Event): void => {
    if (opts.hold !== undefined || opts.longPress !== undefined || opts.repeat === true) event.preventDefault();
  };

  node.addEventListener('pointerdown', onPointerDown);
  node.addEventListener('pointermove', onPointerMove, { passive: true });
  node.addEventListener('pointerup', onPointerUp);
  node.addEventListener('pointercancel', cancel);
  node.addEventListener('pointerleave', cancel);
  node.addEventListener('click', onClick);
  node.addEventListener('mousedown', onMouseDown);
  node.addEventListener('contextmenu', onContextMenu);

  return {
    update(next) {
      opts = next;
    },
    destroy() {
      stopTimers();
      node.removeEventListener('pointerdown', onPointerDown);
      node.removeEventListener('pointermove', onPointerMove);
      node.removeEventListener('pointerup', onPointerUp);
      node.removeEventListener('pointercancel', cancel);
      node.removeEventListener('pointerleave', cancel);
      node.removeEventListener('click', onClick);
      node.removeEventListener('mousedown', onMouseDown);
      node.removeEventListener('contextmenu', onContextMenu);
    },
  };
}
