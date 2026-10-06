import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LONG_PRESS_MS, REPEAT_DELAY_MS, REPEAT_EVERY_MS, press, type PressOptions } from './press';

let button: HTMLButtonElement;
let stop: () => void;

function make(options: PressOptions): void {
  button = document.body.appendChild(document.createElement('button'));
  stop = press(button, options).destroy ?? (() => {});
}

const down = (pointerType = 'touch', x = 10, y = 10) =>
  button.dispatchEvent(new PointerEvent('pointerdown', { pointerType, button: 0, clientX: x, clientY: y, bubbles: true, cancelable: true }));
const move = (x: number, y: number) => button.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'touch', clientX: x, clientY: y, bubbles: true }));
const up = () => button.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'touch', bubbles: true }));
const click = (detail = 1) => button.dispatchEvent(new MouseEvent('click', { detail, bubbles: true, cancelable: true }));

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  stop();
  button.remove();
  vi.useRealTimers();
});

describe('press', () => {
  it('taps on click, and never lets a press take focus from the prompt', () => {
    const tap = vi.fn();
    make({ tap });
    expect(button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))).toBe(false);
    // A mouse pointerdown is cancelled; a touch one is not (WebKit on iOS drops the tap).
    expect(down('mouse')).toBe(false);
    expect(down('touch')).toBe(true);
    up();
    click();
    expect(tap).toHaveBeenCalledTimes(1);
    // Enter or Space on the focused button.
    click(0);
    expect(tap).toHaveBeenCalledTimes(2);
  });

  it('holds while held, and acts on the long press when let go, swallowing the click', () => {
    const tap = vi.fn();
    const hold = vi.fn();
    const longPress = vi.fn();
    make({ tap, hold, longPress });
    down();
    vi.advanceTimersByTime(LONG_PRESS_MS - 1);
    expect(hold).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(hold).toHaveBeenCalledTimes(1);
    expect(longPress).not.toHaveBeenCalled();
    up();
    expect(longPress).toHaveBeenCalledTimes(1);
    click();
    expect(tap).not.toHaveBeenCalled();
  });

  it('repeats a held key, and does not tap again when it is let go', () => {
    const tap = vi.fn();
    make({ tap, repeat: true });
    down();
    vi.advanceTimersByTime(REPEAT_DELAY_MS);
    expect(tap).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(REPEAT_EVERY_MS * 3);
    expect(tap).toHaveBeenCalledTimes(4);
    up();
    click();
    vi.advanceTimersByTime(REPEAT_EVERY_MS * 3);
    expect(tap).toHaveBeenCalledTimes(4);
  });

  it('takes a press that moves for a scroll, and a click whose press began elsewhere for nothing', () => {
    const tap = vi.fn();
    const hold = vi.fn();
    make({ tap, hold });
    down('touch', 10, 10);
    move(40, 10);
    vi.advanceTimersByTime(LONG_PRESS_MS * 2);
    expect(hold).not.toHaveBeenCalled();
    // The sheet that opens under a finger gets the click of a press that began on ↑.
    click();
    click();
    expect(tap).toHaveBeenCalledTimes(1);
  });
});
