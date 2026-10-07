import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DRAG_PX, focusPolicy, isPrintableKey, shouldFocusOnTap, type TapFacts } from './focusPolicy';

const click: TapFacts = {
  pointer: 'mouse',
  clicks: 1,
  moved: 0,
  selection: false,
  interactive: false,
  promptArea: false,
};

describe('shouldFocusOnTap', () => {
  it('focuses on a plain mouse click anywhere', () => {
    expect(shouldFocusOnTap(click)).toBe(true);
    expect(shouldFocusOnTap({ ...click, promptArea: true })).toBe(true);
    expect(shouldFocusOnTap({ ...click, moved: DRAG_PX.mouse })).toBe(true);
  });

  it('leaves a mouse alone that is selecting, dragging or using a control', () => {
    expect(shouldFocusOnTap({ ...click, clicks: 2 }), 'double click').toBe(false);
    expect(shouldFocusOnTap({ ...click, clicks: 3 }), 'triple click').toBe(false);
    expect(shouldFocusOnTap({ ...click, moved: DRAG_PX.mouse + 1 }), 'drag').toBe(false);
    expect(shouldFocusOnTap({ ...click, selection: true }), 'selection').toBe(false);
    expect(shouldFocusOnTap({ ...click, interactive: true }), 'control').toBe(false);
  });

  it('opens the keyboard on touch only from the prompt row or the space below it', () => {
    const tap: TapFacts = { ...click, pointer: 'touch' };
    expect(shouldFocusOnTap(tap), 'output').toBe(false);
    expect(shouldFocusOnTap({ ...tap, promptArea: true }), 'prompt').toBe(true);
    expect(shouldFocusOnTap({ ...tap, promptArea: true, moved: DRAG_PX.touch + 1 }), 'scroll').toBe(false);
    expect(shouldFocusOnTap({ ...tap, promptArea: true, interactive: true }), 'cancel button').toBe(false);
    expect(shouldFocusOnTap({ ...tap, promptArea: true, selection: true }), 'selection').toBe(false);
    expect(shouldFocusOnTap({ ...click, pointer: 'pen' }), 'pen on output').toBe(false);
  });
});

describe('isPrintableKey', () => {
  const key = (k: string, extra: Partial<Parameters<typeof isPrintableKey>[0]> = {}) =>
    isPrintableKey({ key: k, ctrlKey: false, metaKey: false, altKey: false, isComposing: false, ...extra });

  it('is true for characters and false for named keys and shortcuts', () => {
    for (const k of ['a', 'Z', '7', ' ', '/', '-', 'é', '😀']) expect(key(k), k).toBe(true);
    for (const k of ['Enter', 'Tab', 'Escape', 'ArrowUp', 'Shift', 'Dead', 'Process', 'F5']) expect(key(k), k).toBe(false);
    expect(key('c', { ctrlKey: true })).toBe(false);
    expect(key('v', { metaKey: true })).toBe(false);
    expect(key('a', { altKey: true })).toBe(false);
    expect(key('a', { isComposing: true })).toBe(false);
  });
});

describe('use:focusPolicy', () => {
  let shell: HTMLElement;
  let output: HTMLElement;
  let promptRow: HTMLElement;
  let button: HTMLButtonElement;
  let input: HTMLInputElement;
  let main: HTMLElement;
  let destroy: (() => void) | undefined;

  beforeEach(() => {
    document.body.innerHTML = `
      <div class="shell">
        <main tabindex="-1">
          <p class="output">some output</p>
          <div data-prompt-area><span class="ps1">guest@vesen:~$</span><input /></div>
          <button type="button">Cancel</button>
        </main>
      </div>`;
    shell = document.querySelector('.shell') as HTMLElement;
    output = document.querySelector('.output') as HTMLElement;
    promptRow = document.querySelector('.ps1') as HTMLElement;
    button = document.querySelector('button') as HTMLButtonElement;
    input = document.querySelector('input') as HTMLInputElement;
    main = document.querySelector('main') as HTMLElement;
    destroy = focusPolicy(shell, { input: () => input }).destroy;
  });

  afterEach(() => {
    destroy?.();
    window.getSelection()?.removeAllRanges();
    document.body.innerHTML = '';
  });

  function tap(target: Element, pointerType: string, options: { moveBy?: number; detail?: number } = {}): void {
    target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType, clientX: 10, clientY: 10 }));
    target.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        detail: options.detail ?? 1,
        clientX: 10 + (options.moveBy ?? 0),
        clientY: 10,
      }),
    );
  }

  it('focuses the prompt on a mouse click on output, without scrolling', () => {
    let options: FocusOptions | undefined;
    const focus = input.focus.bind(input);
    input.focus = (o?: FocusOptions) => {
      options = o;
      focus(o);
    };

    tap(output, 'mouse');

    expect(document.activeElement).toBe(input);
    expect(options).toEqual({ preventScroll: true });
  });

  it('does not focus after a mouse drag, a double click, a selection or a control', () => {
    tap(output, 'mouse', { moveBy: 20 });
    tap(output, 'mouse', { detail: 2 });
    tap(button, 'mouse');
    const range = document.createRange();
    range.selectNodeContents(output);
    window.getSelection()?.addRange(range);
    tap(output, 'mouse');

    expect(document.activeElement).not.toBe(input);
  });

  it('on touch, ignores taps on output and focuses from the prompt row', () => {
    tap(output, 'touch');
    expect(document.activeElement).not.toBe(input);

    tap(promptRow, 'touch');
    expect(document.activeElement).toBe(input);
  });

  it('on touch, blurs and focuses a prompt that has focus but no keyboard, so the keyboard comes back', () => {
    const calls: string[] = [];
    input.focus();
    input.addEventListener('blur', () => calls.push('blur'));
    input.addEventListener('focus', () => calls.push('focus'));
    // The viewport is tracked and says the keyboard is closed (Android's Back kept focus).
    document.documentElement.style.setProperty('--app-h', '812px');
    tap(promptRow, 'touch');
    expect(calls).toEqual(['blur', 'focus']);
    expect(document.activeElement).toBe(input);

    // With the keyboard open, or with a mouse, a focused prompt is left alone.
    calls.length = 0;
    document.documentElement.classList.add('kb-open');
    tap(promptRow, 'touch');
    document.documentElement.classList.remove('kb-open');
    tap(promptRow, 'mouse');
    expect(calls).toEqual([]);
    document.documentElement.style.removeProperty('--app-h');
    // Nor where the viewport is not tracked, and the keyboard cannot be known.
    tap(promptRow, 'touch');
    expect(calls).toEqual([]);
  });

  it('ignores a click made with the keyboard', () => {
    output.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
    expect(document.activeElement).not.toBe(input);
  });

  it('sends a printable key typed with nothing focused to the prompt', () => {
    const press = (key: string, init: KeyboardEventInit = {}) =>
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));

    press('Enter');
    press('c', { ctrlKey: true });
    expect(document.activeElement).not.toBe(input);

    press('l');
    expect(document.activeElement).toBe(input);

    // From the transcript itself, too.
    input.blur();
    main.focus();
    main.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true }));
    expect(document.activeElement).toBe(input);
  });

  it('leaves keys alone when another control has focus', () => {
    button.focus();
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    expect(document.activeElement).toBe(button);
  });

  it('stops once destroyed', () => {
    destroy?.();
    destroy = undefined;
    tap(output, 'mouse');
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    expect(document.activeElement).not.toBe(input);
  });
});
