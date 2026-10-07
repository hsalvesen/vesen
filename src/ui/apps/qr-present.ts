// Present mode from a tap on a QR card. `qr -f` shows QrPresenter through AppHost (tty.fullscreen),
// which a running command owns; a card's tap comes long after its command has ended, so the card
// draws the same presenter itself, in a layer this action moves to <body>: outside <main>, whose
// vintage CRT filter would capture a fixed child, and above everything. While the layer shows,
// the rest of the page is inert, so focus, taps and screen readers stay in the dialog.

import type { ActionReturn } from 'svelte/action';

/** Moves `node` to the end of <body> and makes everything else there inert, until it goes. */
export function presentLayer(node: HTMLElement): ActionReturn {
  const body = node.ownerDocument.body;
  body.append(node);
  // Elements already inert (the shell under an app) are left as they were.
  const slept = Array.from(body.children).filter(
    (element): element is HTMLElement => element !== node && element instanceof HTMLElement && !element.hasAttribute('inert') && element.tagName !== 'SCRIPT',
  );
  for (const element of slept) element.setAttribute('inert', '');
  return {
    destroy() {
      for (const element of slept) element.removeAttribute('inert');
      node.remove();
    },
  };
}
