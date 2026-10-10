// Makes an element the target of a tap anywhere on it (use:tapTarget on the prompt row).
//
// iOS WebKit adjusts a tap: when the node under the finger listens for no click, the click is
// sent to the nearest small element nearby that does, within about a finger's width. The prompt
// row listens for nothing itself, so a tap on it could go to a tappable name on the line above
// (the banner's `tree`, or the last name of an output) and run that, instead of opening the
// keyboard. With a listener of its own, the row is the target wherever on it the tap lands, and
// the click reaches the focus policy on the shell as a tap on the prompt area.
import type { ActionReturn } from 'svelte/action';

/** Does nothing: the browser only has to see that the element listens. */
function onClick(): void {}

export function tapTarget(node: HTMLElement): ActionReturn {
  node.addEventListener('click', onClick);
  return {
    destroy() {
      node.removeEventListener('click', onClick);
    },
  };
}
