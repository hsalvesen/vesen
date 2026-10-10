// The prompt row as a tap target (actions/tapTarget.ts): iOS WebKit sends a tap on an element
// that listens for no click to the nearest nearby element that does, so the row listens itself.
// Only a browser can show the tap landing (e2e/shell.spec.ts, "tapping the prompt row does");
// this checks the listener is there for as long as the element is.
import { describe, expect, it, vi } from 'vitest';
import { tapTarget } from './tapTarget';

describe('tapTarget', () => {
  it('listens for clicks on the element, does nothing with them, and stops when destroyed', () => {
    const node = document.createElement('div');
    const add = vi.spyOn(node, 'addEventListener');
    const remove = vi.spyOn(node, 'removeEventListener');
    const action = tapTarget(node);
    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith('click', expect.any(Function));
    const listener = add.mock.calls[0]?.[1];

    // A click is left to bubble to the focus policy on the shell, as it was.
    const bubbled = vi.fn();
    const parent = document.createElement('div');
    parent.append(node);
    parent.addEventListener('click', bubbled);
    node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(bubbled).toHaveBeenCalledTimes(1);

    action.destroy?.();
    expect(remove).toHaveBeenCalledWith('click', listener);
  });
});
